// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { apiFetch } from "./client";

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

export async function listDrafts(auPath: string, chapterNum: number): Promise<DraftListItem[]> {
  return apiFetch(
    `/api/v1/drafts?au_path=${encodeURIComponent(auPath)}&chapter_num=${chapterNum}`
  );
}

export async function getDraft(
  auPath: string,
  chapterNum: number,
  label: string
): Promise<DraftDetail> {
  return apiFetch(
    `/api/v1/drafts/${encodeURIComponent(label)}?au_path=${encodeURIComponent(auPath)}&chapter_num=${chapterNum}`
  );
}

export async function deleteDrafts(
  auPath: string,
  chapterNum: number,
  label?: string
): Promise<DeleteDraftsResult> {
  const query = new URLSearchParams({
    au_path: auPath,
    chapter_num: String(chapterNum),
  });

  if (label) query.set("label", label);

  return apiFetch(`/api/v1/drafts?${query.toString()}`, {
    method: "DELETE",
  });
}
