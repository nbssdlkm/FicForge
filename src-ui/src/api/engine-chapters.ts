// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Chapters — listChapters, getChapter, getChapterContent,
 *   confirmChapter, undoChapter, updateChapterTitle,
 *   resolveDirtyChapter, updateChapterContent.
 */

import {
  confirm_chapter as engineConfirmChapter,
  undo_latest_chapter,
  resolve_dirty_chapter,
  edit_chapter_content,
  IndexStatus,
  resolve_llm_config,
  create_provider,
  generate_standard_summary,
  generate_micro_summary,
  persist_chapter_summary,
  find_chapters_missing_summary,
  backfill_chapter_summaries,
  type BackfillSummaryTarget,
  type BackfillSummaryResult,
  generate_retrospective,
  commit_retrospective,
  shouldRunRetrospective,
  RETROSPECTIVE_INTERVAL,
  generateChapterTitle,
  createOpsEntry,
  generate_op_id,
  logCatch,
  now_utc,
  WriteTransaction,
  withAuLock,
  type GeneratedWith,
} from "@ficforge/engine";
import { getEngine } from "./engine-instance";
import { createEmbeddingProvider } from "./engine-state";

export async function listChapters(auPath: string) {
  const { chapter, state } = getEngine().repos;
  const chapters = await chapter.list_main(auPath);
  const st = await state.get(auPath);
  return chapters.map((ch) => ({
    chapter_num: ch.chapter_num,
    chapter_id: ch.chapter_id,
    content: ch.content,
    revision: ch.revision,
    confirmed_at: ch.confirmed_at,
    provenance: ch.provenance,
    title: st.chapter_titles[ch.chapter_num] ?? undefined,
  }));
}

export async function getChapter(auPath: string, chapterNum: number) {
  const { chapter } = getEngine().repos;
  const ch = await chapter.get(auPath, chapterNum);
  return ch;
}

export async function getChapterContent(auPath: string, chapterNum: number) {
  const { chapter } = getEngine().repos;
  return await chapter.get_content_only(auPath, chapterNum);
}

