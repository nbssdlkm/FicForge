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
} from "./enums.js";

// Domain objects
export type { Annotation, ChapterAnnotations } from "./annotation.js";
export { ANNOTATION_SCHEMA_VERSION, createAnnotation, createChapterAnnotations } from "./annotation.js";

export type { BudgetReport } from "./budget_report.js";
export { createBudgetReport } from "./budget_report.js";

export type { Chapter } from "./chapter.js";
export { createChapter } from "./chapter.js";

export type { Chunk } from "./chunk.js";
export { createChunk } from "./chunk.js";

export type { ContextSummary, RagChunkDetail, RagCollection } from "./context_summary.js";
export { createContextSummary, RAG_COLLECTIONS } from "./context_summary.js";

export type { Draft } from "./draft.js";
export { createDraft } from "./draft.js";

export type { Fact } from "./fact.js";
export { createFact } from "./fact.js";

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
  ChapterMetadataDisplay,
  ChapterMetadataField,
  EmbeddingConfig,
  FontsConfig,
  LicenseConfig,
  ModelParams,
  Settings,
  SyncConfig,
} from "./settings.js";
export {
  createAppConfig,
  createChapterMetadataDisplay,
  createChapterMetadataField,
  createEmbeddingConfig,
  createFontsConfig,
  createLicenseConfig,
  createModelParams,
  createSettings,
  createSyncConfig,
} from "./settings.js";

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
} from "./model_context_map.js";

// Settings tools
export { get_tools_for_mode } from "./settings_tools.js";

// Utility functions
export { scan_characters_in_chapter } from "./character_scanner.js";
export { extract_last_scene_ending } from "./text_utils.js";
