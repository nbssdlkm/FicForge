// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** @ficforge/engine — 统一导出。 */

// Domain
// C3 边界收窄（盲审 2026-07-11 架构维）：不再 export * —— 公共 API = UI 实际消费面的
// 显式清单。新增对外符号必须手动加进来（UI 侧 tsc 会红给你看），内部 helper 不再
// 因 barrel 顺手导出而意外成为对外契约。引擎内部代码一律走相对路径/子 barrel，不受影响。
export {
  AU_CHARACTERS_DIR,
  EmotionStyle,
  FACT_STATUS_VALUES,
  FACT_TYPE_VALUES,
  FactStatus,
  IndexStatus,
  LLMMode,
  NARRATIVE_WEIGHT_VALUES,
  OLLAMA_DEFAULT_BASE_URL,
  Perspective,
  Provenance,
  RAG_COLLECTIONS,
  ThreadStatus,
  asSimpleChatMessages,
  contextWindowForModel,
  createChapterSummary,
  createDraft,
  createFontsConfig,
  createOpsEntry,
  createProject,
  createSettings,
  createThread,
  draftFilename,
  findRecommendedModel,
  getProvider,
  isSettingsMutatingToolName,
  isSimpleMutatingToolName,
  listProviders,
  parseChapterMainPath,
} from "./domain/index.js";
export type {
  BudgetReport,
  CastRegistry,
  ContextSummary,
  CustomModelEntry,
  CustomProviderEntry,
  Draft,
  EmbeddingConfig,
  EmbeddingLock,
  Fact,
  GeneratedWith,
  LLMConfig,
  ModelKind,
  ModelTag,
  Project,
  RagChunkDetail,
  RagCollection,
  RecommendedModel,
  Settings,
  SettingsMutatingToolName,
  SimpleAssistantMessage,
  SimpleAssistantToolCall,
  SimpleChapterPreviewMessage,
  SimpleChatFile,
  SimpleChatMessage,
  SimpleChatMessageEnvelope,
  SimpleDraftStatus,
  SimpleMessageKind,
  SimpleMutatingToolName,
  SimpleSettingPreviewMessage,
  SimpleSystemMessage,
  SimpleSystemTone,
  SimpleToolCallMessage,
  SimpleToolCallStatus,
  SimpleToolResultMessage,
  SimpleUserMessage,
  SimpleWritingDraftMessage,
  State,
  Thread,
  ToolUndoMeta,
  WritingStyle,
} from "./domain/index.js";

// Prompts
export { getPrompts } from "./prompts/index.js";
export type { PromptKey, PromptModule } from "./prompts/index.js";

// Tokenizer
export { clear_tokenizer_cache, count_tokens, ensure_tokenizer } from "./tokenizer/index.js";
export type { TokenCount } from "./tokenizer/index.js";

// Platform
export type {
  OpenDialogOptions,
  PlatformAdapter,
  SaveDialogOptions,
  SecretStorageCapabilities,
} from "./platform/index.js";
export { CapacitorAdapter, SecretStoreReadError, TauriAdapter, WebAdapter } from "./platform/index.js";

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
  SimpleChatRepository,
  StateRepository,
  VectorChunk,
  VectorRepository,
  ChapterSummaryRepository,
  ThreadRepository,
} from "./repositories/interfaces/index.js";

// Repository implementations
export {
  customProviderApiKeySecureKey,
  FileChapterRepository,
  FileChapterSummaryRepository,
  FileDraftRepository,
  FileFactRepository,
  FileFandomRepository,
  FileOpsRepository,
  FileProjectRepository,
  FileSettingsRepository,
  FileSimpleChatRepository,
  FileStateRepository,
  FileThreadRepository,
  compute_content_hash,
  generate_fact_id,
  generate_op_id,
  generate_thread_id,
  now_utc,
} from "./repositories/implementations/index.js";

// Vector engine
export { cosine_similarity, JsonVectorEngine, split_chapter_into_chunks } from "./vector/index.js";
export type { ChunkData } from "./vector/index.js";

// LLM
export type {
  EmbeddingModeKey,
  EmbeddingProvider,
  GenerateParams,
  LLMChunk,
  LLMModeKey,
  LLMProvider,
  LLMResponse,
  Message,
  ModeAvailability,
  Platform,
  ResolvedLLMConfig,
  ResolvedLLMParams,
  ToolCall,
  ToolDefinition,
} from "./llm/index.js";
export {
  create_provider,
  isPlaintextRemoteHttp,
  warnIfPlaintextRemote,
  getEmbeddingModeAvailability,
  getGenerationModeAvailability,
  listGenerationModes,
  LLMError,
  OpenAICompatibleProvider,
  RemoteEmbeddingProvider,
  resolve_llm_config,
  resolve_llm_params,
} from "./llm/index.js";