export async function confirmChapter(
  auPath: string, chapterNum: number, draftId: string,
  generatedWith?: object, content?: string | null, title?: string | null,
) {
  const e = getEngine();
  const { chapter, draft, state, ops, project, settings } = e.repos;
  const proj = await project.get(auPath);
  const result = await engineConfirmChapter({
    au_id: auPath, chapter_num: chapterNum, draft_id: draftId,
    generated_with: generatedWith as GeneratedWith | undefined,
    cast_registry: proj.cast_registry,
    content_override: content,
    chapter_repo: chapter, draft_repo: draft, state_repo: state, ops_repo: ops,
  });

  const sett = await settings.get();

  // Update title: use provided title, or auto-generate via LLM
  let finalTitle = title;
  if (!finalTitle) {
    try {
      const llmConfig = resolve_llm_config(null, proj, sett);
      // 标题生成是纯 chat 调用，api 和 ollama 都能跑；local 暂未实现。
      // api 模式必须有 api_key，ollama 模式 key 可为空（引擎会填 dummy）。
      const canGenerate =
        llmConfig.mode === "ollama" ||
        (llmConfig.mode === "api" && !!llmConfig.api_key);
      if (canGenerate) {
        const provider = create_provider(llmConfig);
        const chContent = await chapter.get_content_only(auPath, chapterNum);
        const lang = sett.app?.language || "zh";
        finalTitle = await generateChapterTitle(chContent, lang, provider);
      }
    } catch {
      // AI title generation failed — silent fallback
    }
  }
  if (finalTitle) {
    // 原子更新：读取最新 state → 修改 title → WriteTransaction 保证 D-0036 顺序。
    // AU 锁保证：engineConfirmChapter 释放锁后到这里写 title 前（LLM 生成 title 可能耗时），
    // 如果用户发起 undo / edit 等操作，它们会和本段串行，不会覆盖中间状态。
    await withAuLock(auPath, async () => {
      const st = await state.get(auPath);
      st.chapter_titles[chapterNum] = finalTitle;
      const tx = new WriteTransaction();
      tx.appendOp(auPath, createOpsEntry({
        op_id: generate_op_id(),
        op_type: "set_chapter_title",
        target_id: auPath,
        chapter_num: chapterNum,
        timestamp: now_utc(),
        payload: { title: finalTitle },
      }));
      tx.setState(st);
      await tx.commit(ops, null, state);
    });
  }

  // Index the confirmed chapter for RAG (F7) — delegated to RagManager
  try {
    const embProvider = createEmbeddingProvider(sett, proj);
    if (embProvider) {
      const chContent = await chapter.get_content_only(auPath, chapterNum);
      await e.ragManager.indexChapter(auPath, chapterNum, chContent, embProvider, proj.cast_registry);
      // confirm_chapter 里先悲观标记 STALE；增量索引成功后再升级回 READY。
      await withAuLock(auPath, async () => {
        await e.repos.state.update(auPath, (st) => {
          st.index_status = IndexStatus.READY;
        });
      });
    }
  } catch (err) {
    // RAG indexing failure doesn't block confirm；保留 STALE 作为真实状态。
    logCatch("rag", `Failed to index chapter ${chapterNum} after confirm`, err);
  }

  // M8-C：章节摘要生成。独立 best-effort 边界，放在 RAG 索引 / READY 升级之后/之外
  // —— 摘要失败绝不影响 index_status 或章节确认（决策② / codex MAJOR5）。
  try {
    const embProvider = createEmbeddingProvider(sett, proj);
    const llmCfg = resolve_llm_config(null, proj, sett);
    const canGen = llmCfg.mode === "ollama" || (llmCfg.mode === "api" && !!llmCfg.api_key);
    if (embProvider && canGen) {
      const chContent = await chapter.get_content_only(auPath, chapterNum);
      const lang = sett.app?.language || "zh";
      const llmProvider = create_provider(llmCfg);

      // Standard 摘要：生成（慢 LLM）在锁外，落盘+索引在锁内 + CAS 校验（M8-C）
      const summaryText = await generate_standard_summary(chContent, chapterNum, llmProvider, { language: lang });

      // Micro 摘要：同样在锁外生成（M10-A）
      const microText = await generate_micro_summary(chContent, chapterNum, llmProvider, { language: lang });

      if (summaryText || microText) {
        // 落盘在锁内，CAS 校验章节内容未被并发 undo/edit 改动
        await withAuLock(auPath, async () => {
          let stillCurrent = false;
          try {
            const ch = await chapter.get(auPath, chapterNum);
            stillCurrent = ch.content_hash === result.content_hash;
          } catch {
            stillCurrent = false; // 章节已被 undo
          }
          if (!stillCurrent) return;

          // Standard 落盘 + 索引（M8-C）
          if (summaryText) {
            await persist_chapter_summary({
              auPath,
              chapterNum,
              text: summaryText,
              contentHash: result.content_hash,
              embeddingProvider: embProvider,
              summaryRepo: e.repos.chapterSummary,
              ragManager: e.ragManager,
            });
          }

          // Micro 落盘（M10-A）：update_micro 合并写入，不进向量库
          if (microText) {
            try {
              await e.repos.chapterSummary.update_micro(auPath, chapterNum, microText, result.content_hash);
            } catch (microErr) {
              logCatch("summary", `Failed to save micro summary for chapter ${chapterNum}`, microErr);
            }
          }
        });
      }
    }
  } catch (err) {
    logCatch("summary", `Failed to generate chapter summary after confirm ${chapterNum}`, err);
  }

  // M10-A：Retrospective Rewrite。独立 best-effort 边界，在摘要生成之后运行。
  // 触发条件：每 RETROSPECTIVE_INTERVAL 章，对 N-interval 章执行后见之明重写。
  // 双阶段：锁外生成（慢 LLM）+ 锁内 CAS 写盘，防止并发 undo 产生孤儿 .summary.jsonl。
  try {
    if (shouldRunRetrospective(chapterNum, RETROSPECTIVE_INTERVAL)) {
      const embProvider = createEmbeddingProvider(sett, proj);
      const llmCfg = resolve_llm_config(null, proj, sett);
      const canGen = llmCfg.mode === "ollama" || (llmCfg.mode === "api" && !!llmCfg.api_key);
      if (embProvider && canGen) {
        const targetChapterNum = chapterNum - RETROSPECTIVE_INTERVAL;

        // Phase 1（锁外）：LLM 生成 v2 文本
        const genResult = await generate_retrospective(
          auPath,
          targetChapterNum,
          chapter,
          e.repos.chapterSummary,
          create_provider(llmCfg),
          chapterNum,
          { language: sett.app?.language || "zh" },
        );

        // Phase 2（锁内）：CAS 校验章节还在，再写 v2 + 更新向量索引
        if (genResult) {
          await withAuLock(auPath, async () => {
            let targetStillPresent = false;
            try {
              const targetCh = await chapter.get(auPath, targetChapterNum);
              // CAS：章节文件存在即视为有效（targetChapterNum 是历史章，content_hash 不变）
              targetStillPresent = !!targetCh;
            } catch {
              targetStillPresent = false; // 章节已被 undo 删除
            }
            if (!targetStillPresent) return;

            await commit_retrospective(
              auPath, targetChapterNum, genResult,
              e.repos.chapterSummary, e.ragManager, embProvider,
            );
          });
        }
      }
    }
  } catch (err) {
    logCatch("retrospective", `Retrospective failed after ch${chapterNum}`, err);
  }

  return result;
}

