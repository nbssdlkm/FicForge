// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** Services 导出。 */

// Facts Lifecycle
export {
  add_fact,
  archive_fact,
  archive_facts,
  ARCHIVE_DISTANCE,
  edit_fact,
  FactsLifecycleError,
  find_archival_candidates,
  isArchivalCandidate,
  run_archival_sweep,
  set_chapter_focus,
  unarchive_fact,
  update_fact_status,
} from "./facts_lifecycle.js";

// Facts Extraction
export type { ExtractedFact, ExtractFactsOptions } from "./facts_extraction.js";
export {
  extract_facts_batch,
  extract_facts_from_chapter,
  parseLLMOutput,
} from "./facts_extraction.js";

// M9 ReAct 事实提取
export type { ReactExtractOptions, ReactExtractResult, ReactExtractStatus } from "./react_extraction_dispatch.js";
export { reactExtractFromChapter, REACT_EXTRACTION_MAX_ITER } from "./react_extraction_dispatch.js";
export { EXTRACTION_TOOLS, EXTRACTION_TOOL_SCHEMAS } from "./react_extraction_tools.js";
export type { FactSearchHit } from "./react_extraction_search.js";
export { executeSearchExistingFacts } from "./react_extraction_search.js";

// Context Assembler
export type { AssembleContextResult, AssembleChatContextResult, AssembleChatContextParams } from "./context_assembler.js";
export {
  assemble_context,
  assemble_chat_context,
  build_core_settings_layer,
  build_facts_layer,
  build_instruction,
  build_recent_chapter_layer,
  build_system_prompt,
} from "./context_assembler.js";

// FicForge Lite simple_assembler 的轻量 token 估算入口（C5 顶栏 badge）
export type { SimpleContextTokenEstimate, EstimateSimpleContextParams } from "./estimate_simple_tokens.js";
export { estimate_simple_context_tokens } from "./estimate_simple_tokens.js";

// FicForge Lite simple_chat dispatch — 单次 LLM streaming + tools 同时支持
// 写章节 / show_chapter / show_setting / modify_*_file 等
export type { SimpleChatEvent, SimpleChatDispatchParams } from "./simple_chat_dispatch.js";
export {
  dispatch_simple_chat,
  SIMPLE_TOOL_SHOW_CHAPTER,
  SIMPLE_TOOL_SHOW_SETTING,
} from "./simple_chat_dispatch.js";

// RAG Retrieval
export {
  build_active_chars,
  build_rag_query,
  retrieve_rag,
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
export { generate_chapter, is_empty_intent } from "./generation.js";

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
export { confirm_chapter, ConfirmChapterError } from "./confirm_chapter.js";

// Undo Chapter
export type { UndoChapterParams, UndoChapterResult } from "./undo_chapter.js";
export { undo_latest_chapter, UndoChapterError } from "./undo_chapter.js";

// Dirty Resolve
export type { ResolveDirtyParams, ResolveDirtyResult } from "./dirty_resolve.js";
export { resolve_dirty_chapter, DirtyResolveError } from "./dirty_resolve.js";

// Import Pipeline (backward-compatible)
export type { ImportChaptersParams, ImportResult, SplitChapter } from "./import_pipeline.js";
export { get_split_method, import_chapters, parse_html, split_into_chapters } from "./import_pipeline.js";

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
export { export_chapters } from "./export_service.js";

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
export { build_settings_context, call_settings_llm } from "./settings_chat.js";

// Trash Service
export type { TrashEntry, RestoreConflictPolicy } from "./trash_service.js";
export { TrashService, RESTORE_CONFLICT_MARKER, HALF_RESTORED_MARKER } from "./trash_service.js";

// Chapter Summary (M8-C + M10-A)
export type {
  GenerateSummaryOptions,
  PersistSummaryDeps,
} from "./chapter_summary.js";
export {
  generate_micro_summary,
  generate_standard_summary,
  persist_chapter_summary,
  find_chapters_missing_summary,
} from "./chapter_summary.js";

// 补全旧章记忆（plan 3.1）—— 逐章统一 pass（摘要 + 笔记 + 向量）
export type {
  BackfillMemoryTarget,
  BackfillMemoryDeps,
  BackfillMemoryResult,
} from "./backfill_memory.js";
export { backfill_chapter_memory } from "./backfill_memory.js";

// Retrospective Rewrite (M10-A)
export type { RetrospectiveOptions, RetrospectiveGenResult } from "./retrospective.js";
export {
  run_retrospective,
  generate_retrospective,
  commit_retrospective,
  shouldRunRetrospective,
  RETROSPECTIVE_INTERVAL,
} from "./retrospective.js";

// Secure Storage Migration
export type {
  SecureStorageMigrationParams,
  SecureStorageMigrationResult,
} from "./secure_storage_migration.js";
export { migrate_legacy_secure_storage } from "./secure_storage_migration.js";

// Recalc State
export type { RecalcResult } from "./recalc_state.js";
export { recalc_state } from "./recalc_state.js";

// Title Generator
export { generateChapterTitle } from "./title_generator.js";

// Snapshot — checkAndSnapshot 暂不导出（M6 接入后启用）

// RAG Manager
export { RagManager } from "./rag_manager.js";

// Chapter Edit
export type { EditChapterContentResult } from "./chapter_edit.js";
export { edit_chapter_content } from "./chapter_edit.js";

// Write Transaction
export {
  PARTIAL_COMMIT_CHAPTER_MISSING,
  PARTIAL_COMMIT_OPS_ONLY,
  PartialCommitError,
  WriteTransaction,
} from "./write_transaction.js";
export type { PartialCommitErrorCode } from "./write_transaction.js";

// AU Lock（供 UI API 层在直接调用底层 services 时顶层加锁，避免跨服务交叉写）
export { withAuLock } from "./au_lock.js";
