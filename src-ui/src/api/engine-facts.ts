// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Facts — listFacts, addFact, editFact, updateFactStatus,
 *   batchUpdateFactStatus, extractFacts, extractFactsBatch, submitFactsExtraction.
 */

import {
  add_fact,
  edit_fact,
  update_fact_status,
  find_archival_candidates,
  archive_facts,
  unarchive_fact,
  FactStatus,
  resolve_llm_config,
  create_provider,
  withAuLock,
} from "@ficforge/engine";
import type { LLMProvider, ResolvedLLMConfig, Project } from "@ficforge/engine";
import { getEngine } from "./engine-instance";

// ---------------------------------------------------------------------------
// 共享 helper：LLM 配置解析（仅本文件内使用）
// ---------------------------------------------------------------------------

async function resolveFactsProvider(auPath: string): Promise<{
  provider: LLMProvider;
  llmConfig: ResolvedLLMConfig;
  proj: Project;
  lang: string;
  reactEnabled: boolean;
}> {
  const e = getEngine();
  const proj = await e.repos.project.get(auPath);
  const sett = await e.repos.settings.get();
  const llmConfig = resolve_llm_config(null, proj, sett);
  // api 和 ollama 都走 OpenAI 兼容协议，均可用。local（本地模型加载）随 sidecar 退役本版本不支持。
  if (llmConfig.mode === "local") {
    throw new Error("Facts 提取暂不支持 local 模式，请切换到 API 或 Ollama");
  }
  const provider = create_provider(llmConfig);
  const lang = sett.app?.language || "zh";
  const reactEnabled = sett.app?.react_extraction_enabled === true;
  return { provider, llmConfig, proj, lang, reactEnabled };
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
  const { fact, ops } = getEngine().repos;
  return withAuLock(auPath, async () => {
    const result = await add_fact(auPath, chapterNum, factData, fact, ops);
    return { ...result, fact_id: result.id };
  });
}

export async function editFact(auPath: string, factId: string, updatedFields: Record<string, unknown>) {
  const { fact, ops, state } = getEngine().repos;
  return withAuLock(auPath, () =>
    edit_fact(auPath, factId, updatedFields, fact, ops, state),
  );
}

export async function updateFactStatus(auPath: string, factId: string, newStatus: string, chapterNum: number) {
  const { fact, ops, state } = getEngine().repos;
  return withAuLock(auPath, () =>
    update_fact_status(auPath, factId, newStatus, chapterNum, fact, ops, state),
  );
}

export async function batchUpdateFactStatus(auPath: string, factIds: string[], newStatus: string) {
  const { fact, ops, state } = getEngine().repos;
  // 整个批次包在一次 withAuLock 内，避免每次循环释放锁后被其它操作插入导致状态撕裂
  return withAuLock(auPath, async () => {
    let updated = 0;
    let failed = 0;
    for (const fid of factIds) {
      try {
        await update_fact_status(auPath, fid, newStatus, 0, fact, ops, state);
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
  return find_archival_candidates(auPath, st.current_chapter, fact);
}

/** 归档用户在预览里确认勾选的 fact 子集（不重新扫，只动用户看过的那些）。 */
export async function archiveFacts(auPath: string, factIds: string[]) {
  const { fact, ops } = getEngine().repos;
  return withAuLock(auPath, () => archive_facts(auPath, factIds, fact, ops));
}

/** 取消归档（恢复为热/温，重新进 P3）。 */
export async function unarchiveFact(auPath: string, factId: string) {
  const { fact, ops } = getEngine().repos;
  return withAuLock(auPath, () => unarchive_fact(auPath, factId, fact, ops));
}

// ---------------------------------------------------------------------------
// 提取
// ---------------------------------------------------------------------------

export async function extractFacts(auPath: string, chapterNum: number) {
  const { extract_facts_from_chapter, reactExtractFromChapter } = await import("@ficforge/engine");
  const e = getEngine();
  const { provider, llmConfig, proj, lang, reactEnabled } = await resolveFactsProvider(auPath);
  const chapterContent = await e.repos.chapter.get_content_only(auPath, chapterNum);
  const existingFacts = await e.repos.fact.list_all(auPath);

  // M9：ReAct 增强提取（opt-in）。跑通则用其结果（含跨章 caused_by + 自动 thread_ids）。
  // 仅当 status=degraded（abort/错误/maxIter 未收尾）且空时回退单次调用——status=ok 的空
  // 结果是合法的「本章无事实」，不该再跑一次单次调用（codex 二审 MAJOR-3）。
  if (reactEnabled) {
    const { facts: reactFacts, status } = await reactExtractFromChapter(
      chapterContent, chapterNum, existingFacts,
      proj.cast_registry, null, provider,
      { language: lang as "zh" | "en", factRepo: e.repos.fact, threadRepo: e.repos.thread, auPath },
    );
    if (!(status === "degraded" && reactFacts.length === 0)) {
      return { facts: reactFacts };
    }
    // degraded + 空 → 落到下面单次调用兜底
  }

  const facts = await extract_facts_from_chapter(
    chapterContent, chapterNum, existingFacts,
    proj.cast_registry, null, provider, llmConfig,
    { language: lang },
  );
  return { facts };
}

export async function extractFactsBatch(auPath: string, chapterNums: number[]) {
  const { extract_facts_batch } = await import("@ficforge/engine");
  const e = getEngine();
  const { provider, proj, lang } = await resolveFactsProvider(auPath);
  const chapters = [];
  for (const num of chapterNums) {
    const content = await e.repos.chapter.get_content_only(auPath, num);
    chapters.push({ chapter_num: num, content });
  }
  const existingFacts = await e.repos.fact.list_all(auPath);
  const facts = await extract_facts_batch(chapters, existingFacts, proj.cast_registry, null, provider, lang);
  return { facts };
}

/**
 * 通过 TaskRunner 提交后台批量笔记提取任务。
 * 返回 taskId，UI 通过 onEvent 订阅进度。
 */
export async function submitFactsExtraction(
  auPath: string,
  fromChapter: number,
  toChapter: number,
): Promise<string> {
  const { createFactsExtractionTask } = await import("@ficforge/engine");
  const e = getEngine();
  const { provider, lang, reactEnabled } = await resolveFactsProvider(auPath);

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
    },
  );

  return e.taskRunner.submit(task);
}
