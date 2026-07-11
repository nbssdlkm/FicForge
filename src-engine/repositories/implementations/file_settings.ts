// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** LocalFileSettingsRepository — settings.yaml 读写实现。参见 PRD §3.3。 */

import * as yaml from "js-yaml";
import type { PlatformAdapter } from "../../platform/adapter.js";
import { APIMode, LicenseTier, LLMMode } from "../../domain/enums.js";
import type { LLMConfig } from "../../domain/project.js";
import { createLLMConfig } from "../../domain/project.js";
import type {
  AppConfig,
  CustomModelEntry,
  CustomProviderEntry,
  EmbeddingConfig,
  FontsConfig,
  LicenseConfig,
  ModelParams,
  Settings,
} from "../../domain/settings.js";
import {
  createAppConfig,
  createCustomModelEntry,
  createCustomProviderEntry,
  createEmbeddingConfig,
  createFontsConfig,
  createLicenseConfig,
  createModelParams,
  createSettings,
} from "../../domain/settings.js";
import { scriptSlotOf } from "../../fonts/stacks.js";
import type { SettingsRepository } from "../interfaces/settings.js";
import { atomicWrite, dumpYaml, joinPath, now_utc, obj_to_plain } from "../../utils/file_utils.js";
import {
  extractSecureFields,
  hasLegacyPlaintextSecureFields,
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
  // settings.sync.webdav.password spec 已随 SyncConfig 清退（D-0040 落实，2026-07-09）。
];

/**
 * 自定义供应商 api_key 的 secure storage key（单一真相源）。
 * UI 删除供应商时用它做孤儿密钥清理（adapter.secureRemove）——供应商 id 由 UI 生成且
 * 全局唯一、删除后不复用，故即使清理失败也不会有旧密钥错误水合回新条目的风险。
 */
export function customProviderApiKeySecureKey(providerId: string): string {
  return `settings.custom_providers.${providerId}.api_key`;
}

/**
 * 动态生成自定义供应商的 SecureFieldSpec（数组长度随 settings 内容变化，
 * 无法进静态 SETTINGS_SECURE_SPECS）。读写路径各自基于**同一份** settings
 * 对象生成，保证 spec 与条目一一对应。
 */
function customProviderSecureSpecs(settings: Settings): SecureFieldSpec<Settings>[] {
  return settings.custom_providers.map((provider) => ({
    secureKey: customProviderApiKeySecureKey(provider.id),
    get: (s: Settings) => s.custom_providers.find((p) => p.id === provider.id)?.api_key ?? "",
    set: (s: Settings, v: string) => {
      const target = s.custom_providers.find((p) => p.id === provider.id);
      if (target) target.api_key = v;
    },
  }));
}

/** 静态 + 动态（自定义供应商）secure specs 合集。 */
function allSecureSpecs(settings: Settings): SecureFieldSpec<Settings>[] {
  return [...SETTINGS_SECURE_SPECS, ...customProviderSecureSpecs(settings)];
}

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
    // （含自定义供应商 api_key 的动态 spec）
    await restoreSecureFields(settings, allSecureSpecs(settings), this.adapter);

    return settings;
  }

  async save(settings: Settings): Promise<void> {
    const copy = structuredClone(settings);
    copy.updated_at = now_utc();

    // 把敏感字段抽到 secure storage，YAML 文本里只剩占位符（含自定义供应商 api_key）
    await extractSecureFields(copy, allSecureSpecs(copy), this.adapter);

    const stripped = { ...copy } as unknown as Record<string, unknown>;
    const raw = obj_to_plain(stripped);
    const content = dumpYaml(raw);
    // settings.yaml 无 ops 背书，截断即全局配置丢失 —— 原子写（审计 H5）
    await atomicWrite(this.adapter, this.path, content);
  }

  /**
   * 显式迁移旧版明文 YAML 到 secure storage，并回写占位符。
   * 不更新 updated_at，避免把安全迁移伪装成用户配置修改。
   */
  async migrateLegacySecureStorage(): Promise<boolean> {
    const exists = await this.adapter.exists(this.path);
    if (!exists) return false;

    const text = await this.adapter.readFile(this.path);
    const raw = yaml.load(text) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") {
      return false;
    }

    const settings = dictToSettings(raw);
    if (!hasLegacyPlaintextSecureFields(settings, allSecureSpecs(settings))) {
      return false;
    }

    await restoreSecureFields(settings, allSecureSpecs(settings), this.adapter);
    const sanitized = structuredClone(settings);
    await extractSecureFields(sanitized, allSecureSpecs(sanitized), this.adapter);
    const content = dumpYaml(obj_to_plain(sanitized));
    await atomicWrite(this.adapter, this.path, content);
    return true;
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
    // chat_path：optional，只在 YAML 真有非空值时映射（缺省 = 未设置，走默认路径）。
    // 与同文件 custom_providers.chatPath 的「未知≠默认」映射口径一致。
    ...(typeof d.chat_path === "string" && d.chat_path ? { chat_path: d.chat_path } : {}),
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

/**
 * `app.fonts` 字典 → FontsConfig，**含 Phase 4 → Phase 7 字段迁移**。
 *
 * 历史字段：Phase 4 用 `ui_font_id` / `reading_font_id`（单一 id），
 * Phase 7 拆成 4 字段（ui/reading 各分 latin/cjk）。
 *
 * 规则：
 * 1. 读到旧字段 → 按 scriptSlotOf 分派到新槽（另一槽保持默认）
 * 2. 同时读到新字段 → 新字段优先（用户在 Phase 7 重新选过）
 * 3. 未读到任何字段 → 走 createFontsConfig() 默认值
 *
 * 迁移后 yaml 里的旧字段在**下次 save 时自动剥离**（Settings 对象不含它们，
 * yaml dump 不会写回），无需显式 delete。
 */
