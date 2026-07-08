// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 全局配置领域对象。参见 PRD §3.3 settings.yaml。 */

import { APIMode, LicenseTier, LLMMode } from "./enums.js";
import { type LLMConfig, createLLMConfig } from "./project.js";
import type { ModelKind } from "./provider_manifest.js";

export interface ModelParams {
  temperature: number;
  top_p: number;
}

export function createModelParams(partial?: Partial<ModelParams>): ModelParams {
  return {
    temperature: 1.0,
    top_p: 0.95,
    ...partial,
  };
}

export interface EmbeddingConfig {
  mode: LLMMode;
  model: string;
  api_base: string;
  api_key: string;
  local_model_path: string;
  ollama_model: string;
}

export function createEmbeddingConfig(partial?: Partial<EmbeddingConfig>): EmbeddingConfig {
  return {
    mode: LLMMode.API,
    model: "",
    api_base: "",
    api_key: "",
    local_model_path: "",
    ollama_model: "nomic-embed-text",
    ...partial,
  };
}

/**
 * 用户模型条目（供应商主导模型选择器，方案 B）。
 *
 * 形状与 manifest 的 RecommendedModel 同构（蓝图硬性要求）。当前（v1）唯一写入来源：
 *   「从 API 获取列表」sheet 勾选写入 Settings.enabled_models[providerId]。
 * CustomProviderEntry.models 复用同一形状但 v1 表单不提供逐模型手填入口（恒为空，留作扩展点）；
 * 自定义模型的 ctx 经拉取 sheet 的已有条目保留 / 槽位级手填维护，逐模型编辑待后续。
 *
 * contextWindow 语义（与 provider_manifest.contextWindowForModel 分层一致）：
 *   - 有值 = 用户手填/确认的权威值（喂 computeInputBudget）
 *   - 缺失 = 未知 —— UI 必须按 MODEL_CONTEXT_MAP fuzzy 估算并**显式提示「按 XXk 估算」**，
 *     禁止在持久化层静默补一个默认值伪装成权威数据（决策文档明令禁静默 fallback）。
 */
export interface CustomModelEntry {
  /** 模型 id（发给 API 的名字，可带 org/ 前缀）。 */
  id: string;
  /** UI 展示名（默认与 id 相同）。 */
  displayName: string;
  /** 用户手填/确认的 context window（缺 = 未知，UI 走估算提示路径）。 */
  contextWindow?: number;
  /** 单次输出上限（可选）。 */
  maxOutputTokens?: number;
  /** chat / embedding（拉取清单按 id 启发式预标，用户可改）。 */
  type: ModelKind;
}

export function createCustomModelEntry(partial?: Partial<CustomModelEntry>): CustomModelEntry {
  return {
    id: "",
    displayName: "",
    type: "chat",
    ...partial,
  };
}

/**
 * 用户自定义供应商（与 manifest 的 ProviderEntry 同构：id/displayName/baseUrl/chatPath?/models[]）。
 *
 * 差异（有意为之）：
 *   - displayName 是单一字符串（用户手填，不做中英双语）
 *   - api_key 持久化在供应商条目上（Kelivo 模式）——落盘走 secure storage
 *     （见 file_settings 的动态 SecureFieldSpec），YAML 里只留占位符
 *   - models = 逐模型清单扩展点（v1 表单无手填入口，恒为空）；「拉取勾选」的模型统一存
 *     Settings.enabled_models[id]
 */
export interface CustomProviderEntry {
  /** 稳定 id（UI 生成，唯一；secure storage key 的 namespace 组成部分）。 */
  id: string;
  displayName: string;
  baseUrl: string;
  /** 可选自定义 chat 路径（默认 /chat/completions）。 */
  chatPath?: string;
  /** 供应商级 API key（选中该供应商时自动带出；secure storage 管理）。 */
  api_key: string;
  models: CustomModelEntry[];
}

export function createCustomProviderEntry(partial?: Partial<CustomProviderEntry>): CustomProviderEntry {
  return {
    id: "",
    displayName: "",
    baseUrl: "",
    api_key: "",
    models: [],
    ...partial,
  };
}

export interface ChapterMetadataField {
  model: boolean;
  char_count: boolean;
  token_usage: boolean;
  duration: boolean;
  timestamp: boolean;
  temperature: boolean;
  top_p: boolean;
}

