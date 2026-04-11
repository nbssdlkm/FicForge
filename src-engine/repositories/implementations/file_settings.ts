// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** LocalFileSettingsRepository — settings.yaml 读写实现。参见 PRD §3.3。 */

import yaml from "js-yaml";
import type { PlatformAdapter } from "../../platform/adapter.js";
import { APIMode, LicenseTier, LLMMode } from "../../domain/enums.js";
import type { LLMConfig } from "../../domain/project.js";
import { createLLMConfig } from "../../domain/project.js";
import type {
  AppConfig,
  ChapterMetadataDisplay,
  ChapterMetadataField,
  EmbeddingConfig,
  LicenseConfig,
  ModelParams,
  Settings,
  SyncConfig,
} from "../../domain/settings.js";
import {
  createAppConfig,
  createChapterMetadataDisplay,
  createChapterMetadataField,
  createEmbeddingConfig,
  createLicenseConfig,
  createModelParams,
  createSettings,
  createSyncConfig,
} from "../../domain/settings.js";
import type { SettingsRepository } from "../interfaces/settings.js";
import { now_utc, obj_to_plain } from "./file_utils.js";

export class FileSettingsRepository implements SettingsRepository {
  private path: string;

  constructor(private adapter: PlatformAdapter, dataDir: string) {
    this.path = dataDir + "/settings.yaml";
  }

  async get(): Promise<Settings> {
    const exists = await this.adapter.exists(this.path);
    if (!exists) {
      const settings = createSettings({ updated_at: now_utc() });
      await this.save(settings);
      return settings;
    }

    const text = await this.adapter.readFile(this.path);
    const raw = yaml.load(text) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") {
      return createSettings({ updated_at: now_utc() });
    }

    const settings = dictToSettings(raw);

    // embedding.api_key 为空时复用 default_llm.api_key（仅同厂商时适用）
    if (!settings.embedding.api_key && settings.default_llm.api_key) {
      settings.embedding.api_key = settings.default_llm.api_key;
    }

    return settings;
  }

  async save(settings: Settings): Promise<void> {
    settings.updated_at = now_utc();
    const raw = obj_to_plain(settings);
    const content = yaml.dump(raw, { sortKeys: false, lineWidth: -1 });
    await this.adapter.writeFile(this.path, content);
  }
}

// ---------------------------------------------------------------------------
// YAML dict → domain object 映射
// ---------------------------------------------------------------------------

function dictToLLMConfig(d: Record<string, unknown> | null): LLMConfig {
  if (!d) return createLLMConfig();
  return createLLMConfig({
    mode: LLMMode[(d.mode as string)?.toUpperCase() as keyof typeof LLMMode] ?? LLMMode.API,
    model: (d.model as string) ?? "",
    api_base: (d.api_base as string) ?? "",
    api_key: (d.api_key as string) ?? "",
    local_model_path: (d.local_model_path as string) ?? "",
    ollama_model: (d.ollama_model as string) ?? "",
    context_window: (d.context_window as number) ?? 0,
  });
}

function dictToModelParams(d: Record<string, unknown> | null): Record<string, ModelParams> {
  if (!d) return {};
  const result: Record<string, ModelParams> = {};
  for (const [name, params] of Object.entries(d)) {
    if (params && typeof params === "object") {
      const p = params as Record<string, unknown>;
      result[name] = createModelParams({
        temperature: (p.temperature as number) ?? 1.0,
        top_p: (p.top_p as number) ?? 0.95,
      });
    }
  }
  return result;
}

function dictToEmbeddingConfig(d: Record<string, unknown> | null): EmbeddingConfig {
  if (!d) return createEmbeddingConfig();
  return createEmbeddingConfig({
    mode: LLMMode[(d.mode as string)?.toUpperCase() as keyof typeof LLMMode] ?? LLMMode.API,
    model: (d.model as string) ?? "",
    api_base: (d.api_base as string) ?? "",
    api_key: (d.api_key as string) ?? "",
    local_model_path: (d.local_model_path as string) ?? "",
    ollama_model: (d.ollama_model as string) ?? "nomic-embed-text",
  });
}

function dictToChapterMetadataField(d: Record<string, unknown> | null): ChapterMetadataField {
  if (!d) return createChapterMetadataField();
  return createChapterMetadataField({
    model: (d.model as boolean) ?? true,
    char_count: (d.char_count as boolean) ?? true,
    token_usage: (d.token_usage as boolean) ?? true,
    duration: (d.duration as boolean) ?? true,
    timestamp: (d.timestamp as boolean) ?? true,
    temperature: (d.temperature as boolean) ?? true,
    top_p: (d.top_p as boolean) ?? true,
  });
}

function dictToChapterMetadataDisplay(d: Record<string, unknown> | null): ChapterMetadataDisplay {
  if (!d) return createChapterMetadataDisplay();
  return createChapterMetadataDisplay({
    enabled: (d.enabled as boolean) ?? true,
    fields: dictToChapterMetadataField(d.fields as Record<string, unknown> | null),
  });
}

function dictToAppConfig(d: Record<string, unknown> | null): AppConfig {
  if (!d) return createAppConfig();
  return createAppConfig({
    language: (d.language as string) ?? "zh",
    data_dir: (d.data_dir as string) ?? "./fandoms",
    token_count_fallback: (d.token_count_fallback as string) ?? "char_mul1.5",
    token_warning_threshold: (d.token_warning_threshold as number) ?? 32000,
    chapter_metadata_display: dictToChapterMetadataDisplay(d.chapter_metadata_display as Record<string, unknown> | null),
    schema_version: (d.schema_version as string) ?? "1.0.0",
  });
}

function dictToLicenseConfig(d: Record<string, unknown> | null): LicenseConfig {
  if (!d) return createLicenseConfig();
  return createLicenseConfig({
    tier: LicenseTier[(d.tier as string)?.toUpperCase() as keyof typeof LicenseTier] ?? LicenseTier.FREE,
    feature_flags: (d.feature_flags as string[]) ?? [],
    api_mode: APIMode[(d.api_mode as string)?.toUpperCase() as keyof typeof APIMode] ?? APIMode.SELF_HOSTED,
  });
}

function dictToSyncConfig(d: Record<string, unknown> | null): SyncConfig {
  if (!d) return createSyncConfig();
  const webdav = d.webdav as Record<string, string> | undefined;
  return createSyncConfig({
    mode: (d.mode as "none" | "webdav") ?? "none",
    ...(webdav ? {
      webdav: {
        url: webdav.url ?? "",
        username: webdav.username ?? "",
        password: webdav.password ?? "",
        remote_dir: webdav.remote_dir ?? "/FicForge/",
      },
    } : {}),
    ...(d.last_sync ? { last_sync: d.last_sync as string } : {}),
  });
}

function dictToSettings(d: Record<string, unknown>): Settings {
  return createSettings({
    updated_at: (d.updated_at as string) ?? "",
    default_llm: dictToLLMConfig(d.default_llm as Record<string, unknown> | null),
    model_params: dictToModelParams(d.model_params as Record<string, unknown> | null),
    embedding: dictToEmbeddingConfig(d.embedding as Record<string, unknown> | null),
    app: dictToAppConfig(d.app as Record<string, unknown> | null),
    license: dictToLicenseConfig(d.license as Record<string, unknown> | null),
    sync: dictToSyncConfig(d.sync as Record<string, unknown> | null),
  });
}
