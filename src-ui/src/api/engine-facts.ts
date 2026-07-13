// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Facts — listFacts, addFact, editFact, updateFactStatus,
 *   batchUpdateFactStatus, extractFacts, extractFactsBatch, submitFactsExtraction.
 */

import {
  addFact as engineAddFact,
  editFact as engineEditFact,
  updateFactStatus as engineUpdateFactStatus,
  findArchivalCandidates as engineFindArchivalCandidates,
  archiveFacts as engineArchiveFacts,
  unarchiveFact as engineUnarchiveFact,
  type FactStatus,
  isReactExtractionEnabled,
  resolveLlmConfig,
  createProvider,
  withAuLock,
} from "@ficforge/engine";
import type { LLMProvider, ResolvedLLMConfig, Project } from "@ficforge/engine";
import { getEngine, getProjectOrThrow } from "./engine-instance";
import { resolveLang } from "./resolve-lang";
import { hasUsableConnection } from "./engine-settings";

// ---------------------------------------------------------------------------
// 共享 helper：LLM 配置解析（仅本文件内使用）
// ---------------------------------------------------------------------------

export async function resolveFactsProvider(auPath: string): Promise<{
  provider: LLMProvider;
  llmConfig: ResolvedLLMConfig;
  proj: Project;
  lang: string;
  reactEnabled: boolean;
}> {
  const e = getEngine();
  const proj = await getProjectOrThrow(auPath);
  const sett = await e.repos.settings.get();
  const llmConfig = resolveLlmConfig(null, proj, sett);
  // api 和 ollama 都走 OpenAI 兼容协议，均可用。local（本地模型加载）随 sidecar 退役本版本不支持。
  if (llmConfig.mode === "local") {
    throw new Error("Facts 提取暂不支持 local 模式，请切换到 API 或 Ollama");
  }
  const provider = createProvider(llmConfig);
  const lang = resolveLang(sett);
  // 判据单源（R3 低危清扫）：此前这里 `=== true` 与其余消费点 `!== false` 分叉。
  const reactEnabled = isReactExtractionEnabled(sett.app);
  return { provider, llmConfig, proj, lang, reactEnabled };
}

/**
 * 当前 AU 的事实提取是否有可用 LLM 连接。与 resolveFactsProvider 同源
 * （resolveLlmConfig 优先级 session>project>default_llm + api_key 回填），
 * 供 SimpleChatPanel 对话自动提取 gate 使用——修正「gate 只看全局 default_llm」
 * 与「实际提取用 project 级解析」两处口径漂移导致 AU 独立配 LLM 时自动提取被
 * 静默跳过的问题（审计④）。判据复用 engine-settings.hasUsableConnection（单一真相源）。
 */
