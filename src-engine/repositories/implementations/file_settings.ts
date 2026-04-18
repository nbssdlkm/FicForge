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
import { joinPath, now_utc, obj_to_plain } from "./file_utils.js";
import {
  extractSecureFields,
  restoreSecureFields,
  type SecureFieldSpec,
} from "./secure_fields.js";

/**
 * 全局 settings 的敏感字段 spec 表。
 * 新增字段只需在此列表追加一项，读写路径自动覆盖。
 * 注意：P1-4 彻底移除了 embedding.api_key 的隐式 fallback —— 该字段独立管理。
 */
const SETTINGS_SECURE_SPECS: SecureFieldSpec<Settings>[] = [
  {
    secureKey: "settings.default_llm.api_key",
    get: (s) => s.default_llm.api_key,
    set: (s, v) => { s.default_llm.api_key = v; },
  },
  {
    secureKey: "settings.embedding.api_key",
    get: (s) => s.embedding.api_key,
    set: (s, v) => { s.embedding.api_key = v; },
  },
  {
    secureKey: "settings.sync.webdav.password",
    get: (s) => s.sync.webdav?.password ?? "",
    set: (s, v) => { if (s.sync.webdav) s.sync.webdav.password = v; },
  },
];

export class FileSettingsRepository implements SettingsRepository {
  private path: string;

  constructor(private adapter: PlatformAdapter, dataDir: string) {
    // dataDir 是数据根目录（可空，Capacitor/Web 约定 "" = 平台 Data 目录）。
    // 不调用 validateBasePath —— 它专用于用户控制的路径段（au_id、fandom_path 等），
    // 对根目录会误拒 ""。joinPath 自动过滤空段，天然兼容所有平台。
    this.path = joinPath(dataDir, "settings.yaml");
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

    // 还原敏感字段：占位符 → secure storage；旧明文 → 自动迁移到 secure storage
    await restoreSecureFields(settings, SETTINGS_SECURE_SPECS, this.adapter);

    return settings;
  }

  async save(settings: Settings): Promise<void> {
    const copy = structuredClone(settings);
    copy.updated_at = now_utc();

    // 把敏感字段抽到 secure storage，YAML 文本里只剩占位符
    await extractSecureFields(copy, SETTINGS_SECURE_SPECS, this.adapter);

    const stripped = { ...copy } as unknown as Record<string, unknown>;
    const raw = obj_to_plain(stripped);
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
