// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Trash — listTrash, restoreTrash, permanentDeleteTrash, purgeTrash.
 */

import { ApiError } from "./client";
import { getEngine } from "./engine-instance";

export async function listTrash(_scope: string, path: string) {
  return getEngine().trash.list_trash(path);
}

export async function restoreTrash(_scope: string, path: string, trashId: string) {
  try {
    await getEngine().trash.restore(path, trashId);
  } catch (error) {
    if (
      error instanceof Error
      && (error.message.includes("无法恢复") || error.message.toLowerCase().includes("restore conflict"))
    ) {
      throw new ApiError("restore_conflict", error.message, [], error.message);
    }
    throw error;
  }
}

export async function permanentDeleteTrash(_scope: string, path: string, trashId: string) {
  await getEngine().trash.permanent_delete(path, trashId);
}

export async function purgeTrash(_scope: string, path: string, maxAgeDays?: number) {
  const purged = await getEngine().trash.purge_expired(path, maxAgeDays);
  return { purged_count: purged.length };
}
