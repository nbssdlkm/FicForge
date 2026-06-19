// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Chapter Summary 数据模型（M8-C，D-0041 §5）。
 *
 * 本轮只生成 standard 一档；micro/detailed 键预留（D-0041 设计），不生成不读。
 * 存储于 chapters/main/ch{NNNN}.summary.jsonl（单个 JSON 对象，每章一条）。
 */

/** 单档摘要。 */
export interface SummaryTier {
  version: number;
  text: string;
  generated_at: string;        // ISO 8601
  source_chapter_hash: string; // 章节 content_hash，用于陈旧检测
}

/** 单章摘要文件的内存表示。 */
export interface ChapterSummary {
  standard: SummaryTier | null;
  // micro / detailed 键预留（M8-C 不生成）
}

export function createChapterSummary(partial: Partial<ChapterSummary>): ChapterSummary {
  return { standard: partial.standard ?? null };
}
