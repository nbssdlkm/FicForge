// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 导出功能。参见 PRD §6.8。 */

import type { ChapterRepository } from "../repositories/interfaces/chapter.js";

export interface ExportParams {
  au_id: string;
  chapter_repo: ChapterRepository;
  start_chapter?: number;
  end_chapter?: number | null;
  format?: "txt" | "md";
  include_title?: boolean;
  include_chapter_num?: boolean;
  chapter_titles?: Record<number, string>;
}

export async function export_chapters(params: ExportParams): Promise<string> {
  const {
    au_id, chapter_repo,
    start_chapter = 1,
    end_chapter = null,
    format = "txt",
    include_title = true,
    include_chapter_num = true,
    chapter_titles = {},
  } = params;

  const allChapters = await chapter_repo.list_main(au_id);

  // 过滤范围
  const filtered = allChapters
    .filter((ch) => ch.chapter_num >= start_chapter && (end_chapter === null || ch.chapter_num <= end_chapter))
    .sort((a, b) => a.chapter_num - b.chapter_num);

  if (filtered.length === 0) return "";

  const parts: string[] = [];

  for (const ch of filtered) {
    // 使用 chapter 对象的 content（已剥离 frontmatter）
    const content = ch.content;

    const sectionParts: string[] = [];

    if (include_title || include_chapter_num) {
      const titleLine = buildTitleLine(
        ch.chapter_num, format, include_title, include_chapter_num,
        chapter_titles[ch.chapter_num] ?? "",
      );
      if (titleLine) sectionParts.push(titleLine);
    }

    sectionParts.push(content.trim());
    parts.push(sectionParts.join("\n"));
  }

  return parts.join("\n\n") + "\n";
}

function buildTitleLine(
  chapterNum: number,
  format: string,
  includeTitle: boolean,
  includeChapterNum: boolean,
  customTitle: string,
): string {
  if (!includeTitle && !includeChapterNum) return "";

  const title = customTitle ? `第${chapterNum}章 ${customTitle}` : `第${chapterNum}章`;

  if (format === "md") return `## ${title}`;
  return title;
}