export async function undoChapter(auPath: string) {
  const { chapter, draft, state, ops, fact, project, chapterSummary } = getEngine().repos;
  const proj = await project.get(auPath);
  const result = await undo_latest_chapter({
    au_id: auPath, cast_registry: proj.cast_registry,
    chapter_repo: chapter, draft_repo: draft, state_repo: state, ops_repo: ops, fact_repo: fact,
  });
  // M8-C（codex 实现审 #3）：撤销删了章节，连带删其摘要文件，避免孤儿 .summary.jsonl。best-effort。
  try {
    await chapterSummary.remove(auPath, result.chapter_num);
  } catch (err) {
    logCatch("summary", `Failed to remove summary after undo ${result.chapter_num}`, err);
  }
  return result;
}

export async function updateChapterTitle(auPath: string, chapterNum: number, title: string) {
  const { state, ops } = getEngine().repos;
  // UI 直接写 state + ops，不经 service —— 必须顶层加 AU 锁，
  // 否则 confirm / undo / edit 并发时会覆写同一 state 文件。
  return withAuLock(auPath, async () => {
    const st = await state.get(auPath);
    st.chapter_titles[chapterNum] = title;
    const tx = new WriteTransaction();
    tx.appendOp(auPath, createOpsEntry({
      op_id: generate_op_id(),
      op_type: "set_chapter_title",
      target_id: auPath,
      chapter_num: chapterNum,
      timestamp: now_utc(),
      payload: { title },
    }));
    tx.setState(st);
    await tx.commit(ops, null, state);
    return { chapter_num: chapterNum, title };
  });
}

export async function resolveDirtyChapter(auPath: string, chapterNum: number, confirmedFactChanges: any[] = []) {
  const { chapter, state, ops, fact, project } = getEngine().repos;
  const proj = await project.get(auPath);
  return await resolve_dirty_chapter({
    au_id: auPath, chapter_num: chapterNum, confirmed_fact_changes: confirmedFactChanges,
    cast_registry: proj.cast_registry,
    chapter_repo: chapter, state_repo: state, ops_repo: ops, fact_repo: fact,
  });
}

export async function updateChapterContent(auPath: string, chapterNum: number, content: string) {
  const { chapter, state, ops, chapterSummary } = getEngine().repos;
  // edit_chapter_content 属于"底层 service"，本身不加锁（避免被 dirty_resolve
  // 等已持锁的 orchestrator 调用时死锁）。UI 直接调用路径必须在此顶层加锁。
  const result = await withAuLock(auPath, () =>
    edit_chapter_content(auPath, chapterNum, content, chapter, state, ops),
  );
  // M8-C（codex 实现审 #1/#2）：编辑使该章摘要陈旧。删摘要文件，避免后续 rebuild 把陈旧摘要
  // 重新提升进 READY 索引（rebuild 不重生成摘要）。编辑后该章退化为 chunk-only RAG，真正重生成留 M10。best-effort。
  try {
    await chapterSummary.remove(auPath, chapterNum);
  } catch (err) {
    logCatch("summary", `Failed to invalidate summary after edit ${chapterNum}`, err);
  }
  return result;
}

