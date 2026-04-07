// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/** Fandom / AU API */

import { apiFetch } from "./client";

export interface FandomInfo {
  name: string;
  dir_name: string;
  aus: string[];
}

export async function listFandoms(dataDir = "./fandoms"): Promise<FandomInfo[]> {
  return apiFetch(`/api/v1/fandoms?data_dir=${encodeURIComponent(dataDir)}`);
}

export async function createFandom(name: string, dataDir = "./fandoms"): Promise<{ name: string; path: string }> {
  return apiFetch("/api/v1/fandoms", {
    method: "POST",
    body: JSON.stringify({ name, data_dir: dataDir }),
  });
}

export async function listAus(fandomName: string, dataDir = "./fandoms"): Promise<string[]> {
  return apiFetch(`/api/v1/fandoms/${encodeURIComponent(fandomName)}/aus?data_dir=${encodeURIComponent(dataDir)}`);
}

export async function createAu(fandomName: string, auName: string, fandomPath: string): Promise<{ name: string; path: string }> {
  return apiFetch(`/api/v1/fandoms/${encodeURIComponent(fandomName)}/aus`, {
    method: "POST",
    body: JSON.stringify({ name: auName, fandom_path: fandomPath }),
  });
}

export interface FandomFileEntry {
  name: string;
  filename: string;
}

export interface FandomFilesResponse {
  characters: FandomFileEntry[];
  worldbuilding: FandomFileEntry[];
}

export async function listFandomFiles(fandomName: string, dataDir = "./fandoms"): Promise<FandomFilesResponse> {
  return apiFetch(`/api/v1/fandoms/${encodeURIComponent(fandomName)}/files?data_dir=${encodeURIComponent(dataDir)}`);
}

export async function readFandomFile(fandomName: string, category: string, filename: string, dataDir = "./fandoms"): Promise<{ filename: string; category: string; content: string }> {
  return apiFetch(`/api/v1/fandoms/${encodeURIComponent(fandomName)}/files/${encodeURIComponent(category)}/${encodeURIComponent(filename)}?data_dir=${encodeURIComponent(dataDir)}`);
}

export async function deleteFandom(fandomDirName: string, dataDir = "./fandoms"): Promise<{ status: string; trash_id: string }> {
  return apiFetch(`/api/v1/fandoms/${encodeURIComponent(fandomDirName)}?data_dir=${encodeURIComponent(dataDir)}`, {
    method: "DELETE",
  });
}

export async function deleteAu(fandomDirName: string, auName: string, dataDir = "./fandoms"): Promise<{ status: string; trash_id: string }> {
  return apiFetch(`/api/v1/fandoms/${encodeURIComponent(fandomDirName)}/aus/${encodeURIComponent(auName)}?data_dir=${encodeURIComponent(dataDir)}`, {
    method: "DELETE",
  });
}

export async function renameFandom(fandomDirName: string, newName: string, dataDir = "./fandoms"): Promise<{ status: string; old_name: string; new_name: string; new_dir: string }> {
  return apiFetch(`/api/v1/fandoms/${encodeURIComponent(fandomDirName)}/rename?data_dir=${encodeURIComponent(dataDir)}`, {
    method: "PUT",
    body: JSON.stringify({ new_name: newName }),
  });
}

export async function renameAu(fandomDirName: string, auName: string, newName: string, dataDir = "./fandoms"): Promise<{ status: string; old_name: string; new_name: string; new_dir: string }> {
  return apiFetch(`/api/v1/fandoms/${encodeURIComponent(fandomDirName)}/aus/${encodeURIComponent(auName)}/rename?data_dir=${encodeURIComponent(dataDir)}`, {
    method: "PUT",
    body: JSON.stringify({ new_name: newName }),
  });
}
