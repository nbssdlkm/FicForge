// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Drafts — listDrafts, getDraft, deleteDrafts.
 */

import { draftFilename, withAuLock } from "@ficforge/engine";
import { getEngine } from "./engine-instance";

export async function listDrafts(auPath: string, chapterNum: number) {
  const { draft } = getEngine().repos;
  const drafts = await draft.listByChapter(auPath, chapterNum);
  return drafts.map((d) => ({
    draft_label: d.variant,
    filename: draftFilename(d.chapter_num, d.variant),
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
    // 草稿已丢弃（get 返回 null）→ 抛错让调用方 .catch() 静默处理（与旧行为等价）
    const existing = await draft.get(auPath, chapterNum, label);
    if (!existing) throw new Error(`Draft not found: ch${chapterNum} ${label}`);
    existing.content = content;
    await draft.save(existing);
  });
}

export async function deleteDrafts(auPath: string, chapterNum: number, _label?: string) {
  const { draft } = getEngine().repos;
  return withAuLock(auPath, async () => {
    await draft.deleteByChapter(auPath, chapterNum);
    return { deleted_count: 1 };
  });
}
