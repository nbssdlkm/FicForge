// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Trash — listTrash, restoreTrash, permanentDeleteTrash, purgeTrash.
 */

import { ApiError } from "./client";
import { getEngine } from "./engine-instance";
import type { RestoreConflictPolicy } from "@ficforge/engine";
import { RESTORE_CONFLICT_MARKER, HALF_RESTORED_MARKER } from "@ficforge/engine";

export async function listTrash(_scope: string, path: string) {
  return getEngine().trash.list_trash(path);
}

/**
 * 恢复回收站项。onConflict 默认 abort（= 历史行为）；overwrite 走「以回收站版本覆盖原位」
 * 路径（引擎侧覆盖前会把原位当前文件备份进条目 sidecar，不无备份覆盖，见 F5）。
 * 冲突时抛 ApiError("restore_conflict")，UI 据此弹「以回收站版本恢复（覆盖当前）」按钮。
 */
export async function restoreTrash(
  _scope: string,
  path: string,
  trashId: string,
  onConflict: RestoreConflictPolicy = "abort",
) {
  try {
    await getEngine().trash.restore(path, trashId, onConflict);
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
