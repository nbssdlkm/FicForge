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

export async function generate_micro_summary(
  chapter_text: string,
  chapter_num: number,
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
        .replace("{chapter_num}", String(chapter_num))
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
    logCatch("summary", `Micro summary LLM generation failed for chapter ${chapter_num}`, err);
    return null;
  }
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
  } catch (err) {
    // 决策②：降级返回 null，不抛；但必须记录，避免静默吞错（codex workflow 审 MAJOR）。
    logCatch("summary", `Summary LLM generation failed for chapter ${chapter_num}`, err);
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

// ---- 批量补摘要（backfill）：给「配 embedding 之前确认、永久没摘要」的旧章补 standard 摘要。----
// 复用 confirm 同款原语（generate_standard_summary + persist_chapter_summary）。
// 只补 standard（RAG 实际消费的那档）；micro 是 M10 留位、当前无消费者，confirm 顺带生成，
// backfill 不为它多调一次 LLM。

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

export interface BackfillSummaryTarget {
  chapterNum: number;
  content: string;       // 章节正文（不含 frontmatter，= confirm 喂 LLM 的同款 get_content_only）
  contentHash: string;   // 章节 content_hash，写入 source_chapter_hash 供陈旧检测 + CAS 校验
}

export interface BackfillSummaryDeps {
  targets: BackfillSummaryTarget[];
  llmProvider: LLMProvider;
  language?: string;
  signal?: AbortSignal;
  /**
   * 文本生成后（锁外、慢）调用，由调用方在 **AU 锁内** 做 CAS（章节内容未变）+ 落盘+索引。
   * 返回 true=已落盘；false=章节中途被 edit/undo（hash 不符或已删）→ 跳过，不落陈旧摘要向量。
   * 拆出回调而非内联 persist：confirm 同款「慢 LLM 锁外 + CAS 落盘锁内」，把锁/CAS 留给 api 层（它持 repo）。
   */
  persistChapter: (target: BackfillSummaryTarget, text: string) => Promise<boolean>;
  onProgress?: (info: { done: number; total: number; chapterNum: number; ok: boolean }) => void;
}

export interface BackfillSummaryResult {
  total: number;       // 待补章节数
  generated: number;   // 成功生成 + 落盘
  failed: number;      // 生成降级返回 null，或落盘抛错（已记录、不中断整批）
  skipped: number;     // 生成成功但落盘时章节已变（CAS 拒绝）→ 不落陈旧向量，仍算「缺」，可再跑
  aborted: boolean;    // 用户中途停止（已补的保留）
}

/**
 * 逐章补 standard 摘要。慢 LLM 在锁外；每章独立 try/catch，单章失败不拖垮整批（CLAUDE.md 半成功处理）。
 *
 * 中断语义：每章开头查 signal → 立即停（当前章已开跑的让它跑完，下一章不再起），已补的全部保留。
 * 不把 signal 传给 generate —— generate 内部 catch 一切错误返回 null，传了反而会把「中途取消」误记成
 * failed；在章边界停更干净，单章 LLM 也就几秒。
 *
 * CAS：落盘走 persistChapter 回调，调用方在 AU 锁内校验章节 content_hash 未变才写。这关掉「批量跑了一分钟，
 * 期间用户 edit/undo 某章 → 基于旧内容的摘要向量被写进 RAG，而 edit 的失效只删了摘要文件没删向量 →
 * 后续续写检索到陈旧摘要」的竞态（codex 审 P1）。hash 变了就 skipped，留给下次再跑。
 */
export async function backfill_chapter_summaries(deps: BackfillSummaryDeps): Promise<BackfillSummaryResult> {
  const total = deps.targets.length;
  let generated = 0;
  let failed = 0;
  let skipped = 0;
  for (let i = 0; i < total; i++) {
    if (deps.signal?.aborted) return { total, generated, failed, skipped, aborted: true };
    const target = deps.targets[i];
    let ok = false;
    try {
      const text = await generate_standard_summary(target.content, target.chapterNum, deps.llmProvider, {
        language: deps.language,
      });
      if (text) {
        const persisted = await deps.persistChapter(target, text);
        if (persisted) {
          ok = true;
          generated++;
        } else {
          skipped++; // 章节中途被改/删，CAS 拒绝 → 不落陈旧向量
        }
      } else {
        failed++; // 生成降级返回 null（generate_standard_summary 内部已 logCatch）
      }
    } catch (err) {
      logCatch("summary", `Backfill summary failed for chapter ${target.chapterNum}`, err);
      failed++;
    }
    deps.onProgress?.({ done: i + 1, total, chapterNum: target.chapterNum, ok });
  }
  return { total, generated, failed, skipped, aborted: false };
}
