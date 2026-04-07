// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

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

export async function getLoreContent(params: {
  category: string;
  filename: string;
  au_path?: string;
  fandom_path?: string;
}): Promise<{ content: string }> {
  const q = new URLSearchParams({ category: params.category, filename: params.filename });
  if (params.au_path) q.set("au_path", params.au_path);
  if (params.fandom_path) q.set("fandom_path", params.fandom_path);
  return apiFetch(`/api/v1/lore/content?${q}`);
}

export async function listLoreFiles(params: {
  category: string;
  au_path?: string;
  fandom_path?: string;
}): Promise<{ files: { name: string; filename: string }[] }> {
  const q = new URLSearchParams({ category: params.category });
  if (params.au_path) q.set("au_path", params.au_path);
  if (params.fandom_path) q.set("fandom_path", params.fandom_path);
  return apiFetch(`/api/v1/lore/list?${q}`);
}

export async function importFromFandom(req: {
  fandom_path: string;
  au_path: string;
  filenames: string[];
  source_category?: string;
}): Promise<{ status: string; imported: string[]; skipped: string[] }> {
  return apiFetch("/api/v1/lore/import-from-fandom", {
    method: "POST",
    body: JSON.stringify(req),
  });
}
