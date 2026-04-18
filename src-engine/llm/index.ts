// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

export type {
  GenerateParams,
  LLMChunk,
  LLMProvider,
  LLMResponse,
  Message,
  ToolCall,
  ToolDefinition,
} from "./provider.js";
export { LLMError } from "./provider.js";

export { OpenAICompatibleProvider } from "./openai_compatible.js";

export type { ResolvedLLMConfig, ResolvedLLMParams } from "./config_resolver.js";
export { create_provider, resolve_llm_config, resolve_llm_params } from "./config_resolver.js";

export type { EmbeddingProvider } from "./embedding_provider.js";
export { RemoteEmbeddingProvider } from "./embedding_provider.js";

// 平台能力矩阵 —— UI 与引擎共享的单一权威
export type { EmbeddingModeKey, LLMModeKey, ModeAvailability, Platform } from "./capabilities.js";
export {
  getEmbeddingModeAvailability,
  getGenerationModeAvailability,
  listGenerationModes,
} from "./capabilities.js";
