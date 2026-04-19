// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import type { ModelParamInfo } from "./settings";

export interface ProjectLlmQueryInfo {
  mode: string;
  model: string;
  api_base: string;
  has_api_key: boolean;
  local_model_path: string;
  ollama_model: string;
  context_window: number;
  has_override: boolean;
}

export interface WriterProjectContext {
  llm: ProjectLlmQueryInfo;
  model_params_override: Record<string, ModelParamInfo>;
}

export interface WorkspaceSnapshot {
  pinned_count: number;
}

export interface ProjectWritingStyleInput {
  perspective: string;
  emotion_style: string;
  custom_instructions: string;
}

export interface ProjectLlmOverrideInput {
  enabled: boolean;
  mode: string;
  model: string;
  api_base: string;
  api_key: string;
  local_model_path: string;
  ollama_model: string;
  context_window: number;
}

export interface ProjectEmbeddingOverrideInput {
  enabled: boolean;
  model: string;
  api_base: string;
  api_key: string;
}

export interface AuSettingsSaveInput {
  chapter_length: number;
  writing_style: ProjectWritingStyleInput;
  pinned_context: string[];
  core_always_include: string[];
  llm_override: ProjectLlmOverrideInput;
  embedding_override: ProjectEmbeddingOverrideInput;
}
