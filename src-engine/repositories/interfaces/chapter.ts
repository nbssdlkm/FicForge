// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** ChapterRepository 抽象接口。参见 PRD §2.6.2。 */

import type { Chapter } from "../../domain/chapter.js";

export interface ChapterRepository {
  /** 获取指定章节。chapter_num 为整型（D-0014）。 */
  get(au_id: string, chapter_num: number): Promise<Chapter>;

  /** 保存章节（新建或覆盖）。 */
  save(chapter: Chapter): Promise<void>;

  /** 删除指定章节。 */
  delete(au_id: string, chapter_num: number): Promise<void>;

  /** 列出 AU 下所有已确认主线章节，按章节号排序。 */
  list_main(au_id: string): Promise<Chapter[]>;

  /** 检查指定章节是否存在。 */
  exists(au_id: string, chapter_num: number): Promise<boolean>;

  /** 读取纯正文（剥离 frontmatter），用于上下文注入和向量化。 */
  get_content_only(au_id: string, chapter_num: number): Promise<string>;

  /** 备份章节到 chapters/backups/ 目录。返回备份文件路径。 */
  backup_chapter(au_id: string, chapter_num: number): Promise<string>;
}
