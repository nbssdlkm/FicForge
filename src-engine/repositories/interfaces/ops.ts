// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** OpsRepository 抽象接口。参见 PRD §2.6.5、D-0010、D-0021。 */

import type { OpsEntry } from "../../domain/ops_entry.js";

export interface OpsRepository {
  /** 追加一条操作日志（严格 append-only）。 */
  append(au_id: string, entry: OpsEntry): Promise<void>;

  /** 列出 AU 下所有操作日志。 */
  list_all(au_id: string): Promise<OpsEntry[]>;

  /** 按操作目标筛选日志。 */
  list_by_target(au_id: string, target_id: string): Promise<OpsEntry[]>;

  /** 按关联章节筛选日志。 */
  list_by_chapter(au_id: string, chapter_num: number): Promise<OpsEntry[]>;

  /** 返回指定类型的所有操作记录。 */
  get_by_op_type(au_id: string, op_type: string): Promise<OpsEntry[]>;

  /** 返回该章节的 confirm_chapter 记录（undo 步骤 6/7 用）。 */
  get_confirm_for_chapter(au_id: string, chapter_num: number): Promise<OpsEntry | null>;

  /** 返回 chapter_num==N 且 op_type=="add_fact" 的记录（undo 步骤 4 用）。 */
  get_add_facts_for_chapter(au_id: string, chapter_num: number): Promise<OpsEntry[]>;

  /** 返回指定类型的最新一条记录（按文件顺序）。 */
  get_latest_by_type(au_id: string, op_type: string): Promise<OpsEntry | null>;

  /** 全量重写 ops（同步合并后使用）。 */
  replace_all(au_id: string, ops: OpsEntry[]): Promise<void>;
}
