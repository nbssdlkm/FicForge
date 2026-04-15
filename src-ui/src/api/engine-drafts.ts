// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Drafts — listDrafts, getDraft, deleteDrafts.
 */

import { createDraft } from "@ficforge/engine";
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

export async function saveDraft(auPath: string, chapterNum: number, label: string, content: string) {
  const { draft } = getEngine().repos;
  let existing;
  try {
    existing = await draft.get(auPath, chapterNum, label);
  } catch {
    // 草稿可能已被丢弃，此时 debounce 定时器仍在跑
    existing = createDraft({ au_id: auPath, chapter_num: chapterNum, variant: label });
  }
  existing.content = content;
  await draft.save(existing);
}

export async function deleteDrafts(auPath: string, chapterNum: number, _label?: string) {
  const { draft } = getEngine().repos;
  await draft.delete_by_chapter(auPath, chapterNum);
  return { deleted_count: 1 };
}
