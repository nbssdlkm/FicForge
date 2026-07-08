// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Trash — listTrash, restoreTrash, permanentDeleteTrash, purgeTrash.
 */

import { ApiError } from "./client";
import { getEngine } from "./engine-instance";
import { recalcState } from "./engine-state";
import type { RestoreConflictPolicy, TrashEntry } from "@ficforge/engine";
import {
  RESTORE_CONFLICT_MARKER,
  HALF_RESTORED_MARKER,
  IndexStatus,
  logCatch,
  withAuLock,
} from "@ficforge/engine";

export async function listTrash(_scope: string, path: string) {
  return getEngine().trash.list_trash(path);
}

/**
 * 章文件回收站条目的路径判据（单一真相源）：import_pipeline 移章入回收站时
 * original_path 固定为 `chapters/main/ch{NNNN}.md`（file_chapter 布局）。
 * UI（AuLoreLayout / MobileManageView 恢复回调）与本文件的恢复后生命周期共用此判据。
 */
const CHAPTER_TRASH_PATH_RE = /^chapters\/main\/ch(\d{4})\.md$/;

/** 从回收站条目解析章号；非章文件条目（lore / 目录）返回 null。 */
export function chapterNumFromTrashEntry(entry: Pick<TrashEntry, "original_path">): number | null {
  const match = CHAPTER_TRASH_PATH_RE.exec(entry.original_path);
  if (!match) return null;
  const num = Number.parseInt(match[1], 10);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/**
 * R1-5（终审 1-B）：恢复的章节文件绕过了 confirm/undo 的记忆生命周期 —— 正文不在向量
 * 索引里（或索引里是旧版本）、旧摘要可能陈旧、state 派生字段（characters_last_seen /
 * last_scene_ending）没跟上。恢复成功后补做三件事，全部 best-effort：恢复本身已成功，
 * 生命周期补挂失败只降级告警，不把已回位的文件再抛错回滚。
 */
async function applyChapterRestoreLifecycle(auPath: string, chapterNum: number): Promise<void> {
  const e = getEngine();
  // 1) 删该章摘要文件 —— 对齐编辑路径「宁缺勿旧」：恢复回来的正文 ≠ 生成摘要时的正文。
  try {
    await e.repos.chapterSummary.remove(auPath, chapterNum);
  } catch (err) {
    logCatch("trash", `Failed to invalidate summary after restore ch${chapterNum}`, err);
  }
  // 2) index_status=STALE —— 恢复正文未入向量索引，交给「重建索引」/ backfill 修复。
  try {
    await withAuLock(auPath, async () => {
      await e.repos.state.update(auPath, (st) => { st.index_status = IndexStatus.STALE; });
    });
  } catch (err) {
    logCatch("trash", `Failed to mark index STALE after restore ch${chapterNum}`, err);
  }
  // 3) recalcState —— 重算 characters_last_seen / last_scene_ending / dirty·focus 清理，
  //    让 state 派生字段与磁盘章节重新一致（M4 已有服务，内部自带 AU 锁 + ops 审计）。
  //    注：recalc_state 语义不含 current_chapter（它从不重算写作进度指针），见报告取舍说明。
  try {
    await recalcState(auPath);
  } catch (err) {
    logCatch("trash", `Failed to recalc state after restore ch${chapterNum}`, err);
  }
}

/**
 * 恢复回收站项。onConflict 默认 abort（= 历史行为）；overwrite 走「以回收站版本覆盖原位」
 * 路径（引擎侧覆盖前会在本地保留原位当前文件的备份，不无备份覆盖，见 F5）。
 * 冲突时抛 ApiError("restore_conflict")，UI 据此弹「以回收站版本恢复（覆盖当前）」按钮。
 * 恢复条目是 AU 内的章文件时，成功后补挂记忆生命周期（R1-5，见 applyChapterRestoreLifecycle）。
 */
export async function restoreTrash(
  scope: string,
  path: string,
  trashId: string,
  onConflict: RestoreConflictPolicy = "abort",
) {
  try {
    const entry = await getEngine().trash.restore(path, trashId, onConflict);
    if (scope === "au") {
      const chapterNum = chapterNumFromTrashEntry(entry);
      if (chapterNum !== null) {
        await applyChapterRestoreLifecycle(path, chapterNum);
      }
    }
  } catch (error) {
    if (
      error instanceof Error
      && (
        error.message.includes(RESTORE_CONFLICT_MARKER)
        // 旧文案兜底（无 marker 的历史 message）：单文件「无法恢复」/ 目录「restore conflict」。
        || error.message.includes("无法恢复")
        || error.message.toLowerCase().includes("restore conflict")
      )
    ) {
      throw new ApiError("restore_conflict", error.message, [], error.message);
    }
    throw error;
  }
}

export async function permanentDeleteTrash(_scope: string, path: string, trashId: string) {
  try {
    await getEngine().trash.permanent_delete(path, trashId);
  } catch (error) {
    // F5：半恢复态拒绝删除 → 映射成专用错误码，UI 提示先完成恢复（restore 支持续传 / 覆盖）。
    if (error instanceof Error && error.message.includes(HALF_RESTORED_MARKER)) {
      throw new ApiError("trash_half_restored", error.message, [], error.message);
    }
    throw error;
  }
}

export async function purgeTrash(_scope: string, path: string, maxAgeDays?: number) {
  const purged = await getEngine().trash.purge_expired(path, maxAgeDays);
  return { purged_count: purged.length };
}
