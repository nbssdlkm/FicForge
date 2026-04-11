// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

export interface DraftGeneratedWith {
  mode: string;
  model: string;
  temperature: number;
  top_p: number;
  input_tokens: number;
  output_tokens: number;
  char_count: number;
  duration_ms: number;
  generated_at: string;
}

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
