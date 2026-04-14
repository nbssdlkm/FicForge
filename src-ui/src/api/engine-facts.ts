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
  FactStatus,
  resolve_llm_config,
  create_provider,
} from "@ficforge/engine";
import type { LLMProvider, ResolvedLLMConfig, Project } from "@ficforge/engine";
import { getEngine } from "./engine-client";

// ---------------------------------------------------------------------------
// 共享 helper：LLM 配置解析（仅本文件内使用）
// ---------------------------------------------------------------------------

async function resolveFactsProvider(auPath: string): Promise<{
  provider: LLMProvider;
  llmConfig: ResolvedLLMConfig;
  proj: Project;
  lang: string;
}> {
  const e = getEngine();
  const proj = await e.repos.project.get(auPath);
  const sett = await e.repos.settings.get();
  const llmConfig = resolve_llm_config(null, proj, sett);
  if (llmConfig.mode !== "api") throw new Error("Facts 提取需要 API 模式的 LLM 配置");
  const provider = create_provider(llmConfig);
  const lang = sett.app?.language || "zh";
  return { provider, llmConfig, proj, lang };
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
  const result = await add_fact(auPath, chapterNum, factData, fact, ops);
  return { ...result, fact_id: result.id };
}

export async function editFact(auPath: string, factId: string, updatedFields: Record<string, unknown>) {
  const { fact, ops, state } = getEngine().repos;
  return await edit_fact(auPath, factId, updatedFields, fact, ops, state);
}

export async function updateFactStatus(auPath: string, factId: string, newStatus: string, chapterNum: number) {
  const { fact, ops, state } = getEngine().repos;
  return await update_fact_status(auPath, factId, newStatus, chapterNum, fact, ops, state);
}

export async function batchUpdateFactStatus(auPath: string, factIds: string[], newStatus: string) {
  const { fact, ops, state } = getEngine().repos;
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
}

// ---------------------------------------------------------------------------
// 提取
// ---------------------------------------------------------------------------

export async function extractFacts(auPath: string, chapterNum: number) {
  const { extract_facts_from_chapter } = await import("@ficforge/engine");
  const e = getEngine();
  const { provider, llmConfig, proj, lang } = await resolveFactsProvider(auPath);
  const chapterContent = await e.repos.chapter.get_content_only(auPath, chapterNum);
  const existingFacts = await e.repos.fact.list_all(auPath);
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
  const { provider, lang } = await resolveFactsProvider(auPath);

  // 移动端用较小 batch size 减少内存压力和发热
  const platform = e.adapter.getPlatform();
  const batchSize = platform === "tauri" ? 3 : 2;

  const task = createFactsExtractionTask(
    { auPath, fromChapter, toChapter, batchSize, language: lang },
    {
      chapterRepo: e.repos.chapter,
      factRepo: e.repos.fact,
      projectRepo: e.repos.project,
      llmProvider: provider,
    },
  );

  return e.taskRunner.submit(task);
}
