// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** StateRepository 抽象接口。参见 PRD §3.5。 */

import type { State } from "../../domain/state.js";

export interface StateRepository {
  /** 读取 AU 运行时状态。 */
  get(au_id: string): Promise<State>;

  /** 保存 AU 运行时状态。 */
  save(state: State): Promise<void>;

  /**
   * 原子 read-modify-write：在写入锁内读取 state，执行 mutator，然后保存。
   * 用于只需修改个别字段的场景（如 index_status），避免长 async 间隙导致的竞态覆写。
   */
  update(au_id: string, mutator: (state: State) => void): Promise<State>;
}
