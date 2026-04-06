/** 章节 API */

import { apiFetch } from "./client";

export interface ChapterInfo {
  chapter_num: number;
  chapter_id: string;
  content: string;
  revision: number;
  confirmed_at: string;
  provenance: string;
  title?: string;
}

export async function listChapters(auPath: string): Promise<ChapterInfo[]> {
  return apiFetch(`/api/v1/chapters?au_path=${encodeURIComponent(auPath)}`);
}

export async function getChapter(auPath: string, chapterNum: number): Promise<ChapterInfo> {
  return apiFetch(`/api/v1/chapters/${chapterNum}?au_path=${encodeURIComponent(auPath)}`);
}

export async function getChapterContent(auPath: string, chapterNum: number): Promise<string> {
  return apiFetch(`/api/v1/chapters/${chapterNum}/content?au_path=${encodeURIComponent(auPath)}`);
}

export async function confirmChapter(
  auPath: string,
  chapterNum: number,
  draftId: string,
  generatedWith?: object,
  content?: string | null,
  title?: string | null
): Promise<any> {
  return apiFetch("/api/v1/chapters/confirm", {
    method: "POST",
    body: JSON.stringify({
      au_path: auPath,
      chapter_num: chapterNum,
      draft_id: draftId,
      generated_with: generatedWith,
      content,
      title,
    }),
  });
}

export async function undoChapter(auPath: string): Promise<any> {
  return apiFetch("/api/v1/chapters/undo", {
    method: "POST",
    body: JSON.stringify({ au_path: auPath }),
  });
}

export async function updateChapterContent(
  auPath: string,
  chapterNum: number,
  content: string
): Promise<{ chapter_num: number; content_hash: string; provenance: string; revision: number }> {
  return apiFetch(`/api/v1/chapters/${chapterNum}/content`, {
    method: "PUT",
    body: JSON.stringify({ au_path: auPath, content }),
  });
}

export async function updateChapterTitle(
  auPath: string,
  chapterNum: number,
  title: string
): Promise<{ chapter_num: number; title: string }> {
  return apiFetch(`/api/v1/chapters/${chapterNum}/title`, {
    method: "PUT",
    body: JSON.stringify({ au_path: auPath, title }),
  });
}

export async function resolveDirtyChapter(auPath: string, chapterNum: number, confirmedFactChanges: any[] = []): Promise<any> {
  return apiFetch("/api/v1/chapters/dirty/resolve", {
    method: "POST",
    body: JSON.stringify({
      au_path: auPath,
      chapter_num: chapterNum,
      confirmed_fact_changes: confirmedFactChanges,
    }),
  });
}
