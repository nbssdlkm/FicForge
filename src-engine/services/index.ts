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