export function createChapterMetadataField(partial?: Partial<ChapterMetadataField>): ChapterMetadataField {
  return {
    model: true,
    char_count: true,
    token_usage: true,
    duration: true,
    timestamp: true,
    temperature: true,
    top_p: true,
    ...partial,
  };
}

export interface ChapterMetadataDisplay {
  enabled: boolean;
  fields: ChapterMetadataField;
}

export function createChapterMetadataDisplay(partial?: Partial<ChapterMetadataDisplay>): ChapterMetadataDisplay {
  return {
    enabled: true,
    fields: createChapterMetadataField(),
    ...partial,
  };
}

/**
 * 字体偏好：界面 / 阅读两档，每档各选西文字体 + 中文字体。
 *
 * CSS 层把两个 id 对应的 family 拼成 font-family stack（Latin 字体在前、CJK 字体在后），
 * 浏览器按 unicode-range 自动分派：英文走 Latin 字体、中文走 CJK 字体。
 *
 * 特殊值 `"system"` = 跟随操作系统（对应 SYSTEM_FONT_STACK）。
 * 其他值必须是 FONT_MANIFEST 中某个 entry 的 id。
 */
export interface FontsConfig {
  ui_latin_font_id: string;
  ui_cjk_font_id: string;
  reading_latin_font_id: string;
  reading_cjk_font_id: string;
}

export function createFontsConfig(partial?: Partial<FontsConfig>): FontsConfig {
  return {
    // 默认：界面跟随系统；阅读西文用 Source Serif 4、中文用 LXGW WenKai Screen。
    ui_latin_font_id: "system",
    ui_cjk_font_id: "system",
    reading_latin_font_id: "source-serif-4",
    reading_cjk_font_id: "lxgw-wenkai-screen",
    ...partial,
  };
}

export interface AppConfig {
  language: string;
  data_dir: string;
  token_count_fallback: string;
  token_warning_threshold: number;
  chapter_metadata_display: ChapterMetadataDisplay;
  fonts: FontsConfig;
  /** M9：开启 ReAct 增强事实提取（跨章 caused_by + 自动挂剧情线）。默认开（PD-4，用户 2026-06-21 拍板）；可在全局设置关。 */
  react_extraction_enabled: boolean;
  schema_version: string;
}

export function createAppConfig(partial?: Partial<AppConfig>): AppConfig {
  return {
    language: "zh",
    data_dir: "./fandoms",
    token_count_fallback: "char_mul1.5",
    token_warning_threshold: 32000,
    chapter_metadata_display: createChapterMetadataDisplay(),
    fonts: createFontsConfig(),
    react_extraction_enabled: true,
    schema_version: "1.0.0",
    ...partial,
  };
}

export interface LicenseConfig {
  tier: LicenseTier;
  feature_flags: string[];
  api_mode: APIMode;
}

export function createLicenseConfig(partial?: Partial<LicenseConfig>): LicenseConfig {
  return {
    tier: LicenseTier.FREE,
    feature_flags: [],
    api_mode: APIMode.SELF_HOSTED,
    ...partial,
  };
}

export interface SyncConfig {
  mode: "none" | "webdav";
  webdav?: {
    url: string;
    username: string;
    password: string;
    remote_dir: string;
  };
  last_sync?: string;
}

export function createSyncConfig(partial?: Partial<SyncConfig>): SyncConfig {
  return {
    mode: "none",
    ...partial,
  };
}

/** 全局配置。字段名与 PRD §3.3 settings.yaml 一致。 */
export interface Settings {
  updated_at: string;                           // ISO 8601
  default_llm: LLMConfig;
  model_params: Record<string, ModelParams>;
  embedding: EmbeddingConfig;
  app: AppConfig;
  license: LicenseConfig;
  sync: SyncConfig;
  /** 用户自定义供应商清单（选择器方案 B 硬性要求）。 */
  custom_providers: CustomProviderEntry[];
  /** 每供应商「已启用模型」（拉取清单勾选写入）。key = providerId（内置或自定义）。 */
  enabled_models: Record<string, CustomModelEntry[]>;
}

export function createSettings(partial?: Partial<Settings>): Settings {
  return {
    updated_at: "",
    default_llm: createLLMConfig(),
    model_params: {},
    embedding: createEmbeddingConfig(),
    app: createAppConfig(),
    license: createLicenseConfig(),
    sync: createSyncConfig(),
    custom_providers: [],
    enabled_models: {},
    ...partial,
  };
}