// ---- 批量补摘要（用户手动触发）：给「配 embedding 之前确认、永久没摘要」的旧章补 standard 摘要。----
// 摘要本来只在 confirmChapter 那一刻生成（且需当时已配 embedding），晚配 embedding 的旧章无 backfill 路径。

export interface BackfillSummaryAvailability {
  missingChapters: number[];   // 缺 standard 摘要的确认章号
  totalConfirmed: number;      // 已确认章总数
  embeddingConfigured: boolean;
  llmConfigured: boolean;
}

/** 预览：扫出缺摘要的章 + 当前配置能否跑（embedding + 写作模型）。UI 先调它显示数量/前置条件。 */
export async function countChaptersMissingSummary(auPath: string): Promise<BackfillSummaryAvailability> {
  const e = getEngine();
  const { chapter, project, settings, chapterSummary } = e.repos;
  const [proj, sett] = await Promise.all([project.get(auPath), settings.get()]);
  const llmCfg = resolve_llm_config(null, proj, sett);
  const chapters = await chapter.list_main(auPath);
  const nums = chapters.map((c) => c.chapter_num);
  const missingChapters = await find_chapters_missing_summary(auPath, nums, chapterSummary);
  return {
    missingChapters,
    totalConfirmed: nums.length,
    embeddingConfigured: !!createEmbeddingProvider(sett, proj),
    llmConfigured: llmCfg.mode === "ollama" || (llmCfg.mode === "api" && !!llmCfg.api_key),
  };
}

/** 实跑：逐章补 standard 摘要。配置不全/无缺章则抛错或空跑（UI 应在前置条件满足时才让点）。 */
export async function backfillChapterSummaries(
  auPath: string,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<BackfillSummaryResult> {
  const e = getEngine();
  const { chapter, project, settings, chapterSummary } = e.repos;
  const [proj, sett] = await Promise.all([project.get(auPath), settings.get()]);
  const embProvider = createEmbeddingProvider(sett, proj);
  const llmCfg = resolve_llm_config(null, proj, sett);
  const llmConfigured = llmCfg.mode === "ollama" || (llmCfg.mode === "api" && !!llmCfg.api_key);
  if (!embProvider || !llmConfigured) {
    throw new Error("embedding and LLM must be configured to backfill summaries");
  }

  const chapters = await chapter.list_main(auPath);
  const byNum = new Map(chapters.map((c) => [c.chapter_num, c]));
  const missing = await find_chapters_missing_summary(auPath, [...byNum.keys()], chapterSummary);

  // targets：content 用 get_content_only（= confirm 喂 LLM 同款，去 frontmatter），hash 用章节 content_hash。
  const targets: BackfillSummaryTarget[] = [];
  for (const n of missing) {
    const ch = byNum.get(n);
    if (!ch) continue;
    const content = await chapter.get_content_only(auPath, n);
    targets.push({ chapterNum: n, content, contentHash: ch.content_hash });
  }

  return backfill_chapter_summaries({
    targets,
    llmProvider: create_provider(llmCfg),
    language: sett.app?.language || "zh",
    signal,
    // CAS-in-lock（= confirm 同款）：慢 LLM 在锁外生成，落盘在锁内并校验章节 content_hash 未变。
    // 批量跑期间用户 edit/undo 了某章 → hash 不符 → 不写陈旧摘要向量（向量被检索消费，比孤儿文件更毒）。
    persistChapter: async (target, text) =>
      withAuLock(auPath, async () => {
        let current = false;
        try {
          const ch = await chapter.get(auPath, target.chapterNum);
          current = ch.content_hash === target.contentHash;
        } catch {
          current = false; // 章节已被 undo 删除
        }
        if (!current) return false;
        await persist_chapter_summary({
          auPath,
          chapterNum: target.chapterNum,
          text,
          contentHash: target.contentHash,
          embeddingProvider: embProvider,
          summaryRepo: chapterSummary,
          ragManager: e.ragManager,
        });
        return true;
      }),
    onProgress: onProgress ? (info) => onProgress(info.done, info.total) : undefined,
  });
}