export async function getFactsExtractionReadiness(auPath: string): Promise<{ has_usable_connection: boolean }> {
  const e = getEngine();
  const proj = await getProjectOrThrow(auPath);
  const sett = await e.repos.settings.get();
  const llmConfig = resolveLlmConfig(null, proj, sett);
  return { has_usable_connection: hasUsableConnection(llmConfig) };
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listFacts(auPath: string, status?: string) {
  const { fact } = getEngine().repos;
  if (status) {
    return await fact.list_by_status(auPath, status as FactStatus);
  }
  return await fact.list_all(auPath);
}

export async function addFact(auPath: string, chapterNum: number, factData: Record<string, unknown>) {
  const e = getEngine();
  const { fact, ops } = e.repos;
  // 别名表接通：落库前 characters / known_to / hidden_from 按角色卡别名归一化
  //（get 永不抛错，无卡/读失败降级 null = 不归一化，不阻塞主流程；下同）。
  const characterAliases = await e.characterAliases.get(auPath);
  return withAuLock(auPath, async () => {
    const result = await engineAddFact(auPath, chapterNum, factData, fact, ops, "manual", characterAliases);
    return { ...result, fact_id: result.id };
  });
}

// ---------------------------------------------------------------------------
// 批量落库（交互式接受提取事实）—— 单锁 + 逐章存在性 CAS
// ---------------------------------------------------------------------------

export interface BatchFactInput {
  chapterNum: number;
  data: Record<string, unknown>;
}

export interface AddFactsBatchResult {
  /** 成功写入的条数（= writtenIndices.length）。 */
  added: number;
  /** 因目标章已被并发 undo 删除而跳过的条数（不写孤儿事实）。 */
  skipped: number;
  /**
   * 实际落盘的**输入下标**（升序，指向传入的 `facts`）。调用方据此精确登记「哪几条已存」
   * 做半成功去重——不靠 `slice(0, added)` 反推前缀（混章批次里 skip 与 add 交错，added
   * 计数不等于前缀，对抗审发现 3）。
   */
  writtenIndices: number[];
}

/**
 * 半成功错误：批量落库过程中某条 addFact 抛错（磁盘/序列化）时抛出，携带此前已成功
 * 落盘的输入下标，供调用方登记已存部分、重试只补余下（M25 半成功去重）。
 */
export class PartialAddFactsError extends Error {
  constructor(
    public readonly writtenIndices: number[],
    public readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "PartialAddFactsError";
  }
  /** 已成功落盘的条数。 */
  get added(): number {
    return this.writtenIndices.length;
  }
}

/**
 * 批量把「接受的提取事实」落库——整批在**一次** withAuLock 内完成，取代调用方逐条 addFact
 * （每条各自加锁、锁间隙可被并发 undo 插入：撤销目标章后剩余几条仍写向已撤销章 = 孤儿事实，
 * 第三轮审计 MED-1）。与 backfill 同款「单锁 + 章节存在性 CAS」：进锁后按章缓存存在性
 * （`chapter.exists`），目标章缺失（被并发 undo 删）→ 该章的候选整体跳过、不落孤儿。
 *
 * 顺序处理，返回实际落盘的输入下标（`writtenIndices`）供精确去重。
 * 某条 addFact 抛错 → 抛 {@link PartialAddFactsError}（携已落盘下标），整批不再续写。
 */
export async function addFactsBatch(auPath: string, facts: BatchFactInput[]): Promise<AddFactsBatchResult> {
  const e = getEngine();
  const { fact, ops, chapter } = e.repos;
  // 整批共用一份别名表快照（提取端已归一化过，此处是纵深防御 + 覆盖「提取后又改了别名」的窗口）
  const characterAliases = await e.characterAliases.get(auPath);
  return withAuLock(auPath, async () => {
    const existsCache = new Map<number, boolean>();
    const chapterExists = async (n: number): Promise<boolean> => {
      const cached = existsCache.get(n);
      if (cached !== undefined) return cached;
      const ok = await chapter.exists(auPath, n);
      existsCache.set(n, ok);
      return ok;
    };

    const writtenIndices: number[] = [];
    let skipped = 0;
    for (let i = 0; i < facts.length; i++) {
      const f = facts[i];
      if (!(await chapterExists(f.chapterNum))) {
        skipped += 1; // 目标章被并发 undo 删除 → 跳过，不写孤儿事实
        continue;
      }
      try {
        await engineAddFact(auPath, f.chapterNum, f.data, fact, ops, "manual", characterAliases);
        writtenIndices.push(i);
      } catch (err) {
        throw new PartialAddFactsError(writtenIndices, err);
      }
    }
    return { added: writtenIndices.length, skipped, writtenIndices };
  });
}

export async function editFact(auPath: string, factId: string, updatedFields: Record<string, unknown>) {
  const e = getEngine();
  const { fact, ops, state } = e.repos;
  // 别名表接通：编辑 characters / known_to / hidden_from 时按角色卡别名归一化
  const characterAliases = await e.characterAliases.get(auPath);
  return withAuLock(auPath, () => engineEditFact(auPath, factId, updatedFields, fact, ops, state, characterAliases));
}

export async function updateFactStatus(auPath: string, factId: string, newStatus: string, chapterNum: number) {
  const { fact, ops, state } = getEngine().repos;
  return withAuLock(auPath, () => engineUpdateFactStatus(auPath, factId, newStatus, chapterNum, fact, ops, state));
}

export async function batchUpdateFactStatus(auPath: string, factIds: string[], newStatus: string) {
  const { fact, ops, state } = getEngine().repos;
  // 整个批次包在一次 withAuLock 内，避免每次循环释放锁后被其它操作插入导致状态撕裂
  return withAuLock(auPath, async () => {
    let updated = 0;
    let failed = 0;
    for (const fid of factIds) {
      try {
        await engineUpdateFactStatus(auPath, fid, newStatus, 0, fact, ops, state);
        updated++;
      } catch {
        failed++;
      }
    }
    return { updated, failed };
  });
}

// ---------------------------------------------------------------------------
// 冷热分层（M10-B）：旧的低权重 fact 固化为「冷」→ 不再注入生成 P3，省预算。
// Q4 用户确认流：findArchivalCandidates（只读预览）→ 用户勾选 → archiveFacts（归档子集）。
// unarchiveFact 提供反悔/恢复（fact 是用户资产，归档须可逆）。
// ---------------------------------------------------------------------------

/** 只读：扫出可固化的冷候选 fact（距当前章 ≥10 + 低权重 + active/unresolved + 未归档）。 */
export async function findArchivalCandidates(auPath: string) {
  const { fact, state } = getEngine().repos;
  const st = await state.get(auPath);
  return engineFindArchivalCandidates(auPath, st.current_chapter, fact);
}

/** 归档用户在预览里确认勾选的 fact 子集（不重新扫，只动用户看过的那些）。 */
export async function archiveFacts(auPath: string, factIds: string[]) {
  const { fact, ops } = getEngine().repos;
  return withAuLock(auPath, () => engineArchiveFacts(auPath, factIds, fact, ops));
}

/** 取消归档（恢复为热/温，重新进 P3）。 */
export async function unarchiveFact(auPath: string, factId: string) {
  const { fact, ops } = getEngine().repos;
  return withAuLock(auPath, () => engineUnarchiveFact(auPath, factId, fact, ops));
}

// ---------------------------------------------------------------------------
// 提取
// ---------------------------------------------------------------------------

export async function extractFacts(auPath: string, chapterNum: number, opts?: { signal?: AbortSignal }) {
  const { extractFactsFromChapter, reactExtractFromChapter } = await import("@ficforge/engine");
  const e = getEngine();
  const { provider, llmConfig, proj, lang, reactEnabled } = await resolveFactsProvider(auPath);
  const chapterContent = await e.repos.chapter.get_content_only(auPath, chapterNum);
  const existingFacts = await e.repos.fact.list_all(auPath);
  // 别名表接通：提取 prompt 渲染【已知角色名和别名】段 + rawToExtracted 归一化。
  // backfill（补全旧章记忆）逐章走本函数，自动同享。
  const characterAliases = await e.characterAliases.get(auPath);

  // M9：ReAct 增强提取（opt-in）。跑通则用其结果（含跨章 caused_by + 自动 thread_ids）。
  // 仅当 status=degraded（abort/错误/maxIter 未收尾）且空时回退单次调用——status=ok 的空
  // 结果是合法的「本章无事实」，不该再跑一次单次调用（codex 二审 MAJOR-3）。
  // signal 透传给慢 LLM（审计⑨：backfill 点停时立刻取消在飞的提取请求，不空跑到完成）。
  if (reactEnabled) {
    const {
      facts: reactFacts,
      status,
      cappedCount,
    } = await reactExtractFromChapter(
      chapterContent,
      chapterNum,
      existingFacts,
      proj.cast_registry,
      characterAliases,
      provider,
      {
        language: lang as "zh" | "en",
        factRepo: e.repos.fact,
        threadRepo: e.repos.thread,
        auPath,
        signal: opts?.signal,
      },
    );
    if (!(status === "degraded" && reactFacts.length === 0)) {
      // L16：透传软上限丢弃数（backfill 据此提示用户某章命中上限、部分笔记未收）。
      return { facts: reactFacts, cappedCount };
    }
    // degraded + 空 → 落到下面单次调用兜底
  }

  // 单次调用路径无软上限概念（不截断），cappedCount=0。
  const facts = await extractFactsFromChapter(
    chapterContent,
    chapterNum,
    existingFacts,
    proj.cast_registry,
    characterAliases,
    provider,
    llmConfig,
    { language: lang, signal: opts?.signal },
  );
  return { facts, cappedCount: 0 };
}

/**
 * 通过 TaskRunner 提交后台批量笔记提取任务。
 * 返回 taskId，UI 通过 onEvent 订阅进度。
 */
export async function submitFactsExtraction(auPath: string, fromChapter: number, toChapter: number): Promise<string> {
  const { createFactsExtractionTask } = await import("@ficforge/engine");
  const e = getEngine();
  const { provider, lang, reactEnabled } = await resolveFactsProvider(auPath);
  // 别名表快照：整个批量任务共用（长任务中途改别名不追新，与提交时语义一致）
  const characterAliases = await e.characterAliases.get(auPath);

  // 移动端用较小 batch size 减少内存压力和发热
  const platform = e.adapter.getPlatform();
  const batchSize = platform === "tauri" ? 3 : 2;

  const task = createFactsExtractionTask(
    { auPath, fromChapter, toChapter, batchSize, language: lang, reactExtractionEnabled: reactEnabled },
    {
      chapterRepo: e.repos.chapter,
      factRepo: e.repos.fact,
      projectRepo: e.repos.project,
      llmProvider: provider,
      threadRepo: e.repos.thread,
      characterAliases,
    },
  );

  return e.taskRunner.submit(task);
}
