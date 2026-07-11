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
import { now_utc } from "../utils/file_utils.js";
import { logCatch } from "../logger/index.js";

export interface GenerateSummaryOptions {
  language?: string;
  signal?: AbortSignal;
}

export async function generate_micro_summary(
  chapter_text: string,
  chapterNum: number,
  llm_provider: LLMProvider,
  opts?: GenerateSummaryOptions,
): Promise<string | null> {
  if (!chapter_text.trim()) return null;
  const language = opts?.language ?? "zh";
  const P = getPrompts(language as "zh" | "en");

  const messages = [
    { role: "system" as const, content: P.SUMMARY_MICRO_SYSTEM },
    {
      role: "user" as const,
      content: P.SUMMARY_MICRO_USER
        .replace("{chapter_num}", String(chapterNum))
        .replace("{chapter_text}", chapter_text),
    },
  ];

  try {
    const response = await llm_provider.generate({
      messages,
      max_tokens: 150,   // micro 短文本，150 token 上限足够 50 字
      temperature: 0.4,
      top_p: 0.95,
      signal: opts?.signal,
    });
    const text = (response.content ?? "").trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    // 与 standard 相同的降级策略：失败返回 null，不抛（决策②）
    logCatch("summary", `Micro summary LLM generation failed for chapter ${chapterNum}`, err);
    return null;
  }
}

export async function generate_standard_summary(
  chapter_text: string,
  chapterNum: number,
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
        .replace("{chapter_num}", String(chapterNum))
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
  } catch (err) {
    // 决策②：降级返回 null，不抛；但必须记录，避免静默吞错（codex workflow 审 MAJOR）。
    logCatch("summary", `Summary LLM generation failed for chapter ${chapterNum}`, err);
    return null;
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
  /** 外部取消（backfill 点停）：透传给摘要向量化，取消时立即中止在飞 embed。 */
  signal?: AbortSignal;
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
  await deps.ragManager.indexChapterSummary(deps.auPath, deps.chapterNum, deps.text, deps.embeddingProvider, deps.signal);
  // 合并写而非整档重写（审计 M2）：confirm 时 standard 失败/micro 成功会留下 micro-only 文件，
  // backfill 判「缺摘要」后走到这里 —— 整档 createChapterSummary({standard}) 会把 micro 抹掉，
  // 而 micro 没有补生成路径 → retrospective 输入永久缺章。对齐 update_micro / promote_to_v2
  // 的 `...existing` 合并语义：保留 micro / standard_v1 等既有字段，只更新 standard。
  const existing = (await deps.summaryRepo.get(deps.auPath, deps.chapterNum)) ?? createChapterSummary({});
  const summary = {
    ...existing,
    standard: { version: 1, text: deps.text, generated_at: now_utc(), source_chapter_hash: deps.contentHash },
  };
  await deps.summaryRepo.save(deps.auPath, deps.chapterNum, summary);
}

// ---- 批量补摘要（backfill）：给「配 embedding 之前确认、永久没摘要」的旧章补 standard 摘要。----
// 复用 confirm 同款原语（generate_standard_summary + persist_chapter_summary）。
// 只补 standard（RAG 实际消费的那档）；micro 由 retrospective 消费（每 N 章注入后续 micro
// 作「后见之明」重写 standard v2），confirm 顺带生成，backfill 不为它多调一次 LLM。

/**
 * 找出「缺 standard 摘要」的章节号。
 * 单一真相源：count 预览（给用户看数量）与 backfill 实跑共用此判据，避免两处对「缺摘要」定义漂移。
 */
export async function find_chapters_missing_summary(
  auPath: string,
  chapterNums: number[],
  summaryRepo: ChapterSummaryRepository,
): Promise<number[]> {
  const missing: number[] = [];
  for (const n of chapterNums) {
    const existing = await summaryRepo.get(auPath, n);
    if (!existing?.standard?.text?.trim()) missing.push(n);
  }
  return missing;
}

// 注：原 backfill_chapter_summaries（批量补 standard 摘要）已退役 —— 被「补全旧章记忆」
// 统一 pass（services/backfill_memory.ts）取代，摘要是其子集。find_chapters_missing_summary
// 作为「缺摘要」的单一真相源判据保留，供 scanChapterMemory / backfillChapterMemory 复用。
