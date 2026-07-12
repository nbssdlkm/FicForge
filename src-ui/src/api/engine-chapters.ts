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
  chapterInflightKey,
  isChapterInflight,
  IndexStatus,
  resolve_llm_config,
  create_provider,
  generate_standard_summary,
  generate_micro_summary,
  persist_chapter_summary,
  find_chapters_missing_summary,
  add_fact,
  backfill_chapter_memory,
  type BackfillMemoryTarget,
  type BackfillMemoryResult,
  generate_retrospective,
  commit_retrospective,
  should_run_retrospective,
  RETROSPECTIVE_INTERVAL,
  generateChapterTitle,
  createOpsEntry,
  generate_op_id,
  logCatch,
  now_utc,
  WriteTransaction,
  withAuLock,
  type GeneratedWith,
  type FactChange,
} from "@ficforge/engine";
import { ApiError, getFriendlyErrorMessage } from "./client";
import { getEngine, getProjectOrThrow } from "./engine-instance";
import { resolveLang } from "./resolve-lang";
import { createEmbeddingProvider } from "./engine-state";
import { extractFacts } from "./engine-facts";
import { buildFactDataFromCandidate, type ExtractedFactCandidate } from "./facts";

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

export async function getChapterContent(auPath: string, chapterNum: number) {
  const { chapter } = getEngine().repos;
  return await chapter.get_content_only(auPath, chapterNum);
}