function dictToFontsConfig(d: Record<string, unknown> | null): FontsConfig {
  if (!d) return createFontsConfig();

  const partial: Partial<FontsConfig> = {};

  // 1) Phase 4 旧字段迁移
  const legacyUi = typeof d.ui_font_id === "string" ? (d.ui_font_id as string) : null;
  const legacyReading = typeof d.reading_font_id === "string" ? (d.reading_font_id as string) : null;
  if (legacyUi) {
    const slot = scriptSlotOf(legacyUi);
    if (slot === "latin") partial.ui_latin_font_id = legacyUi;
    else partial.ui_cjk_font_id = legacyUi;
  }
  if (legacyReading) {
    const slot = scriptSlotOf(legacyReading);
    if (slot === "latin") partial.reading_latin_font_id = legacyReading;
    else partial.reading_cjk_font_id = legacyReading;
  }

  // 2) Phase 7 新字段覆盖（若存在）
  if (typeof d.ui_latin_font_id === "string") partial.ui_latin_font_id = d.ui_latin_font_id;
  if (typeof d.ui_cjk_font_id === "string") partial.ui_cjk_font_id = d.ui_cjk_font_id;
  if (typeof d.reading_latin_font_id === "string") partial.reading_latin_font_id = d.reading_latin_font_id;
  if (typeof d.reading_cjk_font_id === "string") partial.reading_cjk_font_id = d.reading_cjk_font_id;

  return createFontsConfig(partial);
}

function dictToAppConfig(d: Record<string, unknown> | null): AppConfig {
  if (!d) return createAppConfig();
  // 注：旧 settings.yaml 里可能仍带已退役字段（writing_mode / token_count_fallback /
  // token_warning_threshold / chapter_metadata_display —— 2026-07-09 盲审死配置清退）。
  // 此处不映射 → 读取时自然丢弃，save 也不再写回，无损同块其它字段（向后兼容）。
  return createAppConfig({
    language: (d.language as string) ?? "zh",
    data_dir: (d.data_dir as string) ?? "./fandoms",
    fonts: dictToFontsConfig(d.fonts as Record<string, unknown> | null),
    // 默认开（PD-4）：缺字段（老 settings.yaml）视为开；仅显式 false 才关。
    react_extraction_enabled: d.react_extraction_enabled !== false,
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

/**
 * 用户模型条目映射。
 * 注意：contextWindow / maxOutputTokens **只在 YAML 里真有数值时才设置** ——
 * 缺失=「未知」是有语义的（UI 走"按 XXk 估算"显式提示路径），
 * 不能在这里静默补默认值把猜测伪装成用户手填的权威数据。
 */
function dictToCustomModelEntry(d: Record<string, unknown>): CustomModelEntry {
  const id = (d.id as string) ?? "";
  return createCustomModelEntry({
    id,
    displayName: (d.displayName as string) || id,
    type: d.type === "embedding" ? "embedding" : "chat",
    ...(typeof d.contextWindow === "number" ? { contextWindow: d.contextWindow } : {}),
    ...(typeof d.maxOutputTokens === "number" ? { maxOutputTokens: d.maxOutputTokens } : {}),
  });
}

function dictToCustomProviders(arr: unknown): CustomProviderEntry[] {
  if (!Array.isArray(arr)) return [];
  const result: CustomProviderEntry[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const d = item as Record<string, unknown>;
    const id = (d.id as string) ?? "";
    if (!id) continue; // 无 id 的条目无法定位 secure key，直接丢弃（防御脏数据）
    const models = Array.isArray(d.models)
      ? (d.models as unknown[])
          .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object")
          .map(dictToCustomModelEntry)
      : [];
    result.push(createCustomProviderEntry({
      id,
      displayName: (d.displayName as string) || id,
      baseUrl: (d.baseUrl as string) ?? "",
      api_key: (d.api_key as string) ?? "",
      models,
      ...(typeof d.chatPath === "string" && d.chatPath ? { chatPath: d.chatPath } : {}),
    }));
  }
  return result;
}

function dictToEnabledModels(d: Record<string, unknown> | null): Record<string, CustomModelEntry[]> {
  if (!d) return {};
  const result: Record<string, CustomModelEntry[]> = {};
  for (const [providerId, models] of Object.entries(d)) {
    if (!Array.isArray(models)) continue;
    result[providerId] = (models as unknown[])
      .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object")
      .map(dictToCustomModelEntry);
  }
  return result;
}

function dictToSettings(d: Record<string, unknown>): Settings {
  return createSettings({
    updated_at: (d.updated_at as string) ?? "",
    default_llm: dictToLLMConfig(d.default_llm as Record<string, unknown> | null),
    model_params: dictToModelParams(d.model_params as Record<string, unknown> | null),
    embedding: dictToEmbeddingConfig(d.embedding as Record<string, unknown> | null),
    app: dictToAppConfig(d.app as Record<string, unknown> | null),
    license: dictToLicenseConfig(d.license as Record<string, unknown> | null),
    // 旧 settings.yaml 的 `sync:` 键不再映射（D-0040 同步退役落实）→ 读取时容忍忽略
    // 旧 settings.yaml 无以下两字段 → 各自回退空集合（向后兼容，读入不炸）
    custom_providers: dictToCustomProviders(d.custom_providers),
    enabled_models: dictToEnabledModels(d.enabled_models as Record<string, unknown> | null),
  });
}
