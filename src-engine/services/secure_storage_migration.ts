// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import type { PlatformAdapter } from "../platform/adapter.js";
import type { FandomRepository } from "../repositories/interfaces/fandom.js";
import type { ProjectRepository } from "../repositories/interfaces/project.js";
import type { SettingsRepository } from "../repositories/interfaces/settings.js";
import { joinPath } from "../utils/file_utils.js";
import { withProjectFileLock } from "./au_lock.js";

export interface SecureStorageMigrationParams {
  adapter: PlatformAdapter;
  dataDir: string;
  fandomRepo: FandomRepository;
  projectRepo: ProjectRepository;
  settingsRepo: SettingsRepository;
}

export interface SecureStorageMigrationResult {
  attempted: boolean;
  settingsMigrated: boolean;
  scannedProjects: number;
  migratedProjects: number;
  failedProjects: string[];
}

/**
 * 启动期显式迁移：
 * - 仅在 secure storage 真正具备落盘加密能力时执行；
 * - 把旧版明文 YAML 中的 secrets 搬进 secure storage；
 * - 回写为占位符，但不改业务元数据（revision / updated_at）。
 */
export async function migrate_legacy_secure_storage(
  params: SecureStorageMigrationParams,
): Promise<SecureStorageMigrationResult> {
  const capabilities = params.adapter.getSecretStorageCapabilities();
  if (!capabilities.encrypted_at_rest) {
    return {
      attempted: false,
      settingsMigrated: false,
      scannedProjects: 0,
      migratedProjects: 0,
      failedProjects: [],
    };
  }

  const settingsMigrated = await params.settingsRepo.migrateLegacySecureStorage();
  const fandomNames = await params.fandomRepo.list_fandoms();
  const failedProjects: string[] = [];
  let scannedProjects = 0;
  let migratedProjects = 0;

  for (const fandomName of fandomNames) {
    const fandomPath = joinPath(params.dataDir, "fandoms", fandomName);
    const auNames = await params.fandomRepo.list_aus(fandomPath);
    for (const auName of auNames) {
      const auPath = joinPath(fandomPath, "aus", auName);
      scannedProjects += 1;
      try {
        // project.yaml 的 legacy 迁移是一次全量读改写：与其它 RMW 入口共享文件锁
        // （盲审 R3 M1 对抗审 LOW，让「所有 RMW 入口都持锁」的枚举诚实）。启动期串行，
        // 实际并发概率为零，但持锁不伤且守住不变量。
        if (await withProjectFileLock(auPath, () => params.projectRepo.migrateLegacySecureStorage(auPath))) {
          migratedProjects += 1;
        }
      } catch {
        failedProjects.push(auPath);
      }
    }
  }

  return {
    attempted: true,
    settingsMigrated,
    scannedProjects,
    migratedProjects,
    failedProjects,
  };
}
