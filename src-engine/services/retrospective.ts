// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Retrospective Rewrite（M10-A，D-0041 §5）。
 *
 * 每 RETROSPECTIVE_INTERVAL 章，对目标历史章注入后续 micro 摘要作「后见之明」，
 * 重生成 standard v2，覆盖向量索引 `sum{N}`。
 *
 * 设计决策（D-0041 §5 + M10-A spec §六）：
 * - 失败一律降级，不影响主写作流程
 * - 生成在 AU 锁外（慢 LLM），promote_to_v2 写入在调用方的锁内（CAS 由调用层保证）
 * - 后续 micro 全缺时跳过，不浪费 LLM 调用
 * - promote_to_v2 幂等（standard_v1 已存在时不覆盖）
 */

import { getPrompts } from "../prompts/index.js";
import type { LLMProvider } from "../llm/provider.js";
import type { EmbeddingProvider } from "../llm/embedding_provider.js";
import type { ChapterSummaryRepository } from "../repositories/interfaces/chapter_summary.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import type { RagManager } from "./rag_manager.js";
import { logCatch } from "../logger/index.js";

/** 每 N 章触发一次 Retrospective（产品决策 Q1，已定为自动每 5 章）。 */
export const RETROSPECTIVE_INTERVAL = 5;

export interface RetrospectiveOptions {
  language?: string;
  signal?: AbortSignal;
}

/**
 * 当 chapterNum 是触发间隔的倍数，且目标章节（chapterNum - interval）≥ 1 时返回 true。
 *
 * 例：interval=5，ch=10 → target=5 ≥ 1 → true
 *     ch=5 → target=0 < 1 → false
 *     ch=7 → 7%5≠0 → false
 */
export function shouldRunRetrospective(
  chapterNum: number,
  triggerInterval: number,
): boolean {
  if (chapterNum % triggerInterval !== 0) return false;
  const targetChapterNum = chapterNum - triggerInterval;
  return targetChapterNum >= 1;
}

/**
 * 为目标章节生成「后见之明」standard v2 摘要。
 *
 * 步骤：
 * 1. 读取 targetChapterNum 章节全文（失败则跳过，不浪费 LLM）
 * 2. 读取 targetChapterNum 的 standard 摘要（作 prior_summary）
 * 3. 收集 targetChapterNum+1 ~ min(targetChapterNum+5, currentChapter-1) 的 micro 摘要
 * 4. 若 micro 全缺 → 跳过（无后见之明可用）
 * 5. 调 LLM 生成 v2
 * 6. 写 v2：summaryRepo.promote_to_v2（v1 备份 + 新 standard v2）
 * 7. 覆盖向量索引：indexChapterSummary（id=sum{N} 去重覆盖）
 *
 * 所有步骤失败均不抛出（由调用方 catch + logCatch 处理）。
 */
export async function run_retrospective(
  auPath: string,
  targetChapterNum: number,
  chapterRepo: ChapterRepository,
  summaryRepo: ChapterSummaryRepository,
  ragManager: RagManager,
  embeddingProvider: EmbeddingProvider,
  llmProvider: LLMProvider,
  currentChapter: number,
  opts?: RetrospectiveOptions,
): Promise<void> {
  const language = opts?.language ?? "zh";
  const P = getPrompts(language as "zh" | "en");

  // Step 1: 读取目标章节正文（失败则跳过）
  let chapterText: string;
  try {
    chapterText = await chapterRepo.get_content_only(auPath, targetChapterNum);
  } catch {
    // 章节不存在或读取失败 → 无法生成 → 静默跳过
    return;
  }
  if (!chapterText?.trim()) return;

  // Step 2: 读取目标章节的 prior standard 摘要（可为 null）
  let priorSummary = "";
  try {
    const summaryDoc = await summaryRepo.get(auPath, targetChapterNum);
    // 优先用 standard_v1（若已存在则是最原始版本，v1 备份已有），否则用 standard
    priorSummary = summaryDoc?.standard_v1?.text ?? summaryDoc?.standard?.text ?? "";
  } catch {
    // 读取失败视为无 prior summary（继续）
  }

  // Step 3: 收集后续章节的 micro 摘要
  const subsequentMax = Math.min(targetChapterNum + RETROSPECTIVE_INTERVAL, currentChapter - 1);
  const microLines: string[] = [];
  for (let ch = targetChapterNum + 1; ch <= subsequentMax; ch++) {
    try {
      const doc = await summaryRepo.get(auPath, ch);
      if (doc?.micro?.text) {
        microLines.push(`第 ${ch} 章：${doc.micro.text}`);
      }
    } catch {
      // 该章 micro 读取失败 → 跳过该章，不中断
    }
  }

  // Step 4: 无后续 micro → 无后见之明可用 → 跳过
  if (microLines.length === 0) return;

  // Step 5: 调 LLM 生成 v2
  const microSummaries = microLines.join("\n");
  const messages = [
    { role: "system" as const, content: P.SUMMARY_RETROSPECTIVE_SYSTEM },
    {
      role: "user" as const,
      content: P.SUMMARY_RETROSPECTIVE_USER
        .replace("{chapter_num}", String(targetChapterNum))
        .replace("{chapter_text}", chapterText)
        .replace("{prior_summary}", priorSummary || "（无原摘要）")
        .replace("{micro_summaries}", microSummaries),
    },
  ];

  let v2Text: string;
  try {
    const response = await llmProvider.generate({
      messages,
      max_tokens: 600,
      temperature: 0.4,
      top_p: 0.95,
      signal: opts?.signal,
    });
    v2Text = (response.content ?? "").trim();
  } catch (err) {
    logCatch("retrospective", `Retrospective LLM generation failed for chapter ${targetChapterNum}`, err);
    return;
  }
  if (!v2Text) return;

  // Step 6: 写 v2（promote_to_v2：备份 v1 + 写 standard v2）
  // 注意：调用方负责在 AU 锁内调用本函数之外的写锁逻辑（此处写入为 best-effort）
  try {
    // content_hash: 使用 prior summary 的 hash（v2 仍描述同一章节内容）
    const summaryDoc = await summaryRepo.get(auPath, targetChapterNum);
    const contentHash = summaryDoc?.standard?.source_chapter_hash
      ?? summaryDoc?.standard_v1?.source_chapter_hash
      ?? "";
    await summaryRepo.promote_to_v2(auPath, targetChapterNum, v2Text, contentHash);
  } catch (err) {
    logCatch("retrospective", `promote_to_v2 failed for chapter ${targetChapterNum}`, err);
    return;
  }

  // Step 7: 覆盖向量索引（id=sum{N} 去重覆盖）
  try {
    await ragManager.indexChapterSummary(auPath, targetChapterNum, v2Text, embeddingProvider);
  } catch (err) {
    // 向量索引失败不回滚 v2（v2 文本已落盘，下次 rebuild 会重新索引）
    logCatch("retrospective", `indexChapterSummary failed for chapter ${targetChapterNum} v2`, err);
  }
}
