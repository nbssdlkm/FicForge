// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 核心领域对象。 */

// Enums
export {
  APIMode,
  EmotionStyle,
  FactSource,
  FACT_SOURCE_VALUES,
  FactStatus,
  FACT_STATUS_VALUES,
  FactType,
  FACT_TYPE_VALUES,
  IndexStatus,
  LicenseTier,
  LLMMode,
  NarrativeWeight,
  NARRATIVE_WEIGHT_VALUES,
  OpType,
  Perspective,
  Provenance,
  ThreadStatus,
  THREAD_STATUS_VALUES,
} from "./enums.js";

// Domain objects
export type { BudgetReport } from "./budget_report.js";
export { createBudgetReport } from "./budget_report.js";

export type { Chapter } from "./chapter.js";
export { createChapter } from "./chapter.js";

export type { ParsedCharacterCard } from "./character_card.js";
export { AU_CHARACTERS_DIR, KNOWN_CHARACTER_META_KEYS, parseCharacterCard } from "./character_card.js";
export { splitFrontmatterRaw } from "./frontmatter.js";

export type { ChapterSummary, SummaryTier } from "./chapter_summary.js";
export { createChapterSummary } from "./chapter_summary.js";

export type { ContextSummary, RagChunkDetail, RagCollection } from "./context_summary.js";
export { createContextSummary, RAG_COLLECTIONS } from "./context_summary.js";

export type { Draft } from "./draft.js";
export { createDraft } from "./draft.js";

export type { Fact } from "./fact.js";
export { createFact } from "./fact.js";

export type { Thread } from "./thread.js";
export { createThread } from "./thread.js";

export type { FactChange } from "./fact_change.js";
export { createFactChange } from "./fact_change.js";

export type { Fandom } from "./fandom.js";
export { createFandom } from "./fandom.js";

export type { GeneratedWith } from "./generated_with.js";
export { createGeneratedWith } from "./generated_with.js";

export type { OpsEntry } from "./ops_entry.js";
export { createOpsEntry } from "./ops_entry.js";

export type { CastRegistry, EmbeddingLock, LLMConfig, Project, WritingStyle } from "./project.js";
export {
  createCastRegistry,
  createEmbeddingLock,
  createLLMConfig,
  createProject,
  createWritingStyle,
} from "./project.js";

export type {
  AppConfig,
  CustomModelEntry,
  CustomProviderEntry,
  EmbeddingConfig,
  FontsConfig,
  LicenseConfig,
  ModelParams,
  Settings,
} from "./settings.js";
export {
  createAppConfig,
  createCustomModelEntry,
  createCustomProviderEntry,
  createEmbeddingConfig,
  createFontsConfig,
  createLicenseConfig,
  createModelParams,
  createSettings,
} from "./settings.js";

export type {
  SimpleChatFile,
  SimpleChatMessageEnvelope,
  SimpleMessageKind,
  SimpleDraftStatus,
  SimpleToolCallStatus,
  SimpleSystemTone,
  ToolUndoMeta,
  SimpleUserMessage,
  SimpleAssistantToolCall,
  SimpleAssistantMessage,
  SimpleToolResultMessage,
  SimpleWritingDraftMessage,
  SimpleToolCallMessage,
  SimpleChapterPreviewMessage,
  SimpleSettingPreviewMessage,
  SimpleSystemMessage,
  SimpleChatMessage,
} from "./simple_chat.js";
export { createSimpleChatFile, SIMPLE_CHAT_VERSION, asSimpleChatMessages } from "./simple_chat.js";

export type { EmbeddingFingerprint, State } from "./state.js";
export { createEmbeddingFingerprint, createState } from "./state.js";

// Model context map
export {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_OUTPUT,
  MODEL_CONTEXT_MAP,
  MODEL_MAX_OUTPUT,
  get_context_window,
  get_model_max_output,
  normalize_model_id,
} from "./model_context_map.js";

// Provider manifest（供应商主导模型选择器 · 单一真相源）
export type {
  LocalizedName,
  ModelKind,
  ModelTag,
  ProviderEntry,
  RecommendedModel,
} from "./provider_manifest.js";
export {
  contextWindowForModel,
  findRecommendedModel,
  getProvider,
  listProviders,
  OLLAMA_DEFAULT_BASE_URL,
} from "./provider_manifest.js";

// 章节 / 草稿文件命名与路径判据（单一真相源）
export {
  CHAPTERS_MAIN_DIR,
  chapterFilename,
  chapterMainPath,
  draftFilename,
  DraftLabelExhaustedError,
  nextDraftLabel,
  parseChapterFilename,
  parseChapterMainPath,
  parseDraftFilename,
  PROJECT_YAML,
  STATE_YAML,
} from "./paths.js";

// Settings tools
export {
  CHARACTER_IMPORTANCE_VALUES,
  get_tools_for_mode,
  isSettingsMutatingToolName,
  isSimpleMutatingToolName,
  SETTINGS_MUTATING_TOOL_NAMES,
  SIMPLE_MUTATING_TOOL_NAMES,
} from "./settings_tools.js";
export type { SettingsMutatingToolName, SimpleMutatingToolName } from "./settings_tools.js";

// Utility functions
export { scan_characters_in_chapter } from "./character_scanner.js";
export { extract_last_scene_ending } from "./text_utils.js";
