// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Chapter Summary 生成（M8-C，D-0041 §5）。
 * 只生成 standard 档；情感保真靠 prompt 指令（对比 facts_extraction 滤情感）。
 * 失败一律返回 null 降级，绝不抛出（决策②）。
 */
import { getPrompts } from "../prompts/index.js";
import type { LLMProvider } from "../llm/provider.js";
import type { EmbeddingProvider } from "../llm/embedding_provider.js";
import type { ChapterSummaryRepository } from "../repositories/interfaces/chapter_summary.js";
import type { RagManager } from "./rag_manager.js";
import { createChapterSummary } from "../domain/chapter_summary.js";
import { now_utc } from "../repositories/implementations/file_utils.js";
import { logCatch } from "../logger/index.js";

export interface GenerateSummaryOptions {
  language?: string;
  signal?: AbortSignal;
}

export async function generate_standard_summary(
  chapter_text: string,
  chapter_num: number,
  llm_provider: LLMProvider,
  opts?: GenerateSummaryOptions,
): Promise<string | null> {
  if (!chapter_text.trim()) return null;
  const language = opts?.language ?? "zh";
  const P = getPrompts(language as "zh" | "en");

  const messages = [
    { role: "system" as const, content: P.SUMMARY_STANDARD_SYSTEM },
    {
      role: "user" as const,
      content: P.SUMMARY_STANDARD_USER
        .replace("{chapter_num}", String(chapter_num))
        .replace("{chapter_text}", chapter_text),
    },
  ];

  try {
    const response = await llm_provider.generate({
      messages,
      max_tokens: 600,
      temperature: 0.4,
      top_p: 0.95,
      signal: opts?.signal,
    });
    const text = (response.content ?? "").trim();
    return text.length > 0 ? text : null;
  } catch {
    return null; // 决策②：降级，不抛
  }
}

export interface SummaryOrchestrateDeps {
  auPath: string;
  chapterNum: number;
  chapterText: string;
  contentHash: string;
  llmProvider: LLMProvider;
  embeddingProvider: EmbeddingProvider;
  summaryRepo: ChapterSummaryRepository;
  ragManager: RagManager;
  language?: string;
  signal?: AbortSignal;
}

/**
 * 生成→存→索引；全程 best-effort，失败 log 后返回 false，绝不抛（决策②）。
 * 返回是否成功生成并落盘。
 */
export async function generate_and_index_summary(deps: SummaryOrchestrateDeps): Promise<boolean> {
  try {
    const text = await generate_standard_summary(
      deps.chapterText, deps.chapterNum, deps.llmProvider,
      { language: deps.language, signal: deps.signal },
    );
    if (!text) return false;
    const summary = createChapterSummary({
      standard: { version: 1, text, generated_at: now_utc(), source_chapter_hash: deps.contentHash },
    });
    await deps.summaryRepo.save(deps.auPath, deps.chapterNum, summary);
    await deps.ragManager.indexChapterSummary(deps.auPath, deps.chapterNum, text, deps.embeddingProvider);
    return true;
  } catch (err) {
    logCatch("summary", `Failed to generate/index summary for chapter ${deps.chapterNum}`, err);
    return false;
  }
}