export async function confirmChapter(
  auPath: string,
  chapterNum: number,
  draftId: string,
  generatedWith?: object,
  content?: string | null,
  title?: string | null,
) {
  // R1-3（对抗审 2-A）：confirm 动手前查「生成在飞」互斥表。该章正被写文/对话任一路径
  // 流式生成时，接受/定稿会与在飞流竞写同一章 —— 拒绝并让 UI 提示「先停止或等它完成」。
  // 不自动 abort 在飞流：那是用户资产，不替他丢。释放（用户点停/流结束）后重试即通过。
  if (isChapterInflight(chapterInflightKey(auPath, chapterNum))) {
    throw new ApiError(
      "CHAPTER_GENERATION_IN_FLIGHT",
      getFriendlyErrorMessage({ error_code: "CHAPTER_GENERATION_IN_FLIGHT" }),
      [],
    );
  }
  const e = getEngine();
  const { chapter, draft, state, ops, settings } = e.repos;
  const proj = await getProjectOrThrow(auPath);
  // M1a：记录 confirm 前的 index_status。engineConfirmChapter 内部会悲观置 STALE，
  // 增量索引成功后是否升回 READY 取决于 confirm 之前索引是否本就完整（见下方注释）。
  let preConfirmIndexStatus: IndexStatus | null = null;
  try {
    preConfirmIndexStatus = (await state.get(auPath)).index_status;
  } catch {
    // state 读取失败 → 视为未知，保守不升 READY（首章除外）
  }
  const result = await engineConfirmChapter({
    au_id: auPath,
    chapter_num: chapterNum,
    draft_id: draftId,
    generated_with: generatedWith as GeneratedWith | undefined,
    cast_registry: proj.cast_registry,
    content_override: content,
    chapter_repo: chapter,
    draft_repo: draft,
    state_repo: state,
    ops_repo: ops,
  });

  const sett = await settings.get();

  // Update title: use provided title, or auto-generate via LLM
  let finalTitle = title;
  if (!finalTitle) {
    try {
      const llmConfig = resolve_llm_config(null, proj, sett);
      // 标题生成是纯 chat 调用，api 和 ollama 都能跑；local 暂未实现。
      // api 模式必须有 api_key，ollama 模式 key 可为空（引擎会填 dummy）。
      const canGenerate = llmConfig.mode === "ollama" || (llmConfig.mode === "api" && !!llmConfig.api_key);
      if (canGenerate) {
        const provider = create_provider(llmConfig);
        const chContent = await chapter.get_content_only(auPath, chapterNum);
        const lang = resolveLang(sett);
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
      tx.appendOp(
        auPath,
        createOpsEntry({
          op_id: generate_op_id(),
          op_type: "set_chapter_title",
          target_id: auPath,
          chapter_num: chapterNum,
          timestamp: now_utc(),
          payload: { title: finalTitle },
        }),
      );
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
      // confirm_chapter 里先悲观标记 STALE；增量索引成功后仅在两种情形升回 READY（M1a）：
      //  - confirm 前就是 READY —— 本次增量索引把索引重新补齐到完整；
      //  - 首章 confirm（chapterNum === 1，此前零章）—— 索引天然完整，否则新 AU 永远卡 STALE。
      // confirm 前已是 STALE / INTERRUPTED → 保持不动：index_status 是单 bit，无法区分 stale
      // 成因（编辑未重索引 / backfill 半成功 / undo 清理失败 / 旧章从未索引…），而增量索引
      // 只覆盖本章 —— 无条件升 READY 会掩盖既有降级提示。存量 STALE 由「重建索引」或
      // backfill 全量成功（M1b）解除。
      if (preConfirmIndexStatus === IndexStatus.READY || chapterNum === 1) {
        await withAuLock(auPath, async () => {
          await e.repos.state.update(auPath, (st) => {
            st.index_status = IndexStatus.READY;
          });
        });
      }
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
      const lang = resolveLang(sett);
      const llmProvider = create_provider(llmCfg);

      // Standard 摘要：生成（慢 LLM）在锁外，落盘+索引在锁内 + CAS 校验（M8-C）
      const summaryText = await generate_standard_summary(chContent, chapterNum, llmProvider, { language: lang });

      // Micro 摘要：同样在锁外生成（M10-A）
      const microText = await generate_micro_summary(chContent, chapterNum, llmProvider, { language: lang });

      if (summaryText || microText) {
        // 落盘在锁内，CAS 校验章节内容未被并发 undo/edit 改动
        await withAuLock(auPath, async () => {
          // CAS：章节被并发 undo 删除（get 返回 null）或内容已变 → 摘要作废不落盘
          const ch = await chapter.get(auPath, chapterNum);
          const stillCurrent = ch !== null && ch.content_hash === result.content_hash;
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
    if (should_run_retrospective(chapterNum, RETROSPECTIVE_INTERVAL)) {
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
          { language: resolveLang(sett) },
        );

        // Phase 2（锁内）：CAS 校验章节还在，再写 v2 + 更新向量索引
        if (genResult) {
          await withAuLock(auPath, async () => {
            let targetCh: Awaited<ReturnType<typeof chapter.get>>;
            try {
              targetCh = await chapter.get(auPath, targetChapterNum);
            } catch {
              return; // 章节已被 undo 删除 → 跳过
            }
            // CAS：章节仍在 **且内容未变**（content_hash 与 Phase1 读取时一致）才提交。
            // 审计⑤：Phase1 慢 LLM 期间用户若编辑该历史章（编辑=作废旧摘要），content_hash 变化
            // → 跳过提交，避免用「编辑前的旧正文」重建摘要 + 覆盖向量。与当前章摘要 / backfill 的 CAS 同口径。
            if (!targetCh || targetCh.content_hash !== genResult.contentHash) return;

            await commit_retrospective(
              auPath,
              targetChapterNum,
              genResult,
              e.repos.chapterSummary,
              e.ragManager,
              embProvider,
              // L17：向量覆盖失败时置 index_status=STALE（既在 withAuLock 内，state 写锁安全）。
              e.repos.state,
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
  const e = getEngine();
  const { chapter, draft, state, ops, fact, chapterSummary } = e.repos;
  const proj = await getProjectOrThrow(auPath);
  // H9a：记录 undo 前的 index_status。undo 服务内部会悲观置 STALE（10 步级联，golden 逻辑不动）；
  // 向量删除不需要 embedding，删除成功后索引即与剩余章节一致，可恢复原状态。
  let preUndoIndexStatus: IndexStatus | null = null;
  try {
    preUndoIndexStatus = (await state.get(auPath)).index_status;
  } catch {
    // 读不到就不恢复，保持 undo 服务置下的 STALE
  }
  const result = await undo_latest_chapter({
    au_id: auPath,
    cast_registry: proj.cast_registry,
    chapter_repo: chapter,
    draft_repo: draft,
    state_repo: state,
    ops_repo: ops,
    fact_repo: fact,
  });
  // M8-C（codex 实现审 #3）：撤销删了章节，连带删其摘要文件，避免孤儿 .summary.jsonl。best-effort。
  try {
    await chapterSummary.remove(auPath, result.chapter_num);
  } catch (err) {
    logCatch("summary", `Failed to remove summary after undo ${result.chapter_num}`, err);
  }
  // H9a：undo = 用户明确拒绝该章 —— 删其正文 chunks + sum{N} 摘要向量（内存 + 落盘），
  // 否则被拒正文以 decay=1 最高时间权重残留召回、污染重写。删除成功且 undo 前是 READY
  // → 恢复 READY（索引仍完整）；删除失败 → 保持 undo 置下的 STALE，等「重建索引」修复。
  try {
    await e.ragManager.removeChapter(auPath, result.chapter_num);
    if (preUndoIndexStatus === IndexStatus.READY) {
      await withAuLock(auPath, async () => {
        await state.update(auPath, (st) => {
          st.index_status = IndexStatus.READY;
        });
      });
    }
  } catch (err) {
    logCatch("rag", `Failed to remove vectors after undo ${result.chapter_num}`, err);
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
    tx.appendOp(
      auPath,
      createOpsEntry({
        op_id: generate_op_id(),
        op_type: "set_chapter_title",
        target_id: auPath,
        chapter_num: chapterNum,
        timestamp: now_utc(),
        payload: { title },
      }),
    );
    tx.setState(st);
    await tx.commit(ops, null, state);
    return { chapter_num: chapterNum, title };
  });
}

export async function resolveDirtyChapter(auPath: string, chapterNum: number, confirmedFactChanges: FactChange[] = []) {
  const { chapter, state, ops, fact } = getEngine().repos;
  const proj = await getProjectOrThrow(auPath);
  return await resolve_dirty_chapter({
    au_id: auPath,
    chapter_num: chapterNum,
    confirmed_fact_changes: confirmedFactChanges,
    cast_registry: proj.cast_registry,
    chapter_repo: chapter,
    state_repo: state,
    ops_repo: ops,
    fact_repo: fact,
  });
}

export async function updateChapterContent(auPath: string, chapterNum: number, content: string) {
  const e = getEngine();
  const { chapter, state, ops, chapterSummary, settings } = e.repos;
  // H9b：记录编辑前的 index_status（edit_chapter_content 会置 STALE）。
  // 重索引成功后是否恢复 READY 取决于编辑前索引是否本就完整（与 confirm 的 M1a 同口径）。
  let preEditIndexStatus: IndexStatus | null = null;
  try {
    preEditIndexStatus = (await state.get(auPath)).index_status;
  } catch {
    // 读不到就不恢复，保持 edit 服务置下的 STALE
  }
  // edit_chapter_content 属于"底层 service"，本身不加锁（避免被 dirty_resolve
  // 等已持锁的 orchestrator 调用时死锁）。UI 直接调用路径必须在此顶层加锁。
  const result = await withAuLock(auPath, () => edit_chapter_content(auPath, chapterNum, content, chapter, state, ops));
  // M8-C（codex 实现审 #1/#2）：编辑使该章摘要陈旧。删摘要文件，避免后续 rebuild 把陈旧摘要
  // 重新提升进 READY 索引（rebuild 不重生成摘要）。编辑后该章退化为 chunk-only RAG，真正重生成留 M10。best-effort。
  try {
    await chapterSummary.remove(auPath, chapterNum);
  } catch (err) {
    logCatch("summary", `Failed to invalidate summary after edit ${chapterNum}`, err);
  }
  // H9b：编辑历史章 → 旧正文 chunks + sum{N} 立即失效。宁缺勿旧：
  //  1. 先删旧向量（删除不需要 embedding）—— 残缺召回好过被拒/过时内容进生成；
  //  2. embedding 可用 → 立刻增量重索引新正文（对齐 confirm 的增量索引路径），
  //     成功且编辑前 READY → 恢复 READY（不再留悬空 STALE）；
  //  3. embedding 不可用 / 重索引失败 → 删完保持 edit 服务置下的 STALE。
  try {
    await e.ragManager.removeChapter(auPath, chapterNum);
    const [proj, sett] = await Promise.all([getProjectOrThrow(auPath), settings.get()]);
    const embProvider = createEmbeddingProvider(sett, proj);
    if (embProvider) {
      // 用落盘后的正文重索引（与 confirm 同源），不直接用入参，防 save 路径归一化产生偏差。
      const chContent = await chapter.get_content_only(auPath, chapterNum);
      await e.ragManager.indexChapter(auPath, chapterNum, chContent, embProvider, proj.cast_registry);
      if (preEditIndexStatus === IndexStatus.READY) {
        await withAuLock(auPath, async () => {
          await state.update(auPath, (st) => {
            st.index_status = IndexStatus.READY;
          });
        });
      }
    }
  } catch (err) {
    logCatch("rag", `Failed to refresh vectors after edit ${chapterNum}`, err);
  }
  return result;
}

// ---- 补全旧章记忆（plan 3.1）：逐章统一 pass 补 摘要 + 笔记（+剧情线）+ 向量。----
// 摘要/向量自动补缺；笔记只对用户勾选的章提取（自动落库）。复用 backfill_chapter_memory 引擎服务
// （loop/中断/CAS/半成功）+ 现成原语（generate_standard_summary / extractFacts / add_fact /
// persist_chapter_summary / indexChapter），不重写逻辑。

export interface ChapterMemoryScan {
  totalConfirmed: number;
  chaptersMissingSummary: number[]; // 缺 standard 摘要的章
  chaptersZeroFacts: number[]; // 一条笔记都没有的章（默认勾选提取）
  factCountByChapter: Record<number, number>; // 每章现有笔记数（给选择器显示）
  embeddingConfigured: boolean;
  llmConfigured: boolean;
}

/** 预览：扫出缺摘要 / 零笔记的章 + 前置配置。UI 先调它显示清单与默认勾选。 */
export async function scanChapterMemory(auPath: string): Promise<ChapterMemoryScan> {
  const e = getEngine();
  const { chapter, settings, chapterSummary, fact } = e.repos;
  const [proj, sett] = await Promise.all([getProjectOrThrow(auPath), settings.get()]);
  const llmCfg = resolve_llm_config(null, proj, sett);
  const chapters = await chapter.list_main(auPath);
  const nums = chapters.map((c) => c.chapter_num);

  const chaptersMissingSummary = await find_chapters_missing_summary(auPath, nums, chapterSummary);

  const allFacts = await fact.list_all(auPath);
  const factCountByChapter: Record<number, number> = {};
  for (const n of nums) factCountByChapter[n] = 0;
  for (const f of allFacts) {
    if (typeof f.chapter === "number" && f.chapter in factCountByChapter) {
      factCountByChapter[f.chapter] += 1;
    }
  }
  const chaptersZeroFacts = nums.filter((n) => factCountByChapter[n] === 0);

  return {
    totalConfirmed: nums.length,
    chaptersMissingSummary,
    chaptersZeroFacts,
    factCountByChapter,
    embeddingConfigured: !!createEmbeddingProvider(sett, proj),
    llmConfigured: llmCfg.mode === "ollama" || (llmCfg.mode === "api" && !!llmCfg.api_key),
  };
}

/** 实跑：逐章补记忆。摘要补所有缺的；笔记只对 factsChapters 提取。配置不全则抛错。 */
export async function backfillChapterMemory(
  auPath: string,
  opts: { factsChapters: number[] },
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<BackfillMemoryResult> {
  const e = getEngine();
  const { chapter, settings, chapterSummary, fact, ops } = e.repos;
  const [proj, sett] = await Promise.all([getProjectOrThrow(auPath), settings.get()]);
  const embProvider = createEmbeddingProvider(sett, proj);
  const llmCfg = resolve_llm_config(null, proj, sett);
  const llmConfigured = llmCfg.mode === "ollama" || (llmCfg.mode === "api" && !!llmCfg.api_key);
  if (!embProvider || !llmConfigured) {
    throw new Error("embedding and LLM must be configured to backfill chapter memory");
  }
  const llmProvider = create_provider(llmCfg);
  const language = resolveLang(sett);
  // 别名表快照（整个 backfill 共用）：提取端（extractFacts 内部）已归一化，落库端再挂一道
  // 是与 addFactsBatch 同款的纵深防御——覆盖「提取后、落库前别名表被改」的窗口。
  const characterAliases = await e.characterAliases.get(auPath);

  const chapters = await chapter.list_main(auPath);
  const byNum = new Map(chapters.map((c) => [c.chapter_num, c]));
  const nums = [...byNum.keys()];
  const missingSummary = new Set(await find_chapters_missing_summary(auPath, nums, chapterSummary));
  const factsSet = new Set(opts.factsChapters);

  // in-scope = 缺摘要章 ∪ 勾选提笔记章；这些章顺带把正文进向量索引。
  const inScope = nums.filter((n) => missingSummary.has(n) || factsSet.has(n)).sort((a, b) => a - b);

  const targets: BackfillMemoryTarget[] = [];
  for (const n of inScope) {
    const ch = byNum.get(n);
    if (!ch) continue;
    const content = await chapter.get_content_only(auPath, n);
    targets.push({
      chapterNum: n,
      content,
      contentHash: ch.content_hash,
      needSummary: missingSummary.has(n),
      extractFacts: factsSet.has(n),
    });
  }

  const result = await backfill_chapter_memory({
    targets,
    signal,
    // 慢 LLM，锁外。signal 透传 → 用户点停时在飞的摘要/提取请求被立刻取消（审计⑨）。
    generateSummary: (t) => generate_standard_summary(t.content, t.chapterNum, llmProvider, { language, signal }),
    extractFacts: async (t) => {
      const r = await extractFacts(auPath, t.chapterNum, { signal });
      return { facts: r.facts, cappedCount: r.cappedCount ?? 0 };
    },
    // 锁内 CAS 落盘（= backfill 摘要同款）：章节中途被 edit/undo → hash 不符 → 跳过，不写陈旧数据。
    persistChapter: async (t, { summaryText, facts }) =>
      withAuLock(auPath, async () => {
        // CAS：章节被并发 undo 删除（get 返回 null）或内容已变 → 本章结果作废
        const ch = await chapter.get(auPath, t.chapterNum);
        const current = ch !== null && ch.content_hash === t.contentHash;
        if (!current) return { persisted: false, factsAdded: 0 };

        try {
          if (summaryText) {
            await persist_chapter_summary({
              auPath,
              chapterNum: t.chapterNum,
              text: summaryText,
              contentHash: t.contentHash,
              embeddingProvider: embProvider,
              summaryRepo: chapterSummary,
              ragManager: e.ragManager,
              signal, // 点停时摘要向量化立即中止（MED-2）
            });
          }

          let factsAdded = 0;
          for (const c of facts as ExtractedFactCandidate[]) {
            await add_fact(
              auPath,
              // 归属强制用 t.chapterNum —— backfill 明确知道笔记提自哪一章，不信任 LLM 候选里
              // 可能幻觉的 chapter 字段（防错章归属，对抗审 NIT）。
              t.chapterNum,
              buildFactDataFromCandidate(c), // 单源映射（盲审 2026-07-11）

              fact,
              ops,
              "manual",
              characterAliases,
            );
            factsAdded += 1;
          }

          // 章正文进向量索引（idempotent overwrite）；signal 透传 → 点停时中止在飞 embed（MED-2）
          await e.ragManager.indexChapter(auPath, t.chapterNum, t.content, embProvider, proj.cast_registry, signal);
          return { persisted: true, factsAdded };
        } catch (err) {
          // 半成功（如摘要/部分笔记已落但正文未索引）→ 标 index_status=STALE，让「重建索引」或重跑修复
          // （= confirm 索引失败同款降级，对抗审 MEDIUM）。已在 AU 锁内，直接 state.update。
          try {
            await e.repos.state.update(auPath, (st) => {
              st.index_status = IndexStatus.STALE;
            });
          } catch (stErr) {
            logCatch(
              "backfill_memory",
              `Failed to mark index STALE after persist error (chapter ${t.chapterNum})`,
              stErr,
            );
          }
          throw err; // 让引擎服务计 failed（半成功隔离）
        }
      }),
    onProgress: onProgress ? (info) => onProgress(info.done, info.total) : undefined,
  });

  // M1b：全量成功（有目标章、全部处理完、零 failed、未中断）→ 升 READY。杀手场景（导入后
  // 一键建记忆）跑完不再滞留「索引过期」误导用户重复全量重建。skipped（CAS 拒绝）不阻断：
  // 被并发 edit/undo 的章由其自身路径负责删/重索引（H9）。有 failed / 中断 → 保持现状
  // （半成功标 STALE 的既有逻辑不动）。best-effort：状态写失败不推翻已成功的 backfill。
  if (targets.length > 0 && result.failed === 0 && !result.aborted) {
    try {
      await withAuLock(auPath, async () => {
        await e.repos.state.update(auPath, (st) => {
          st.index_status = IndexStatus.READY;
        });
      });
    } catch (err) {
      logCatch("backfill_memory", "Failed to mark index READY after fully successful backfill", err);
    }
  }
  return result;
}
