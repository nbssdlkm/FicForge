// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * ChapterRepository 抽象接口。参见 PRD §2.6.2。
 *
 * 命名约定：`au_id` 即 AU 目录路径（与 domain Chapter.au_id 字段同名同义，
 * 历史命名；等价于部分新接口曾用的 auPath —— 2026-07-09 盲审后全仓统一为 au_id）。
 *
 * get 契约（全仓储统一，盲审 2026-07-09）：**缺失返回 null**、文件系统错误照抛。
 * 调用方据 null 区分「确认不存在」与「读取失败」，禁止再用 try/catch 当缺失判据
 * （那会把 fs 错误吞成"不存在"）。
 */

import type { Chapter } from "../../domain/chapter.js";

export interface ChapterRepository {
  /** 获取指定章节；不存在返回 null。chapter_num 为整型（D-0014）。 */
  get(au_id: string, chapter_num: number): Promise<Chapter | null>;

  /** 保存章节（新建或覆盖）。 */
  save(chapter: Chapter): Promise<void>;

  /** 删除指定章节。 */
  delete(au_id: string, chapter_num: number): Promise<void>;

  /** 列出 AU 下所有已确认主线章节，按章节号排序。 */
  listMain(au_id: string): Promise<Chapter[]>;

  /** 检查指定章节是否存在。 */
  exists(au_id: string, chapter_num: number): Promise<boolean>;

  /** 读取纯正文（剥离 frontmatter），用于上下文注入和向量化。 */
  getContentOnly(au_id: string, chapter_num: number): Promise<string>;

  /** 备份章节到 chapters/backups/ 目录。返回备份文件路径。 */
  backupChapter(au_id: string, chapter_num: number): Promise<string>;
}
