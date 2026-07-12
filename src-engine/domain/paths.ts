// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 章节 / 草稿文件命名与路径判据 —— 单一真相源。
 *
 * 格式（D-0014）：章号 4 位零填充、超过 4 位自然扩展（第 10000 章 = ch10000.md），
 * 所有 parse 正则必须用 \d{4,} 而非 \d{4}。此前该格式散落引擎与 UI 共 8 处手工
 * 维护并已实际漂移（回收站判据只认 4 位章号）；格式变更只允许改本文件。
 */

export const CHAPTERS_MAIN_DIR = "chapters/main";

function padChapterNum(chapter_num: number): string {
  return String(chapter_num).padStart(4, "0");
}

/** 正式章节文件名：ch0001.md */
export function chapterFilename(chapter_num: number): string {
  return `ch${padChapterNum(chapter_num)}.md`;
}

/** 从章节文件名解析章号；不匹配返回 null。 */
export function parseChapterFilename(filename: string): number | null {
  const m = filename.match(/^ch(\d{4,})\.md$/);
  return m ? Number(m[1]) : null;
}

/** AU 内正式章节相对路径：chapters/main/ch0001.md（回收站 original_path 同判据）。 */
export function chapterMainPath(chapter_num: number): string {
  return `${CHAPTERS_MAIN_DIR}/${chapterFilename(chapter_num)}`;
}

/** 从 AU 内相对路径解析正式章节章号；非正式章节路径（lore / 目录 / 草稿）返回 null。 */
export function parseChapterMainPath(path: string): number | null {
  const m = path.match(/^chapters\/main\/ch(\d{4,})\.md$/);
  if (!m) return null;
  const num = Number(m[1]);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/** 草稿文件名：ch0001_draft_A.md */
export function draftFilename(chapter_num: number, variant: string): string {
  return `ch${padChapterNum(chapter_num)}_draft_${variant}.md`;
}

/** 从草稿文件名解析章号与变体；不匹配返回 null。 */
export function parseDraftFilename(filename: string): { chapter_num: number; variant: string } | null {
  const m = filename.match(/^ch(\d{4,})_draft_(\w+)\.md$/);
  return m ? { chapter_num: Number(m[1]), variant: m[2] } : null;
}

export class DraftLabelExhaustedError extends Error {
  constructor() {
    super("草稿标签已用尽（A-Z），请先定稿或删除部分草稿");
    this.name = "DraftLabelExhaustedError";
  }
}

/**
 * 草稿变体标签分配：A-Z 顺位取第一个空闲；用尽抛 DraftLabelExhaustedError。
 * 写文路径（generation）与对话路径（simple_chat_dispatch）共用同一标签空间，
 * 分配判据必须一致，否则跨路径并发会互相覆盖草稿。
 */
export function nextDraftLabel(existingLabels: readonly string[]): string {
  const used = new Set(existingLabels);
  for (let i = 0; i < 26; i++) {
    const label = String.fromCharCode(65 + i);
    if (!used.has(label)) return label;
  }
  throw new DraftLabelExhaustedError();
}
