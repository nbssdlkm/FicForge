// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/** 生成 API（SSE 流式） */

import { sseStream } from "./client";

export interface GenerateParams {
  au_path: string;
  chapter_num: number;
  user_input: string;
  input_type: "continue" | "instruction";
  session_llm?: {
    mode?: string;
    model?: string;
    api_base?: string;
    api_key?: string;
    local_model_path?: string;
    ollama_model?: string;
  };
  session_params?: object;
}

export interface ContextSummary {
  characters_used: string[];
  worldbuilding_used: string[];
  facts_injected: number;
  facts_as_focus: string[];
  pinned_count: number;
  rag_chunks_retrieved: number;
  total_input_tokens: number;
  truncated_layers: string[];
  truncated_characters: string[];
}

export async function* generateChapter(params: GenerateParams) {
  for await (const event of sseStream("/api/v1/generate/stream", params)) {
    yield event;
  }
}
