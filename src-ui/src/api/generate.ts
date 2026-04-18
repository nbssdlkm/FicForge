// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

/** 生成 API（SSE 流式） */

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
