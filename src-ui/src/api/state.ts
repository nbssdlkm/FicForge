// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/** State API */

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
