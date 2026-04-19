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
