// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import type { GeneratedWith } from "@ficforge/engine";

/**
 * 引擎 GeneratedWith 的 UI 侧别名（R4 重复维 M6：此前逐字段手抄一份，引擎新增字段会被静默丢）。
 * 字段清单的真相源在引擎 domain/generated_with.ts，此处只保留既有导出名。
 */
export type DraftGeneratedWith = GeneratedWith;

export interface DraftListItem {
  draft_label: string;
  filename: string;
}

export interface DraftDetail {
  au_id: string;
  chapter_num: number;
  variant: string;
  content: string;
  generated_with?: DraftGeneratedWith | null;
}

export interface DeleteDraftsResult {
  deleted_count: number;
}
