/** Project API */

import { apiFetch } from "./client";

export async function getProject(auPath: string): Promise<any> {
  return apiFetch(`/api/v1/project?au_path=${encodeURIComponent(auPath)}`);
}

export async function updateProject(auPath: string, updates: object): Promise<any> {
  return apiFetch("/api/v1/project", {
    method: "PUT",
    body: JSON.stringify({ au_path: auPath, ...updates }),
  });
}
