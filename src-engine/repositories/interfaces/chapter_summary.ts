// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import type { ChapterSummary } from "../../domain/chapter_summary.js";

/**
 * 单章摘要的读写接口（M8-C + M10-A）。
 * `au_id` 即 AU 目录路径（全仓储统一命名，2026-07-09；此前本接口用 auPath 同义分裂）。
 */
export interface ChapterSummaryRepository {
  get(au_id: string, chapterNum: number): Promise<ChapterSummary | null>;
  save(au_id: string, chapterNum: number, summary: ChapterSummary): Promise<void>;
  remove(au_id: string, chapterNum: number): Promise<void>;

  /**
   * 写入 micro 摘要（M10-A）。
   * 读取现有摘要文件（若无则以 createChapterSummary 初始化），合并写入 micro 键后覆盖存储。
   * 幂等：并发写同章 micro 后者覆盖前者（可接受）。
   */
  update_micro(au_id: string, chapterNum: number, text: string, hash: string): Promise<void>;

  /**
   * 将当前 standard 备份为 standard_v1，写入新 standard（version:2）（M10-A）。
   * 幂等：standard_v1 已存在时不覆盖（保留最原始的 v1）。
   * 若当前无 standard，仅写入新 standard（不写 standard_v1）。
   */
  promote_to_v2(au_id: string, chapterNum: number, v2Text: string, hash: string): Promise<void>;
}
