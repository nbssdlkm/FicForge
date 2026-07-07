// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 章节领域对象。参见 PRD §3.4 frontmatter 字段定义、§2.6.4。 */

import type { GeneratedWith } from "./generated_with.js";

export interface Chapter {
  au_id: string;
  chapter_num: number;                              // 整型，D-0014
  content: string;                                  // 正文（不含 frontmatter）

  // frontmatter 字段
  chapter_id: string;                               // 全局唯一 UUID
  revision: number;                                 // 每次覆写/确认 +1
  confirmed_focus: string[];                        // fact id 数组
  confirmed_at: string;                             // ISO 8601
  content_hash: string;                             // SHA-256，D-0011
  provenance: string;                               // 来源标记
  generated_with: GeneratedWith | null;             // 生成来源快照
}

export function createChapter(partial: Pick<Chapter, "au_id" | "chapter_num"> & Partial<Chapter>): Chapter {
  return {
    content: "",
    chapter_id: "",
    revision: 1,
    confirmed_focus: [],
    confirmed_at: "",
    content_hash: "",
    provenance: "",
    generated_with: null,
    ...partial,
  };
}

/**
 * 章节 frontmatter 的合法键集合 = 上方 Chapter 接口的「frontmatter 字段」区块，
 * 即序列化真相源 file_chapter.chapterToMeta() 写入的键（TS 引擎是唯一现行实现，
 * 历史 Python 写的也是同一套 PRD §3.4 字段）。合法章节 frontmatter 必然含其中
 * 至少一个键（实际总含 chapter_id）。
 *
 * 用途：safeMatter（domain/frontmatter.ts）以它区分「真 frontmatter」与「正文
 * 恰好以 `---\n键: 值\n---` 开头」——一个已知键都没有时整文当正文，不吃正文。
 * 消费方：file_chapter 读路径（审计 H6）、vector/chunker 剥离防御（审计 B-2）。
 * Chapter 接口 / chapterToMeta() 增删 frontmatter 字段时此集合必须同步。
 */
export const KNOWN_CHAPTER_META_KEYS: ReadonlySet<string> = new Set([
  "chapter_id",
  "revision",
  "confirmed_focus",
  "confirmed_at",
  "content_hash",
  "provenance",
  "generated_with",
]);
