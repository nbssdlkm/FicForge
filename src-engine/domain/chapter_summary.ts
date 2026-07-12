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
  generated_at: string; // ISO 8601
  source_chapter_hash: string; // 章节 content_hash，用于陈旧检测
}

/** 单章摘要文件的内存表示。 */
export interface ChapterSummary {
  standard: SummaryTier | null;
  standard_v1?: SummaryTier; // Retrospective 前的原始版本备份（M10-A 新增）
  micro: SummaryTier | null; // 30-50 字叙事节点（M10-A 新增）
  // detailed 键预留（有消费者时再做）
}

export function createChapterSummary(partial: Partial<ChapterSummary>): ChapterSummary {
  return {
    standard: partial.standard ?? null,
    micro: partial.micro ?? null,
    ...(partial.standard_v1 !== undefined ? { standard_v1: partial.standard_v1 } : {}),
  };
}
