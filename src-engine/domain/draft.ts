// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 草稿领域对象。参见 PRD §2.6.2。 */

import type { GeneratedWith } from "./generated_with.js";

export interface Draft {
  au_id: string;
  chapter_num: number;           // 整型，D-0014
  variant: string;               // 草稿变体标识，如 "A", "B", "C"
  content: string;               // 正文
  generated_with: GeneratedWith | null;
}

export function createDraft(partial: Pick<Draft, "au_id" | "chapter_num" | "variant"> & Partial<Draft>): Draft {
  return {
    content: "",
    generated_with: null,
    ...partial,
  };
}
