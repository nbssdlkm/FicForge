// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** SettingsRepository 抽象接口。参见 PRD §3.3。 */

import type { Settings } from "../../domain/settings.js";

export interface SettingsRepository {
  /** 读取全局配置。 */
  get(): Promise<Settings>;

  /** 保存全局配置。 */
  save(settings: Settings): Promise<void>;

  /**
   * 显式迁移旧版 settings.yaml 中的明文 secret 进 secure storage（回写占位符）。
   * 返回是否发生了迁移。启动期 secure_storage_migration 服务经此接口调用，
   * 不依赖具体实现类型。
   */
  migrateLegacySecureStorage(): Promise<boolean>;
}
