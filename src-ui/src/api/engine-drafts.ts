// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Drafts — listDrafts, getDraft, deleteDrafts.
 */

import { withAuLock } from "@ficforge/engine";
import { getEngine } from "./engine-instance";

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
  // AU 锁：避免与 generation 的 draft 写入 / confirmChapter 的 draft 读取交叉。
  return withAuLock(auPath, async () => {
    // get 失败说明草稿已丢弃，让异常冒泡到调用方 .catch() 静默处理
    const existing = await draft.get(auPath, chapterNum, label);
    existing.content = content;
    await draft.save(existing);
  });
}

export async function deleteDrafts(auPath: string, chapterNum: number, _label?: string) {
  const { draft } = getEngine().repos;
  return withAuLock(auPath, async () => {
    await draft.delete_by_chapter(auPath, chapterNum);
    return { deleted_count: 1 };
  });
}
