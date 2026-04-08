// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** StateRepository 抽象接口。参见 PRD §3.5。 */

import type { State } from "../../domain/state.js";

export interface StateRepository {
  /** 读取 AU 运行时状态。 */
  get(au_id: string): Promise<State>;

  /** 保存 AU 运行时状态。 */
  save(state: State): Promise<void>;
}
