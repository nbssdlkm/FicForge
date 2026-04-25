// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/** Fandom / AU API */

export interface AuInfo {
  name: string;
  dir_name: string;
  /**
   * Number of confirmed chapters (= state.current_chapter - 1 for AUs that
   * are mid-draft, or = state.current_chapter for AUs whose latest chapter
   * is fully confirmed). For Library overview cards. Optional because the
   * cheap path (listAus alone) doesn't compute it.
   */
  chapter_count?: number;
  /**
   * Whether the AU has any chapters in `chapters_dirty`. Drives the "Draft"
   * badge on Library AU cards. Optional, see chapter_count.
   */
  has_dirty?: boolean;
}

export interface FandomInfo {
  name: string;
  dir_name: string;
  aus: AuInfo[];
}

export interface FandomDisplayInfo {
  name: string;
  dir_name: string;
  path: string;
}

export interface FandomFileEntry {
  name: string;
  filename: string;
}

export interface FandomFilesResponse {
  characters: FandomFileEntry[];
  worldbuilding: FandomFileEntry[];
}
