// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/** Settings API */

export interface LlmSettingsInfo {
  mode?: string;
  model?: string;
  api_base?: string;
  api_key?: string;
  local_model_path?: string;
  ollama_model?: string;
  context_window?: number;
}

export interface ModelParamInfo {
  temperature: number;
  top_p: number;
}

export interface EmbeddingSettingsInfo {
  mode?: string;
  model?: string;
  api_base?: string;
  api_key?: string;
  local_model_path?: string;
  ollama_model?: string;
}

export interface LlmQueryInfo {
  mode: string;
  model: string;
  api_base: string;
  has_api_key: boolean;
  local_model_path: string;
  ollama_model: string;
  context_window: number;
  has_usable_connection: boolean;
}

export interface EmbeddingQueryInfo {
  mode: string;
  model: string;
  api_base: string;
  has_api_key: boolean;
  local_model_path: string;
  ollama_model: string;
  has_custom_config: boolean;
}

export interface FontPreferences {
  ui_latin_font_id: string;
  ui_cjk_font_id: string;
  reading_latin_font_id: string;
  reading_cjk_font_id: string;
}

export interface DefaultLlmSettingsInput {
  mode: string;
  model: string;
  api_base: string;
  api_key: string;
  local_model_path: string;
  ollama_model: string;
  context_window: number;
}

export interface EmbeddingSettingsSaveInput {
  use_custom_config: boolean;
  model: string;
  api_base: string;
  api_key: string;
}

export interface SyncSettingsSaveInput {
  mode: "none" | "webdav";
  url: string;
  username: string;
  password: string;
  remote_dir: string;
  last_sync: string | null;
}

export interface AppPreferencesInput {
  language?: string;
}

export interface GlobalSettingsSaveInput {
  default_llm: DefaultLlmSettingsInput;
  embedding: EmbeddingSettingsSaveInput;
  sync: SyncSettingsSaveInput;
}

export interface SettingsSummary {
  default_llm: LlmQueryInfo;
  embedding: EmbeddingQueryInfo;
  sync: {
    enabled: boolean;
    mode: "none" | "webdav";
    has_password: boolean;
    last_sync: string | null;
  };
  app: {
    language: string;
    fonts: FontPreferences;
  };
}

export interface WriterSessionConfig {
  default_llm: LlmQueryInfo;
  model_params: Record<string, ModelParamInfo>;
}

export interface OnboardingDefaults {
  default_llm: LlmSettingsInfo;
  embedding: EmbeddingSettingsInfo;
}

export interface SettingsInfo {
  default_llm?: LlmSettingsInfo;
  model_params: Record<string, ModelParamInfo>;
  embedding?: EmbeddingSettingsInfo;
  app?: Record<string, unknown>;
  license?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TestConnectionRequest {
  mode: string;
  model?: string;
  api_base?: string;
  api_key?: string;
  local_model_path?: string;
  ollama_model?: string;
}

export interface TestConnectionResponse {
  success: boolean;
  model?: string;
  message?: string;
  error_code?: string;
}
