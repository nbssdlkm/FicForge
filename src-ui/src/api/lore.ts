/** Lore API — Read and write markdown files for Fandom and AU */

import { apiFetch } from "./client";

export interface LoreSaveRequest {
  au_path?: string;
  fandom_path?: string;
  category: string;
  filename: string;
  content: string;
}

export async function saveLore(req: LoreSaveRequest): Promise<{ status: string; path: string }> {
  return apiFetch("/api/v1/lore", {
    method: "PUT",
    body: JSON.stringify(req),
  });
}

export interface LoreReadRequest {
  au_path?: string;
  fandom_path?: string;
  category: string;
  filename: string;
}

export async function readLore(req: LoreReadRequest): Promise<{ content: string }> {
  return apiFetch("/api/v1/lore/read", {
    method: "POST",
    body: JSON.stringify(req),
  });
}

export async function deleteLore(req: LoreReadRequest): Promise<{ status: string; trash_id: string; deleted: string }> {
  return apiFetch("/api/v1/lore", {
    method: "DELETE",
    body: JSON.stringify(req),
  });
}
