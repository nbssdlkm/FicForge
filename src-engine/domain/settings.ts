// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 全局配置领域对象。参见 PRD §3.3 settings.yaml。 */

import { APIMode, LicenseTier, LLMMode } from "./enums.js";
import { type LLMConfig, createLLMConfig } from "./project.js";

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
 * 字体偏好。两个 id 分别对应 Tailwind font-sans（界面字体）和 font-serif（阅读字体），
 * 背后由 CSS 变量 --font-ui / --font-reading 承载（见 src-ui/src/App.css）。
 *
 * 特殊值 "system" = 跟随操作系统（对应 src-engine/fonts/manifest.ts 的 SYSTEM_FONT_STACK）。
 * 其他值必须是 FONT_MANIFEST 中某个 entry 的 id。
 */
export interface FontsConfig {
  ui_font_id: string;
  reading_font_id: string;
}

export function createFontsConfig(partial?: Partial<FontsConfig>): FontsConfig {
  return {
    // 默认：界面跟随系统、阅读用内置 CJK 楷体（同一 stack 里会 fallback 到 Source Serif 4 for 西文）
    ui_font_id: "system",
    reading_font_id: "lxgw-wenkai-screen",
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
    ...partial,
  };
}
