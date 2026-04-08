// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** FandomRepository 抽象接口。参见 PRD §3.2。 */

import type { Fandom } from "../../domain/fandom.js";

export interface FandomRepository {
  /** 读取 fandom.yaml。文件不存在时抛出错误。 */
  get(fandom_path: string): Promise<Fandom>;

  /** 保存 fandom.yaml。 */
  save(fandom_path: string, fandom: Fandom): Promise<void>;

  /** 列出所有 Fandom 目录名。 */
  list_fandoms(data_dir: string): Promise<string[]>;

  /** 列出 Fandom 下所有 AU 目录名。 */
  list_aus(fandom_path: string): Promise<string[]>;
}
