/** 章节 API */

import { apiFetch } from "./client";

export interface ChapterInfo {
  chapter_num: number;
  chapter_id: string;
  content: string;
  revision: number;
  confirmed_at: string;
  provenance: string;
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
  content?: string | null
): Promise<any> {
  return apiFetch("/api/v1/chapters/confirm", {
    method: "POST",
    body: JSON.stringify({
      au_path: auPath,
      chapter_num: chapterNum,
      draft_id: draftId,
      generated_with: generatedWith,
      content,
    }),
  });
}

export async function undoChapter(auPath: string): Promise<any> {
  return apiFetch("/api/v1/chapters/undo", {
    method: "POST",
    body: JSON.stringify({ au_path: auPath }),
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
