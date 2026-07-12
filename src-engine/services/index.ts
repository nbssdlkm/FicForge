// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** Services 导出。 */

// Facts Lifecycle
export {
  addFact,
  archiveFact,
  archiveFacts,
  ARCHIVE_DISTANCE,
  editFact,
  FactsLifecycleError,
  findArchivalCandidates,
  isArchivalCandidate,
  runArchivalSweep,
  setChapterFocus,
  unarchiveFact,
  updateFactStatus,
} from "./facts_lifecycle.js";

// Facts Extraction
export type { ExtractedFact, ExtractFactsOptions } from "./facts_extraction.js";
export {
  extractFactsBatch,
  extractFactsFromChapter,
  parseLLMOutput,
} from "./facts_extraction.js";

// M9 ReAct 事实提取
export type { ReactExtractOptions, ReactExtractResult, ReactExtractStatus } from "./react_extraction_dispatch.js";
export { reactExtractFromChapter, REACT_EXTRACTION_MAX_ITER } from "./react_extraction_dispatch.js";
export { EXTRACTION_TOOLS, EXTRACTION_TOOL_SCHEMAS } from "./react_extraction_tools.js";
export type { FactSearchHit } from "./react_extraction_search.js";
export { executeSearchExistingFacts } from "./react_extraction_search.js";

// Context Assembler
export type {
  AssembleContextResult,
  AssembleChatContextResult,
  AssembleChatContextParams,
} from "./context_assembler.js";
export {
  assembleContext,
  assembleChatContext,
  buildCoreSettingsLayer,
  buildFactsLayer,
  buildInstruction,
  buildRecentChapterLayer,
  buildSystemPrompt,
} from "./context_assembler.js";

// FicForge Lite simple_assembler 的轻量 token 估算入口（C5 顶栏 badge）
export type { SimpleContextTokenEstimate, EstimateSimpleContextParams } from "./estimate_simple_tokens.js";
export { estimateSimpleContextTokens } from "./estimate_simple_tokens.js";

// FicForge Lite simple_chat dispatch — 单次 LLM streaming + tools 同时支持
// 写章节 / show_chapter / show_setting / modify_*_file 等
export type { SimpleChatEvent, SimpleChatDispatchParams } from "./simple_chat_dispatch.js";
export {
  dispatchSimpleChat,
  SIMPLE_TOOL_SHOW_CHAPTER,
  SIMPLE_TOOL_SHOW_SETTING,
} from "./simple_chat_dispatch.js";

// FicForge Lite chat history → OpenAI messages 转换（盲审长期债④下沉；UI 薄 re-export）
export type { OpenAIChatMessage } from "./chat_to_llm.js";
export { chatToOpenAIMessages } from "./chat_to_llm.js";

// RAG Retrieval
export {
  buildActiveChars,
  buildRagQuery,
  retrieveRag,
  retrieveRagForContext,
} from "./rag_retrieval.js";
export type { RetrieveRagForContextArgs } from "./rag_retrieval.js";

// Generation
export type {
  GenerateChapterParams,
  GenerationDoneData,
  GenerationErrorData,
  GenerationEvent,
} from "./generation.js";
export { generateChapter, isEmptyIntent } from "./generation.js";

// Chapter Inflight — 同 (au, chapter) 的「草稿生成在飞」互斥表（写文/对话共享单一真相源）。
// 导出给 UI 编排层：confirm 等「会改写目标章」的入口在动手前查表拒绝（R1-3），
// 避免接受/定稿覆盖一条正在流式写入的草稿。
export {
  chapterInflightKey,
  isChapterInflight,
  markChapterInflight,
  releaseChapterInflight,
} from "./chapter_inflight.js";

// Confirm Chapter
export type { ConfirmChapterParams, ConfirmChapterResult } from "./confirm_chapter.js";
export { confirmChapter, ConfirmChapterError } from "./confirm_chapter.js";

// Undo Chapter
export type { UndoChapterParams, UndoChapterResult } from "./undo_chapter.js";
export { undoLatestChapter, UndoChapterError } from "./undo_chapter.js";

// Dirty Resolve
export type { ResolveDirtyParams, ResolveDirtyResult } from "./dirty_resolve.js";
export { resolveDirtyChapter, DirtyResolveError } from "./dirty_resolve.js";

// Import Pipeline (backward-compatible)
export type { ImportChaptersParams, ImportResult, SplitChapter } from "./import_pipeline.js";
export { getSplitMethod, importChapters, parseHtml, splitIntoChapters } from "./import_pipeline.js";

// Import Pipeline v2 (new API)
export type {
  AnalysisOptions,
  AnalysisStage,
  ExecuteImportParams,
  FileAnalysis,
  ImportChapter,
  ImportConflictOptions,
  ImportPlan,
  ImportProgress,
  ImportSetting,
  NewImportResult,
} from "./import_pipeline.js";
export { analyzeFile, buildImportPlan, executeImport } from "./import_pipeline.js";

