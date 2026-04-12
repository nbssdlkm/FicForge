// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Drafts — listDrafts, getDraft, deleteDrafts.
 */

import { getEngine } from "./engine-client";

export async function listDrafts(auPath: string, chapterNum: number) {
  const { draft } = getEngine().repos;
  const drafts = await draft.list_by_chapter(auPath, chapterNum);
  return drafts.map((d) => ({
    draft_label: d.variant,
    filename: `ch${String(d.chapter_num).padStart(4, "0")}_draft_${d.variant}.md`,
  }));
}

export async function getDraft(auPath: string, chapterNum: number, label: string) {
  const { draft } = getEngine().repos;
  return await draft.get(auPath, chapterNum, label);
}

export async function deleteDrafts(auPath: string, chapterNum: number, _label?: string) {
  const { draft } = getEngine().repos;
  await draft.delete_by_chapter(auPath, chapterNum);
  return { deleted_count: 1 };
}
