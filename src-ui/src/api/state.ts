/** State API */

import { apiFetch } from "./client";

export interface StateInfo {
  current_chapter: number;
  chapter_focus: string[];
  chapter_titles: Record<string, string>;  // JSON key 是 string，值如 {"1": "黄昏的告别"}
  last_scene_ending: string;
  characters_last_seen: Record<string, number>;
  chapters_dirty: number[];
  last_confirmed_chapter_focus: string[];
  index_status: string;
  sync_unsafe: boolean;
}

export async function getState(auPath: string): Promise<StateInfo> {
  return apiFetch(`/api/v1/state?au_path=${encodeURIComponent(auPath)}`);
}

export async function setChapterFocus(auPath: string, focusIds: string[]): Promise<any> {
  return apiFetch("/api/v1/state/chapter-focus", {
    method: "PUT",
    body: JSON.stringify({ au_path: auPath, focus_ids: focusIds }),
  });
}

export async function rebuildIndex(auPath: string): Promise<{ task_id: string; message: string }> {
  return apiFetch("/api/v1/state/rebuild-index", {
    method: "POST",
    body: JSON.stringify({ au_path: auPath }),
  });
}

export async function recalcState(auPath: string): Promise<{
  characters_last_seen: Record<string, number>;
  last_scene_ending: string;
  last_confirmed_chapter_focus: string[];
  chapters_scanned: number;
  cleaned_dirty_count: number;
  cleaned_focus_count: number;
}> {
  return apiFetch("/api/v1/state/recalc", {
    method: "POST",
    body: JSON.stringify({ au_path: auPath }),
  });
}
