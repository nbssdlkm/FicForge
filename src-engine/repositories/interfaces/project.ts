// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** ProjectRepository 抽象接口。参见 PRD §3.4。 */

import type { Project } from "../../domain/project.js";

export interface ProjectRepository {
  /** 读取 AU 项目配置。 */
  get(au_id: string): Promise<Project>;

  /** 保存 AU 项目配置。 */
  save(project: Project): Promise<void>;

  /** 列出 Fandom 下所有 AU 的项目配置。 */
  list_aus(fandom: string): Promise<Project[]>;
}
