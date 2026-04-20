// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import type { DefaultLlmSettingsInput } from "../../api/engine-client";

export interface LlmConfigFields {
  mode: string;
  model: string;
  apiBase: string;
  apiKey: string;
  localModelPath: string;
  ollamaModel: string;
}

export function buildLlmConnectionTestRequest(fields: LlmConfigFields) {
  return {
    mode: fields.mode,
    model: fields.mode === "ollama" ? fields.ollamaModel : fields.model,
    api_base: fields.mode === "ollama" ? (fields.apiBase || "http://localhost:11434/v1") : fields.apiBase,
    api_key: fields.mode === "api" ? fields.apiKey : "",
    local_model_path: fields.mode === "local" ? fields.localModelPath : "",
    ollama_model: fields.mode === "ollama" ? fields.ollamaModel : "",
  };
}

export function canTestLlmConnection(fields: LlmConfigFields): boolean {
  if (fields.mode === "api") {
    return Boolean(fields.apiKey.trim());
  }
  if (fields.mode === "local") {
    return Boolean(fields.localModelPath.trim());
  }
  if (fields.mode === "ollama") {
    return Boolean(fields.ollamaModel.trim());
  }
  return false;
}

export function buildDefaultLlmSettingsInput(
  fields: LlmConfigFields,
  contextWindow: number,
): DefaultLlmSettingsInput {
  return {
    mode: fields.mode,
    model: fields.mode === "api" ? fields.model : "",
    api_base: fields.apiBase,
    api_key: fields.mode === "api" ? fields.apiKey : "",
    local_model_path: fields.mode === "local" ? fields.localModelPath : "",
    ollama_model: fields.mode === "ollama" ? fields.ollamaModel : "",
    context_window: contextWindow,
  };
}
