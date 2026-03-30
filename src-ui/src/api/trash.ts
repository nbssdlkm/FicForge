import { apiFetch } from "./client";

export type TrashScope = "fandom" | "au";

export interface TrashEntry {
  trash_id: string;
  original_path: string;
  trash_path: string;
  entity_type: string;
  entity_name: string;
  deleted_at: string;
  expires_at: string;
  metadata: Record<string, any>;
}

export async function listTrash(scope: TrashScope, path: string): Promise<TrashEntry[]> {
  const query = new URLSearchParams({ scope, path });
  return apiFetch(`/api/v1/trash?${query.toString()}`);
}

export async function restoreTrash(scope: TrashScope, path: string, trashId: string): Promise<void> {
  await apiFetch("/api/v1/trash/restore", {
    method: "POST",
    body: JSON.stringify({
      trash_id: trashId,
      scope,
      path,
    }),
  });
}

export async function permanentDeleteTrash(scope: TrashScope, path: string, trashId: string): Promise<void> {
  const query = new URLSearchParams({ scope, path });
  await apiFetch(`/api/v1/trash/${encodeURIComponent(trashId)}?${query.toString()}`, {
    method: "DELETE",
  });
}

export async function purgeTrash(scope: TrashScope, path: string): Promise<{ purged_count: number }> {
  const query = new URLSearchParams({ scope, path });
  return apiFetch(`/api/v1/trash/purge?${query.toString()}`, {
    method: "DELETE",
  });
}
