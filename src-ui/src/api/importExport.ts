// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/** Import/Export API */

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
