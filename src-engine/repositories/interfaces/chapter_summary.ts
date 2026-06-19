// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import type { ChapterSummary } from "../../domain/chapter_summary.js";

/** 单章摘要的读写接口（M8-C）。 */
export interface ChapterSummaryRepository {
  get(auPath: string, chapterNum: number): Promise<ChapterSummary | null>;
  save(auPath: string, chapterNum: number, summary: ChapterSummary): Promise<void>;
  remove(auPath: string, chapterNum: number): Promise<void>;
}
