// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** DraftRepository 抽象接口。参见 PRD §2.6.2、D-0016。 */

import type { Draft } from "../../domain/draft.js";

export interface DraftRepository {
  /** 获取指定章节的指定草稿变体。 */
  get(au_id: string, chapter_num: number, variant: string): Promise<Draft>;

  /** 保存草稿。 */
  save(draft: Draft): Promise<void>;

  /** 列出指定章节的所有草稿变体。 */
  list_by_chapter(au_id: string, chapter_num: number): Promise<Draft[]>;

  /** 删除指定章节的所有草稿（用于 undo 级联清理）。 */
  delete_by_chapter(au_id: string, chapter_num: number): Promise<void>;

  /** 删除章节号 >= from_chapter_num 的所有草稿（D-0016 undo 清理）。 */
  delete_from_chapter(au_id: string, from_chapter_num: number): Promise<void>;
}
