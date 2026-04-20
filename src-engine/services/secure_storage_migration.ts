// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import type { PlatformAdapter } from "../platform/adapter.js";
import type { FileFandomRepository } from "../repositories/implementations/file_fandom.js";
import type { FileProjectRepository } from "../repositories/implementations/file_project.js";
import type { FileSettingsRepository } from "../repositories/implementations/file_settings.js";
import { joinPath } from "../repositories/implementations/file_utils.js";

export interface SecureStorageMigrationParams {
  adapter: PlatformAdapter;
  dataDir: string;
  fandomRepo: FileFandomRepository;
  projectRepo: FileProjectRepository;
  settingsRepo: FileSettingsRepository;
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
        if (await params.projectRepo.migrateLegacySecureStorage(auPath)) {
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
