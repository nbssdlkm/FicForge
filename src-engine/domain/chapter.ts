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
