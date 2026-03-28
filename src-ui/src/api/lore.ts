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