// Services
export {
  AU_BUNDLE_EXCLUDED_DIRS,
  AU_BUNDLE_VERSION,
  HALF_RESTORED_MARKER,
  RESTORE_CONFLICT_MARKER,
  RETROSPECTIVE_INTERVAL,
  CharacterAliasManager,
  RagManager,
  SIMPLE_TOOL_SHOW_CHAPTER,
  SIMPLE_TOOL_SHOW_SETTING,
  TrashService,
  WriteTransaction,
  add_fact,
  archive_facts,
  backfill_chapter_memory,
  build_settings_context,
  call_settings_llm,
  chapterInflightKey,
  chatToOpenAIMessages,
  classifyTurns,
  collectAuBundle,
  commit_retrospective,
  computeThreadStaleness,
  confirm_chapter,
  dispatch_simple_chat,
  edit_chapter_content,
  edit_fact,
  estimate_simple_context_tokens,
  export_chapters,
  find_archival_candidates,
  find_chapters_missing_summary,
  generateChapterTitle,
  generate_chapter,
  generate_micro_summary,
  generate_retrospective,
  generate_standard_summary,
  importAuBundle,
  isChapterInflight,
  markChapterInflight,
  migrate_legacy_secure_storage,
  persist_chapter_summary,
  recalc_state,
  regenerateThreadState,
  releaseChapterInflight,
  resolve_dirty_chapter,
  set_chapter_focus,
  should_run_retrospective,
  threadMemberFacts,
  unarchive_fact,
  undo_latest_chapter,
  update_fact_status,
  validateBundle,
  withAuLock,
  withProjectFileLock,
  analyze_file,
  build_import_plan,
  execute_import,
  extractFactsFromChapter,
  parse_html,
  reactExtractFromChapter,
} from "./services/index.js";
export type {
  AnalysisOptions,
  AnalysisStage,
  AuBundle,
  BackfillMemoryResult,
  BackfillMemoryTarget,
  ClassificationReason,
  ClassificationThresholds,
  ClassifiedTurn,
  FileAnalysis,
  ImportConflictOptions,
  ImportPlan,
  ImportProgress,
  NewImportResult,
  OpenAIChatMessage,
  RestoreConflictPolicy,
  SimpleChatEvent,
  SimpleContextTokenEstimate,
  ThreadStaleness,
  TrashEntry,
} from "./services/index.js";

// Tasks
export {
  TaskRunner,
  createFactsExtractionTask,
} from "./tasks/index.js";
export type { TaskEvent } from "./tasks/index.js";

// Ops projection (ops.jsonl audit-log projection: sort / rebuild / lamport clock)
// ops 层零对外消费（D-0040 后仅审计日志投影，引擎内部使用）—— 不再进入公共 API。

// Logger
export type { LogEntry, LogLevel, LoggerOptions } from "./logger/index.js";
export { FileLogger, getLogger, hasLogger, initLogger, logCatch } from "./logger/index.js";
export type { Logger } from "./logger/index.js";

// Fonts
export {
  BrowserFontRegistry,
  FONT_MANIFEST,
  FontDownloader,
  FontError,
  FontStorage,
  FontsService,
  NoopFontRegistry,
  SYSTEM_FONT_ID,
  SYSTEM_FONT_STACK,
  filterFontsByType,
  getFontById,
  resolveFontStack,
  scriptSlotOf,
  sha256Hex,
} from "./fonts/index.js";
export type {
  BuiltinFont,
  DownloadProgress,
  DownloadableFont,
  DownloaderOptions,
  FetchLike,
  FontCategory,
  FontDownloadEvent,
  FontDownloadListener,
  FontEntry,
  FontRegistry,
  FontRole,
  FontScript,
  FontSource,
  FontStatus,
  FontType,
  InstallOptions,
  ProgressCallback,
} from "./fonts/index.js";

// ---------------------------------------------------------------------------
// utils —— 取消错误单一判据（UI 与引擎共用，盲审 2026-07-11 对抗审：
// 不导出则 UI 侧被结构性排除在单源之外，只能各自手写 instanceof 判据）
// ---------------------------------------------------------------------------
export { createAbortError, isAbortError } from "./utils/abort_error.js";
export { assertNever } from "./utils/assert_never.js";
