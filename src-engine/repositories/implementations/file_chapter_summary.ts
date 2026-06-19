// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Chapter Summary 文件读写（M8-C）。
 * 存储于 chapters/main/ch{NNNN}.summary.jsonl —— 单个 JSON 对象，每章一条。
 */

import type { PlatformAdapter } from "../../platform/adapter.js";
import type { ChapterSummary } from "../../domain/chapter_summary.js";
import { createChapterSummary } from "../../domain/chapter_summary.js";
import type { ChapterSummaryRepository } from "../interfaces/chapter_summary.js";
import { joinPath } from "./file_utils.js";

/** ch{NNNN}.summary.jsonl 路径。NNNN 为 4 位零填充章节号。 */
export function summaryPath(auPath: string, chapterNum: number): string {
  const padded = String(chapterNum).padStart(4, "0");
  return joinPath(auPath, "chapters", "main", `ch${padded}.summary.jsonl`);
}

export class FileChapterSummaryRepository implements ChapterSummaryRepository {
  constructor(private adapter: PlatformAdapter) {}

  async get(auPath: string, chapterNum: number): Promise<ChapterSummary | null> {
    const path = summaryPath(auPath, chapterNum);
    if (!(await this.adapter.exists(path))) return null;
    try {
      const raw = JSON.parse(await this.adapter.readFile(path)) as Partial<ChapterSummary>;
      return createChapterSummary(raw);
    } catch {
      // 损坏文件按"无摘要"处理（决策②降级精神）
      return null;
    }
  }

  async save(auPath: string, chapterNum: number, summary: ChapterSummary): Promise<void> {
    const path = summaryPath(auPath, chapterNum);
    const dir = path.substring(0, path.lastIndexOf("/"));
    await this.adapter.mkdir(dir);
    await this.adapter.writeFile(path, JSON.stringify(summary, null, 2));
  }

  async remove(auPath: string, chapterNum: number): Promise<void> {
    const path = summaryPath(auPath, chapterNum);
    if (await this.adapter.exists(path)) await this.adapter.deleteFile(path);
  }
}
