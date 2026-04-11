// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** @ficforge/engine — 统一导出。 */

// Domain
export * from "./domain/index.js";

// Prompts
export { getPrompts } from "./prompts/index.js";
export type { PromptKey, PromptModule } from "./prompts/index.js";

// Tokenizer
export { clear_tokenizer_cache, count_tokens } from "./tokenizer/index.js";
export type { TokenCount } from "./tokenizer/index.js";

// Platform
export type { OpenDialogOptions, PlatformAdapter, SaveDialogOptions } from "./platform/index.js";
export { CapacitorAdapter, TauriAdapter, WebAdapter } from "./platform/index.js";

// Repository interfaces
export type {
  ChapterRepository,
  DraftRepository,
  FactRepository,
  FandomRepository,
  OpsRepository,
  ProjectRepository,
  SearchOptions,
  SearchResult,
  SettingsRepository,
  StateRepository,
  VectorChunk,
  VectorRepository,
} from "./repositories/interfaces/index.js";

// Repository implementations
export {
  FileChapterRepository,
  FileDraftRepository,
  FileFactRepository,
  FileFandomRepository,
  FileOpsRepository,
  FileProjectRepository,
  FileSettingsRepository,
  FileStateRepository,
  compute_content_hash,
  generate_fact_id,
  generate_op_id,
  now_utc,
} from "./repositories/implementations/index.js";

// Vector engine
export { cosine_similarity, JsonVectorEngine, split_chapter_into_chunks } from "./vector/index.js";
export type { ChunkData } from "./vector/index.js";

// LLM
export type {
  EmbeddingProvider,
  GenerateParams,
  LLMChunk,
  LLMProvider,
  LLMResponse,
  Message,
  ResolvedLLMConfig,
  ResolvedLLMParams,
  ToolCall,
  ToolDefinition,
} from "./llm/index.js";
export {
  create_provider,
  LLMError,
  OpenAICompatibleProvider,
  RemoteEmbeddingProvider,
  resolve_llm_config,
  resolve_llm_params,
} from "./llm/index.js";

// Services
export * from "./services/index.js";

// Sync
export * from "./sync/index.js";
