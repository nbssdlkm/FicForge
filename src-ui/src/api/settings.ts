/** Settings API */

import { apiFetch } from "./client";

export async function getSettings(dataDir = "./fandoms"): Promise<any> {
  return apiFetch(`/api/v1/settings?data_dir=${encodeURIComponent(dataDir)}`);
}

export async function updateSettings(dataDir: string, updates: object): Promise<any> {
  return apiFetch("/api/v1/settings", {
    method: "PUT",
    body: JSON.stringify({ data_dir: dataDir, ...updates }),
  });
}
