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

export interface PersistSummaryDeps {
  auPath: string;
  chapterNum: number;
  text: string;
  contentHash: string;
  embeddingProvider: EmbeddingProvider;
  summaryRepo: ChapterSummaryRepository;
  ragManager: RagManager;
}

/**
 * 落盘 + 索引一条【已生成】的摘要。
 *
 * - **index 先于 save**：超长摘要被 embedding 拒会先在 index 抛出，从而不落下脏的
 *   .summary.jsonl（否则后续 rebuild 反复读它再抛 — codex 对抗审 BLOCKER）。
 * - 不在此 try/catch、不加锁：生成在锁外（慢 LLM），调用方负责把本函数 + 章节存在性
 *   CAS 一起放进 withAuLock，避免并发 undo/edit 后把过期摘要写回（codex 对抗审 race）。
 */
export async function persist_chapter_summary(deps: PersistSummaryDeps): Promise<void> {
  await deps.ragManager.indexChapterSummary(deps.auPath, deps.chapterNum, deps.text, deps.embeddingProvider);
  const summary = createChapterSummary({
    standard: { version: 1, text: deps.text, generated_at: now_utc(), source_chapter_hash: deps.contentHash },
  });
  await deps.summaryRepo.save(deps.auPath, deps.chapterNum, summary);
}
