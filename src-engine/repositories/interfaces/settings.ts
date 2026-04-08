// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** SettingsRepository 抽象接口。参见 PRD §3.3。 */

import type { Settings } from "../../domain/settings.js";

export interface SettingsRepository {
  /** 读取全局配置。 */
  get(): Promise<Settings>;

  /** 保存全局配置。 */
  save(settings: Settings): Promise<void>;
}
