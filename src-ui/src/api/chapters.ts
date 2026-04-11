// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/** 章节 API */

export interface ChapterInfo {
  chapter_num: number;
  chapter_id: string;
  content: string;
  revision: number;
  confirmed_at: string;
  provenance: string;
  title?: string;
}
