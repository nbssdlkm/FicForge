// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Chapters — listChapters, getChapter, getChapterContent,
 *   confirmChapter, undoChapter, updateChapterTitle,
 *   resolveDirtyChapter, updateChapterContent.
 */

import {
  confirmChapterWithMemory,
  undoChapterWithMemory,
  resolveDirtyChapter as engineResolveDirtyChapter,
  editChapterContent,
  chapterInflightKey,
  isChapterInflight,
  IndexStatus,
  resolveLlmConfig,
  createProvider,
  generateStandardSummary,
  persistChapterSummary,
  findChaptersMissingSummary,
  addFact,
  backfillChapterMemory as engineBackfillChapterMemory,
  type BackfillMemoryTarget,
  type BackfillMemoryResult,
  createOpsEntry,
  generateOpId,
  logCatch,
  nowUtc,
  WriteTransaction,
  withAuLock,
  type EmbeddingProvider,
  type GeneratedWith,
  type LLMProvider,
  type FactChange,
} from "@ficforge/engine";
import { logUiError } from "../utils/ui-logger";
import { ApiError, getFriendlyErrorMessage } from "./client";
import { getEngine, getProjectOrThrow } from "./engine-instance";
import { resolveLang } from "./resolve-lang";
import { createEmbeddingProvider } from "./engine-state";
import { extractFacts } from "./engine-facts";
import { buildFactDataFromCandidate, type ExtractedFactCandidate } from "./facts";

export async function listChapters(auPath: string) {
  const { chapter, state } = getEngine().repos;
  const chapters = await chapter.listMain(auPath);
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
  return await chapter.getContentOnly(auPath, chapterNum);
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
  const { chapter, draft, state, ops, chapterSummary, settings } = e.repos;
  const proj = await getProjectOrThrow(auPath);
  // E8：别名表供 scanCharactersInChapter 归一化 —— 正文只出现别名时 characters_last_seen 记主名，
  // 与提取/RAG 侧共用同一张表。get 异步且永不抛错（无角色卡 → null，扫描逐字节回退现状）。
  const characterAliases = await e.characterAliases.get(auPath);
  // 记忆层 provider 由 UI 从 settings/project 构建后注入引擎编排服务（M1 下沉）。settings 读取
  // 与 provider 构建整段纳入 best-effort 降级：任一失败 → language/providers 落安全默认，引擎
  // 服务对应分支整段跳过（等价原实现里标题/索引/摘要/回望各自 try 吞错后跳过生成），核心 confirm
  // 仍先行、绝不阻断确认本身。**审阅整改（ultracode R1）**：settings.get 原在核心 confirm 之后
  // （坏了章节已存但报错）；把它收进 try 降级 —— 损坏的全局 settings.yaml 不再阻断用户写作保存，
  // 恢复「settings 坏也不挡写作」的 best-effort（正常路径 language/providers 逐字节不变）。
  let language = "zh";
  let embProvider: EmbeddingProvider | null = null;
  let llmProvider: LLMProvider | null = null;
  try {
    const sett = await settings.get();
    language = resolveLang(sett);
    embProvider = createEmbeddingProvider(sett, proj) ?? null;
    const llmCfg = resolveLlmConfig(null, proj, sett);
    // llm_provider 非 null ⇔ 原 canGen：api 有 key / ollama（key 可空，引擎填 dummy）。
    const canGen = llmCfg.mode === "ollama" || (llmCfg.mode === "api" && !!llmCfg.api_key);
    llmProvider = canGen ? createProvider(llmCfg) : null;
  } catch (err) {
    logUiError("engine-chapters", "读取设置或构建记忆层 provider 失败，记忆栈降级跳过", err);
  }

  return confirmChapterWithMemory({
    au_id: auPath,
    chapter_num: chapterNum,
    draft_id: draftId,
    generated_with: generatedWith as GeneratedWith | undefined,
    cast_registry: proj.cast_registry,
    character_aliases: characterAliases,
    content_override: content,
    chapter_repo: chapter,
    draft_repo: draft,
    state_repo: state,
    ops_repo: ops,
    chapter_summary_repo: chapterSummary,
    rag_manager: e.ragManager,
    embedding_provider: embProvider,
    llm_provider: llmProvider,
    language,
    title,
  });
}

export async function undoChapter(auPath: string) {
  const e = getEngine();
  const { chapter, draft, state, ops, fact, chapterSummary } = e.repos;
  const proj = await getProjectOrThrow(auPath);
  // E8：别名表供 undo 的 characters_last_seen 回滚 —— 快照缺失走全量重扫时（rebuildCharactersLastSeen）
  // 别名归一化记主名，与 confirm 侧同源。get 永不抛错（无角色卡 → null，重扫逐字节回退现状）。
  const characterAliases = await e.characterAliases.get(auPath);
  return undoChapterWithMemory({
    au_id: auPath,
    cast_registry: proj.cast_registry,
    character_aliases: characterAliases,
    chapter_repo: chapter,
    draft_repo: draft,
    state_repo: state,
    ops_repo: ops,
    fact_repo: fact,
    chapter_summary_repo: chapterSummary,
    rag_manager: e.ragManager,
  });
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
        op_id: generateOpId(),
        op_type: "set_chapter_title",
        target_id: auPath,
        chapter_num: chapterNum,
        timestamp: nowUtc(),
        payload: { title },
      }),
    );
    tx.setState(st);
    await tx.commit(ops, null, state);
    return { chapter_num: chapterNum, title };
  });
}

