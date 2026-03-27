/** Fandom / AU API */

import { apiFetch } from "./client";

export interface FandomInfo {
  name: string;
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
