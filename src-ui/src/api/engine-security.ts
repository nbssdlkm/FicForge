// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { migrateLegacySecureStorage as engineMigrateLegacySecureStorage } from "@ficforge/engine";
import { getEngine } from "./engine-instance";

export async function migrateLegacySecureStorage() {
  const engine = getEngine();
  return engineMigrateLegacySecureStorage({
    adapter: engine.adapter,
    dataDir: engine.dataDir,
    fandomRepo: engine.repos.fandom,
    projectRepo: engine.repos.project,
    settingsRepo: engine.repos.settings,
  });
}
