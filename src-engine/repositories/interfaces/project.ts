// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** ProjectRepository 抽象接口。参见 PRD §3.4。 */

import type { Project } from "../../domain/project.js";

export interface ProjectRepository {
  /** 读取 AU 项目配置；project.yaml 不存在返回 null（get 契约见 ChapterRepository 档注）。 */
  get(au_id: string): Promise<Project | null>;

  /** 保存 AU 项目配置。 */
  save(project: Project): Promise<void>;

  /** 列出 Fandom 下所有 AU 的项目配置。 */
  listAus(fandom: string): Promise<Project[]>;

  /**
   * 显式迁移该 AU project.yaml 中的明文 secret 进 secure storage（回写占位符，
   * 不推进 revision / updated_at）。返回是否发生了迁移。
   */
  migrateLegacySecureStorage(au_id: string): Promise<boolean>;
}
