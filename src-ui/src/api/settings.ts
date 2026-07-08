// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/** Settings API */

import type { CustomModelEntry } from "@ficforge/engine";

export interface LlmSettingsInfo {
  mode?: string;
  model?: string;
  api_base?: string;
  api_key?: string;
  local_model_path?: string;
  ollama_model?: string;
  context_window?: number;
  /** 非标聊天补全路径（自定义供应商 chatPath）。缺省 = 默认 /chat/completions。 */
  chat_path?: string;
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

// 单一真相源：复用 engine 的 SecretStorageCapabilities，不在 UI 侧另维护一份 union
// （否则 engine 新增 backend 值时这里会漂移、tsc 报不可赋值）。
export type { SecretStorageCapabilities } from "@ficforge/engine";

// 模型目录（供应商主导选择器）——直接复用 engine domain 形状，UI 不另造同构类型。
export type { CustomModelEntry, CustomProviderEntry } from "@ficforge/engine";

/** 自定义供应商的查询视图：api_key 不出 API 层，只暴露 has_api_key。 */
export interface CustomProviderInfo {
  id: string;
  displayName: string;
  baseUrl: string;
  chatPath?: string;
  has_api_key: boolean;
  models: CustomModelEntry[];
}

/** 选择器消费的持久化目录（自定义供应商 + 每供应商已启用模型）。 */
export interface ModelCatalog {
  custom_providers: CustomProviderInfo[];
  enabled_models: Record<string, CustomModelEntry[]>;
}

/** 自定义供应商保存入参。id 缺省 = 新建（API 层生成唯一 id）。 */
export interface CustomProviderSaveInput {
  id?: string;
  displayName: string;
  baseUrl: string;
  chatPath?: string;
  /** undefined = 保持已存密钥不变；非空字符串 = 覆盖；空字符串 = 清除。 */
  api_key?: string;
  models: CustomModelEntry[];
}

/** 「从 API 获取列表」返回：/models 端点的模型 id 清单。 */
export interface RemoteModelListing {
  ids: string[];
}

export interface DefaultLlmSettingsInput {
  mode: string;
  model: string;
  api_base: string;
  api_key: string;
  local_model_path: string;
  ollama_model: string;
  context_window: number;
  /** 非标聊天补全路径（自定义供应商 chatPath）。缺省 = 默认 /chat/completions。 */
  chat_path?: string;
}

export interface EmbeddingSettingsSaveInput {
  model: string;
  api_base: string;
  api_key: string;
}

export interface AppPreferencesInput {
  language?: string;
  react_extraction_enabled?: boolean;
}

export interface GlobalSettingsSaveInput {
  default_llm: DefaultLlmSettingsInput;
  embedding: EmbeddingSettingsSaveInput;
}

export interface SettingsSummary {
  default_llm: LlmQueryInfo;
  embedding: EmbeddingQueryInfo;
  app: {
    language: string;
    fonts: FontPreferences;
    // 增强事实提取开关（GlobalSettings 同名 toggle）。运行时 FileSettingsRepository 已归一为
    // 具体 boolean（默认 true），不会是 undefined；此处声明可选只为类型容错（手构 summary /
    // 非 repo 路径可缺）。消费侧统一按 `!== false`（默认开）解释——对话接受后是否自动触发 M9 提取的 gate。
    react_extraction_enabled?: boolean;
  };
}

export interface WriterSessionConfig {
  default_llm: LlmQueryInfo;
  model_params: Record<string, ModelParamInfo>;
  /** 会话级模型下拉需要的目录（当前生效供应商的推荐/已启用模型由 UI 侧按 api_base 匹配派生）。 */
  catalog: ModelCatalog;
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