// Chat Parser
export type {
  ChatFormatPattern,
  ChatTurn,
  ClassificationReason,
  ClassificationThresholds,
  ClassifiedTurn,
} from "./chat_parser.js";
export {
  classifyTurns,
  DEFAULT_THRESHOLDS,
  detectChatFormat,
  isJsonChatExport,
  parseChatExport,
  splitByRole,
} from "./chat_parser.js";

// Chapter Splitter
export type { ChapterPatternResult, SplitOptions, SplitResult } from "./chapter_splitter.js";
export {
  buildRegexFromPattern,
  llmDetectChapterPattern,
  splitByCharCount,
  splitChapters,
  trySplitByNumericHeaders,
  trySplitByStandardHeaders,
} from "./chapter_splitter.js";

// Export Service
export type { ExportParams } from "./export_service.js";
export { exportChapters } from "./export_service.js";

// 全量 AU 备份导出/导入（TD-015）
export type {
  AuBundle,
  AuBundleManifest,
  CollectAuBundleOptions,
  ImportAuBundleOptions,
  ImportAuBundleResult,
} from "./au_bundle.js";
export {
  AU_BUNDLE_VERSION,
  AU_BUNDLE_EXCLUDED_DIRS,
  AuBundleError,
  collectAuBundle,
  importAuBundle,
  validateBundle,
} from "./au_bundle.js";

// Settings Chat
export type { SettingsChatParams, SettingsChatResult } from "./settings_chat.js";
export { buildSettingsContext, callSettingsLlm } from "./settings_chat.js";

// Trash Service
export type { TrashEntry, RestoreConflictPolicy } from "./trash_service.js";
export { TrashService, RESTORE_CONFLICT_MARKER, HALF_RESTORED_MARKER } from "./trash_service.js";

// Chapter Summary (M8-C + M10-A)
export type {
  GenerateSummaryOptions,
  PersistSummaryDeps,
} from "./chapter_summary.js";
export {
  generateMicroSummary,
  generateStandardSummary,
  persistChapterSummary,
  findChaptersMissingSummary,
} from "./chapter_summary.js";

// 补全旧章记忆（plan 3.1）—— 逐章统一 pass（摘要 + 笔记 + 向量）
export type {
  BackfillMemoryTarget,
  BackfillMemoryDeps,
  BackfillMemoryResult,
} from "./backfill_memory.js";
export { backfillChapterMemory } from "./backfill_memory.js";

// Retrospective Rewrite (M10-A)
export type { RetrospectiveOptions, RetrospectiveGenResult } from "./retrospective.js";
export {
  runRetrospective,
  generateRetrospective,
  commitRetrospective,
  shouldRunRetrospective,
  RETROSPECTIVE_INTERVAL,
} from "./retrospective.js";

export type { ThreadStaleness } from "./thread_state.js";
export {
  computeThreadStaleness,
  threadMemberFacts,
  regenerateThreadState,
  THREAD_STATE_MAX_FACTS,
} from "./thread_state.js";

// Secure Storage Migration
export type {
  SecureStorageMigrationParams,
  SecureStorageMigrationResult,
} from "./secure_storage_migration.js";
export { migrateLegacySecureStorage } from "./secure_storage_migration.js";

// Recalc State
export type { RecalcResult } from "./recalc_state.js";
export { recalcState } from "./recalc_state.js";

// Title Generator
export { generateChapterTitle } from "./title_generator.js";

// Snapshot — checkAndSnapshot 暂不导出（M6 接入后启用）

// RAG Manager
export { RagManager } from "./rag_manager.js";

// Character Alias Table（角色卡 frontmatter → 别名归一化表）
export { CharacterAliasManager, buildAliasTable } from "./character_alias_table.js";
export type { CharacterCardInput } from "./character_alias_table.js";

// Chapter Edit
export type { EditChapterContentResult } from "./chapter_edit.js";
export { editChapterContent } from "./chapter_edit.js";

// Write Transaction
export {
  PARTIAL_COMMIT_CHAPTER_MISSING,
  PARTIAL_COMMIT_OPS_ONLY,
  PartialCommitError,
  WriteTransaction,
} from "./write_transaction.js";
export type { PartialCommitErrorCode } from "./write_transaction.js";

// AU Lock（供 UI API 层在直接调用底层 services 时顶层加锁，避免跨服务交叉写）
export { withAuLock, withProjectFileLock } from "./au_lock.js";

// Lore Service（角色卡/世界观资料 CRUD —— R4 架构 HIGH E3 下沉，UI api 只做薄转发）
export {
  deleteLore,
  importLoreFromFandom,
  listLoreFiles,
  readLore,
  readLoreWithLegacyFallback,
  saveLore,
} from "./lore_service.js";
export type { LoreFileRef, LoreServiceDeps } from "./lore_service.js";

// Fandom Service（Fandom/AU 查询与命令 —— 同上 E3 下沉）
export {
  createAu,
  createFandom,
  deleteAu,
  deleteFandom,
  getFandomDisplayInfo,
  listAus,
  listFandomFiles,
  listFandoms,
  readFandomFile,
} from "./fandom_service.js";
export type { FandomAuInfo, FandomDisplayInfo, FandomServiceDeps } from "./fandom_service.js";
