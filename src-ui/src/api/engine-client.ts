// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Client — 核心初始化 + 领域模块 re-export。
 *
 * 各领域函数已拆分至独立模块（engine-state.ts, engine-facts.ts 等），
 * 本文件保留 Engine 实例管理并 re-export 全部公共 API，
 * UI 组件的 import 路径无需改动。
 */

import type { PlatformAdapter } from "@ficforge/engine";
import {
  FileChapterRepository,
  FileDraftRepository,
  FileFactRepository,
  FileFandomRepository,
  FileOpsRepository,
  FileProjectRepository,
  FileSettingsRepository,
  FileStateRepository,
  TrashService,
  RagManager,
  JsonVectorEngine,
  TaskRunner,
  getLogger,
  hasLogger,
} from "@ficforge/engine";

// ---------------------------------------------------------------------------
// Type re-exports: engine domain types (aliased for backward compat)
// ---------------------------------------------------------------------------
export type { State as StateInfo } from "@ficforge/engine";
export type { Fact as FactInfo } from "@ficforge/engine";
export type { Draft as DraftDetail } from "@ficforge/engine";
export type { Project as ProjectInfo } from "@ficforge/engine";
export type { Settings as SettingsInfo } from "@ficforge/engine";
export type { WritingStyle, CastRegistry, EmbeddingLock, ContextSummary } from "@ficforge/engine";
export { FactStatus, IndexStatus, LLMMode, Provenance } from "@ficforge/engine";

// UI-specific types (no engine equivalent)
export type { ExtractedFactCandidate, ExtractFactsResponse } from "./facts";
export type { ChapterInfo } from "./chapters";
export type { DraftListItem, DraftGeneratedWith, DeleteDraftsResult } from "./drafts";
export type { LlmSettingsInfo, TestConnectionRequest, TestConnectionResponse } from "./settings";
export type { FandomInfo, FandomFileEntry, FandomFilesResponse } from "./fandoms";
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
// Engine 实例管理
// ---------------------------------------------------------------------------

export interface EngineInstance {
  adapter: PlatformAdapter;
  dataDir: string;
  repos: {
    chapter: FileChapterRepository;
    draft: FileDraftRepository;
    fact: FileFactRepository;
    fandom: FileFandomRepository;
    ops: FileOpsRepository;
    project: FileProjectRepository;
    settings: FileSettingsRepository;
    state: FileStateRepository;
  };
  trash: TrashService;
  vectorEngine: JsonVectorEngine;
  ragManager: RagManager;
  taskRunner: TaskRunner;
}

let _engine: EngineInstance | null = null;

export function initEngine(adapter: PlatformAdapter, dataDir: string): void {
  // Logger 在 engine 之前初始化（App.tsx 中调用 initLogger）
  // 这里记录引擎启动
  if (hasLogger()) getLogger().info("engine", "initEngine", { platform: adapter.getPlatform(), dataDir });

  const vectorEngine = new JsonVectorEngine(adapter);
  _engine = {
    adapter,
    dataDir,
    repos: {
      chapter: new FileChapterRepository(adapter),
      draft: new FileDraftRepository(adapter),
      fact: new FileFactRepository(adapter),
      fandom: new FileFandomRepository(adapter),
      ops: new FileOpsRepository(adapter),
      project: new FileProjectRepository(adapter),
      settings: new FileSettingsRepository(adapter, dataDir),
      state: new FileStateRepository(adapter),
    },
    trash: new TrashService(adapter),
    vectorEngine,
    ragManager: new RagManager(vectorEngine),
    taskRunner: new TaskRunner(adapter, dataDir),
  };
}

export function getEngine(): EngineInstance {
  if (!_engine) throw new Error("Engine not initialized. Call initEngine() first.");
  return _engine;
}

export function isEngineReady(): boolean {
  return _engine !== null;
}

/** 获取数据根目录（所有 fandom 操作的基础路径）。 */
export function getDataDir(): string {
  return getEngine().dataDir;
}

/** 异步获取显示用数据路径（Capacitor 返回 file:// URI，Tauri 返回绝对路径）。 */
export async function getDisplayDataDir(): Promise<string> {
  return getEngine().adapter.getDataDir();
}

// ---------------------------------------------------------------------------
// Domain module re-exports
// ---------------------------------------------------------------------------

export { getSettings, updateSettings, testConnection } from "./engine-settings";
export { getState, setChapterFocus, rebuildIndex, recalcState } from "./engine-state";
export { listFacts, addFact, editFact, updateFactStatus, batchUpdateFactStatus, extractFacts, extractFactsBatch, submitFactsExtraction } from "./engine-facts";
export { getProject, updateProject, addPinned, deletePinned } from "./engine-project";
export { listChapters, getChapter, getChapterContent, confirmChapter, undoChapter, updateChapterTitle, resolveDirtyChapter, updateChapterContent } from "./engine-chapters";
export { listDrafts, getDraft, saveDraft, deleteDrafts } from "./engine-drafts";
export { generateChapter } from "./engine-generate";
export { listTrash, restoreTrash, permanentDeleteTrash, purgeTrash } from "./engine-trash";
export { saveLore, readLore, deleteLore, listLoreFiles, importFromFandom, getLoreContent } from "./engine-lore";
export { sendSettingsChat } from "./engine-settings-chat";
export { listFandoms, createFandom, listAus, createAu, deleteFandom, deleteAu, listFandomFiles, readFandomFile, renameFandom, renameAu } from "./engine-fandom";
export { exportChapters, importChaptersFromText } from "./engine-export";

// Logger re-exports
export { initLogger, getLogger, logCatch } from "@ficforge/engine";
