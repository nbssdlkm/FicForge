// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Client — 领域模块 barrel re-export。
 *
 * Engine 实例管理已拆至 engine-instance.ts 以消除循环引用。
 * 各领域函数已拆分至独立模块（engine-state.ts, engine-facts.ts 等）。
 * 本文件统一 re-export，UI 组件的 import 路径无需改动。
 */

// ---------------------------------------------------------------------------
// Type re-exports: engine domain types (aliased for backward compat)
// ---------------------------------------------------------------------------
export type { State as StateInfo } from "@ficforge/engine";
export type { Fact as FactInfo } from "@ficforge/engine";
export type { Draft as DraftDetail } from "@ficforge/engine";
export type { Project as ProjectInfo } from "@ficforge/engine";
export type { Settings as SettingsInfo } from "@ficforge/engine";
export type { WritingStyle, CastRegistry, EmbeddingLock, ContextSummary, RagChunkDetail, RagCollection } from "@ficforge/engine";
export { RAG_COLLECTIONS } from "@ficforge/engine";
export { FactStatus, IndexStatus, LLMMode, Provenance } from "@ficforge/engine";

// UI-specific types (no engine equivalent)
export type { ExtractedFactCandidate, ExtractFactsResponse } from "./facts";
export type { ChapterInfo } from "./chapters";
export type { DraftListItem, DraftGeneratedWith, DeleteDraftsResult } from "./drafts";
export type {
  AppPreferencesInput,
  DefaultLlmSettingsInput,
  EmbeddingSettingsSaveInput,
  EmbeddingQueryInfo,
  FontPreferences,
  GlobalSettingsSaveInput,
  LlmQueryInfo,
  LlmSettingsInfo,
  OnboardingDefaults,
  SecretStorageCapabilities,
  SettingsSummary,
  SyncSettingsSaveInput,
  TestConnectionRequest,
  TestConnectionResponse,
  WriterSessionConfig,
} from "./settings";
export type {
  AuSettingsSaveInput,
  ProjectEmbeddingOverrideInput,
  ProjectCapabilities,
  ProjectLlmOverrideInput,
  ProjectLlmQueryInfo,
  ProjectWritingStyleInput,
  WorkspaceSnapshot,
  WriterProjectContext,
} from "./project";
export type { FandomDisplayInfo, FandomInfo, FandomFileEntry, FandomFilesResponse } from "./fandoms";
export type { TrashScope } from "./trash";
export type { GenerateParams } from "./generate";
export type { SettingsChatMode, SettingsChatMessagePayload, SettingsChatSessionLlm, SettingsChatToolCall, SettingsChatResponse } from "./settingsChat";
export type { ChapterPreview, ImportUploadResponse, ImportConfirmResponse } from "./importExport";
export type { TrashEntry } from "@ficforge/engine";

// Re-export ApiError for compatibility with components that use it for error handling
export { ApiError, getFriendlyErrorMessage } from "./client";

// Import v2 types + classification
export type { FileAnalysis, ImportPlan, ImportConflictOptions, NewImportResult, ImportProgress, AnalysisOptions } from "@ficforge/engine";
export type { ClassifiedTurn, ClassificationReason, ClassificationThresholds } from "@ficforge/engine";
export { classifyTurns } from "@ficforge/engine";

// Enum value arrays (for UI validation)
export { FACT_TYPE_VALUES, FACT_STATUS_VALUES, NARRATIVE_WEIGHT_VALUES } from "@ficforge/engine";

// Sync types
export type { WebDAVConfig, AggregatedSyncResult } from "./engine-sync";

// ---------------------------------------------------------------------------
// Engine 实例管理（从 engine-instance.ts re-export）
// ---------------------------------------------------------------------------
export type { EngineInstance } from "./engine-instance";
export { initEngine, getEngine, isEngineReady, getDataDir, getDisplayDataDir } from "./engine-instance";

// ---------------------------------------------------------------------------
// Domain module re-exports
// ---------------------------------------------------------------------------

export {
  getSettingsForEditing,
  getSettingsSecretCapabilities,
  getSettingsSummary,
  getFontPreferences,
  getOnboardingDefaults,
  getWriterSessionConfig,
  saveAppPreferences,
  saveDefaultLlmSettings,
  saveFontPreferences,
  saveGlobalSettingsForEditing,
  saveGlobalModelParams,
  saveOnboardingSettings,
  saveSyncSettings,
  testConnection,
  testEmbeddingConnection,
} from "./engine-settings";
export { getState, setChapterFocus, rebuildIndex, recalcState } from "./engine-state";
export { listFacts, addFact, editFact, updateFactStatus, batchUpdateFactStatus, extractFacts, extractFactsBatch, submitFactsExtraction } from "./engine-facts";
export {
  getProjectCapabilities,
  getProjectForEditing,
  getWorkspaceSnapshot,
  getWriterProjectContext,
  saveAuSettingsForEditing,
  saveProjectCastRegistryAndCoreIncludes,
  saveProjectCastRegistryCharacters,
  saveProjectCoreIncludes,
  saveProjectModelParamsOverride,
  saveProjectWritingStyle,
  addPinned,
  deletePinned,
} from "./engine-project";
export { listChapters, getChapter, getChapterContent, confirmChapter, undoChapter, updateChapterTitle, resolveDirtyChapter, updateChapterContent } from "./engine-chapters";
export { listDrafts, getDraft, saveDraft, deleteDrafts } from "./engine-drafts";
export { generateChapter } from "./engine-generate";
export { listTrash, restoreTrash, permanentDeleteTrash, purgeTrash } from "./engine-trash";
export { saveLore, readLore, deleteLore, listLoreFiles, importFromFandom, getLoreContent } from "./engine-lore";
export { sendSettingsChat } from "./engine-settings-chat";
export { listFandoms, getFandomDisplayInfo, createFandom, listAus, createAu, deleteFandom, deleteAu, listFandomFiles, readFandomFile, renameFandom, renameAu } from "./engine-fandom";
export { exportChapters, importChaptersFromText } from "./engine-export";
export { migrateLegacySecureStorage } from "./engine-security";

// Logger re-exports
export { initLogger, getLogger, logCatch } from "@ficforge/engine";