export async function resolveDirtyChapter(auPath: string, chapterNum: number, confirmedFactChanges: FactChange[] = []) {
  const e = getEngine();
  const { chapter, state, ops, fact } = e.repos;
  const proj = await getProjectOrThrow(auPath);
  // E8：脏章重解析同样重扫正文更新 characters_last_seen（resolveDirtyChapter 内部走
  // scanCharactersInChapter）—— 别名归一化记主名，与 confirm/undo 同源一致。get 永不抛错。
  const characterAliases = await e.characterAliases.get(auPath);
  return await engineResolveDirtyChapter({
    au_id: auPath,
    chapter_num: chapterNum,
    confirmed_fact_changes: confirmedFactChanges,
    cast_registry: proj.cast_registry,
    character_aliases: characterAliases,
    chapter_repo: chapter,
    state_repo: state,
    ops_repo: ops,
    fact_repo: fact,
  });
}

export async function updateChapterContent(auPath: string, chapterNum: number, content: string) {
  const e = getEngine();
  const { chapter, state, ops, chapterSummary, settings } = e.repos;
  // H9b：记录编辑前的 index_status（editChapterContent 会置 STALE）。
  // 重索引成功后是否恢复 READY 取决于编辑前索引是否本就完整（与 confirm 的 M1a 同口径）。
  let preEditIndexStatus: IndexStatus | null = null;
  try {
    preEditIndexStatus = (await state.get(auPath)).index_status;
  } catch {
    // 读不到就不恢复，保持 edit 服务置下的 STALE
  }
  // editChapterContent 属于"底层 service"，本身不加锁（避免被 dirty_resolve
  // 等已持锁的 orchestrator 调用时死锁）。UI 直接调用路径必须在此顶层加锁。
  const result = await withAuLock(auPath, () => editChapterContent(auPath, chapterNum, content, chapter, state, ops));
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
      const chContent = await chapter.getContentOnly(auPath, chapterNum);
      // TD-020：别名表串入 chunker（与 confirm 侧同源；get 永不抛错，无卡 → null 回退现状）
      const characterAliases = await e.characterAliases.get(auPath);
      await e.ragManager.indexChapter(auPath, chapterNum, chContent, embProvider, proj.cast_registry, characterAliases);
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
// 摘要/向量自动补缺；笔记只对用户勾选的章提取（自动落库）。复用 backfillChapterMemory 引擎服务
// （loop/中断/CAS/半成功）+ 现成原语（generateStandardSummary / extractFacts / addFact /
// persistChapterSummary / indexChapter），不重写逻辑。

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
  const llmCfg = resolveLlmConfig(null, proj, sett);
  const chapters = await chapter.listMain(auPath);
  const nums = chapters.map((c) => c.chapter_num);

  const chaptersMissingSummary = await findChaptersMissingSummary(auPath, nums, chapterSummary);

  const allFacts = await fact.listAll(auPath);
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
  const llmCfg = resolveLlmConfig(null, proj, sett);
  const llmConfigured = llmCfg.mode === "ollama" || (llmCfg.mode === "api" && !!llmCfg.api_key);
  if (!embProvider || !llmConfigured) {
    throw new Error("embedding and LLM must be configured to backfill chapter memory");
  }
  const llmProvider = createProvider(llmCfg);
  const language = resolveLang(sett);
  // 别名表快照（整个 backfill 共用）：提取端（extractFacts 内部）已归一化，落库端再挂一道
  // 是与 addFactsBatch 同款的纵深防御——覆盖「提取后、落库前别名表被改」的窗口。
  const characterAliases = await e.characterAliases.get(auPath);

  const chapters = await chapter.listMain(auPath);
  const byNum = new Map(chapters.map((c) => [c.chapter_num, c]));
  const nums = [...byNum.keys()];
  const missingSummary = new Set(await findChaptersMissingSummary(auPath, nums, chapterSummary));
  const factsSet = new Set(opts.factsChapters);

  // in-scope = 缺摘要章 ∪ 勾选提笔记章；这些章顺带把正文进向量索引。
  const inScope = nums.filter((n) => missingSummary.has(n) || factsSet.has(n)).sort((a, b) => a - b);

  const targets: BackfillMemoryTarget[] = [];
  for (const n of inScope) {
    const ch = byNum.get(n);
    if (!ch) continue;
    const content = await chapter.getContentOnly(auPath, n);
    targets.push({
      chapterNum: n,
      content,
      contentHash: ch.content_hash,
      needSummary: missingSummary.has(n),
      extractFacts: factsSet.has(n),
    });
  }

  const result = await engineBackfillChapterMemory({
    targets,
    signal,
    // 慢 LLM，锁外。signal 透传 → 用户点停时在飞的摘要/提取请求被立刻取消（审计⑨）。
    generateSummary: (t) => generateStandardSummary(t.content, t.chapterNum, llmProvider, { language, signal }),
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
            await persistChapterSummary({
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
            await addFact(
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
          // TD-020：backfill 的别名快照同供 chunker（与提取/落库侧同一张表）
          await e.ragManager.indexChapter(
            auPath,
            t.chapterNum,
            t.content,
            embProvider,
            proj.cast_registry,
            characterAliases,
            signal,
          );
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
