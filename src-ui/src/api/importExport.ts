/** Import/Export API */

import { apiFetch, buildApiUrl } from "./client";

export interface ChapterPreview {
  chapter_num: number;
  title: string;
  preview: string;
}

export interface ImportUploadResponse {
  chapters: ChapterPreview[];
  split_method: string;
  total_chapters: number;
}

export interface ImportConfirmResponse {
  total_chapters: number;
  split_method: string;
  characters_found: string[];
  state_initialized: boolean;
}

export async function uploadImportFile(file: File): Promise<ImportUploadResponse> {
  const formData = new FormData();
  formData.append("file", file);
  // apiFetch 会自动设 Content-Type: application/json，FormData 需要让浏览器自动设
  // 所以用 raw fetch + 手动错误处理（与 apiFetch 一致）
  const url = buildApiUrl("/api/v1/import/upload");
  const resp = await fetch(url, { method: "POST", body: formData });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error_code: "UPLOAD_FAILED", message: resp.statusText }));
    throw Object.assign(new Error(err.message || `Upload failed: ${resp.status}`), {
      error_code: err.error_code || "UPLOAD_FAILED",
    });
  }
  return resp.json();
}

export async function confirmImport(params: {
  au_path: string;
  chapters: { chapter_num: number; title: string; content: string }[];
  split_method?: string;
}): Promise<ImportConfirmResponse> {
  return apiFetch("/api/v1/import/confirm", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export async function exportChapters(params: {
  au_path: string;
  format: "txt" | "md";
  start?: number;
  end?: number;
}): Promise<Blob> {
  const query = new URLSearchParams({
    au_path: params.au_path,
    format: params.format,
  });
  if (params.start !== undefined) query.set("start", String(params.start));
  if (params.end !== undefined) query.set("end", String(params.end));
  const url = buildApiUrl(`/api/v1/export?${query.toString()}`);
  const resp = await fetch(url);
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error_code: "EXPORT_FAILED", message: resp.statusText }));
    throw Object.assign(new Error(err.message || `Export failed: ${resp.status}`), {
      error_code: err.error_code || "EXPORT_FAILED",
    });
  }
  return resp.blob();
}
