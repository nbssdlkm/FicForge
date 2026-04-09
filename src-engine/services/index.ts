// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** Services 导出。 */

// Facts Lifecycle
export {
  add_fact,
  edit_fact,
  FactsLifecycleError,
  set_chapter_focus,
  update_fact_status,
} from "./facts_lifecycle.js";

// Facts Extraction
export type { ExtractedFact } from "./facts_extraction.js";
export {
  extract_facts_batch,
  extract_facts_from_chapter,
  parseLLMOutput,
} from "./facts_extraction.js";

// Context Assembler
export type { AssembleContextResult } from "./context_assembler.js";
export {
  assemble_context,
  build_core_settings_layer,
  build_facts_layer,
  build_instruction,
  build_recent_chapter_layer,
  build_system_prompt,
} from "./context_assembler.js";

// RAG Retrieval
export {
  build_active_chars,
  build_rag_query,
  retrieve_rag,
} from "./rag_retrieval.js";

// Generation
export type {
  GenerateChapterParams,
  GenerationDoneData,
  GenerationErrorData,
  GenerationEvent,
} from "./generation.js";
export { generate_chapter, is_empty_intent } from "./generation.js";

// Confirm Chapter
export type { ConfirmChapterParams, ConfirmChapterResult } from "./confirm_chapter.js";
export { confirm_chapter, ConfirmChapterError } from "./confirm_chapter.js";

// Undo Chapter
export type { UndoChapterParams, UndoChapterResult } from "./undo_chapter.js";
export { undo_latest_chapter, UndoChapterError } from "./undo_chapter.js";

// Dirty Resolve
export type { ResolveDirtyParams, ResolveDirtyResult } from "./dirty_resolve.js";
export { resolve_dirty_chapter, DirtyResolveError } from "./dirty_resolve.js";

// Import Pipeline
export type { ImportChaptersParams, ImportResult, SplitChapter } from "./import_pipeline.js";
export { get_split_method, import_chapters, parse_html, split_into_chapters } from "./import_pipeline.js";

// Export Service
export type { ExportParams } from "./export_service.js";
export { export_chapters } from "./export_service.js";

// Settings Chat
export type { SettingsChatParams, SettingsChatResult } from "./settings_chat.js";
export { build_settings_context, call_settings_llm } from "./settings_chat.js";

// Trash Service
export type { TrashEntry } from "./trash_service.js";
export { TrashService } from "./trash_service.js";

// Recalc State
export type { RecalcResult } from "./recalc_state.js";
export { recalc_state } from "./recalc_state.js";
