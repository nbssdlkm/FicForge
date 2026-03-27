/** State API */

import { apiFetch } from "./client";

export interface StateInfo {
  current_chapter: number;
  chapter_focus: string[];
  last_scene_ending: string;
  characters_last_seen: Record<string, number>;
  chapters_dirty: number[];
  last_confirmed_chapter_focus: string[];
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
