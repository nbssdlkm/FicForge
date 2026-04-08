// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** FactRepository 抽象接口。参见 PRD §2.6.2、§3.6、D-0003。 */

import type { FactStatus } from "../../domain/enums.js";
import type { Fact } from "../../domain/fact.js";

export interface FactRepository {
  /** 追加一条事实记录（append-only，D-0003）。 */
  append(au_id: string, fact: Fact): Promise<void>;

  /** 获取单条事实记录。不存在时返回 null。 */
  get(au_id: string, fact_id: string): Promise<Fact | null>;

  /** 列出 AU 下所有事实记录。 */
  list_all(au_id: string): Promise<Fact[]>;

  /** 按状态筛选事实记录。 */
  list_by_status(au_id: string, status: FactStatus): Promise<Fact[]>;

  /** 列出指定章节关联的事实记录。 */
  list_by_chapter(au_id: string, chapter_num: number): Promise<Fact[]>;

  /** 返回 characters 列表与传入有交集的 facts。 */
  list_by_characters(au_id: string, character_names: string[]): Promise<Fact[]>;

  /** 返回 status=unresolved 的 facts。 */
  list_unresolved(au_id: string): Promise<Fact[]>;

  /** 更新事实记录（自动刷新 updated_at + revision+1）。 */
  update(au_id: string, fact: Fact): Promise<void>;

  /** 按 ID 列表精准删除（仅限 undo 级联回滚，D-0003）。 */
  delete_by_ids(au_id: string, fact_ids: string[]): Promise<void>;
}
