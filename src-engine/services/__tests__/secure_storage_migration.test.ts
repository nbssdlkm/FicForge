// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import yaml from "js-yaml";
import { createProject } from "../../domain/project.js";
import { FileFandomRepository } from "../../repositories/implementations/file_fandom.js";
import { FileProjectRepository } from "../../repositories/implementations/file_project.js";
import { FileSettingsRepository } from "../../repositories/implementations/file_settings.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { migrate_legacy_secure_storage } from "../secure_storage_migration.js";

class MockEncryptedAdapter extends MockAdapter {
  override getSecretStorageCapabilities() {
    return {
      backend: "os_keyring" as const,
      encrypted_at_rest: true,
      persistence: "persistent" as const,
    };
  }
}

describe("migrate_legacy_secure_storage", () => {
  it("migrates legacy plaintext settings/project YAML without bumping business metadata", async () => {
    const adapter = new MockEncryptedAdapter();
    const dataDir = "";
    const settingsRepo = new FileSettingsRepository(adapter, dataDir);
    const fandomRepo = new FileFandomRepository(adapter, dataDir);
    const projectRepo = new FileProjectRepository(adapter);

    await adapter.writeFile("settings.yaml", yaml.dump({
      updated_at: "2026-04-01T00:00:00Z",
      default_llm: { mode: "api", model: "gpt-4o", api_base: "", api_key: "legacy-settings-key" },
      embedding: { mode: "api", model: "", api_base: "", api_key: "" },
      sync: {},
      app: { language: "zh" },
    }));

    const fandomPath = "fandoms/demo";
    await fandomRepo.save(fandomPath, {
      name: "demo",
      created_at: "2026-04-01T00:00:00Z",
      core_characters: [],
      wiki_source: "",
    });

    const project = createProject({
      au_id: `${fandomPath}/aus/au-1`,
      project_id: "p1",
      name: "AU 1",
      fandom: "demo",
      revision: 7,
      updated_at: "2026-04-02T00:00:00Z",
    });
    project.llm.api_key = "legacy-project-key";
    await adapter.writeFile(`${project.au_id}/project.yaml`, yaml.dump({
      ...project,
      llm: {
        ...project.llm,
        api_key: "legacy-project-key",
      },
    }));

    const result = await migrate_legacy_secure_storage({
      adapter,
      dataDir,
      fandomRepo,
      projectRepo,
      settingsRepo,
    });

    expect(result).toEqual({
      attempted: true,
      settingsMigrated: true,
      scannedProjects: 1,
      migratedProjects: 1,
      failedProjects: [],
    });

    const sanitizedSettings = await adapter.readFile("settings.yaml");
    expect(sanitizedSettings).not.toContain("legacy-settings-key");
    expect(sanitizedSettings).toContain("<secure>");
    expect(sanitizedSettings).toContain("updated_at: '2026-04-01T00:00:00Z'");
    expect(await adapter.secureGet("settings.default_llm.api_key")).toBe("legacy-settings-key");

    const sanitizedProject = await adapter.readFile(`${project.au_id}/project.yaml`);
    expect(sanitizedProject).not.toContain("legacy-project-key");
    expect(sanitizedProject).toContain("<secure>");
    expect(sanitizedProject).toContain("revision: 7");
    expect(sanitizedProject).toContain("updated_at: '2026-04-02T00:00:00Z'");
    expect(await adapter.secureGet(`project.${project.au_id}.llm.api_key`)).toBe("legacy-project-key");
  });

  it("skips migration when the adapter still lacks encrypted-at-rest storage", async () => {
    const adapter = new MockAdapter();
    const result = await migrate_legacy_secure_storage({
      adapter,
      dataDir: "",
      fandomRepo: new FileFandomRepository(adapter, ""),
      projectRepo: new FileProjectRepository(adapter),
      settingsRepo: new FileSettingsRepository(adapter, ""),
    });

    expect(result).toEqual({
      attempted: false,
      settingsMigrated: false,
      scannedProjects: 0,
      migratedProjects: 0,
      failedProjects: [],
    });
  });
});
