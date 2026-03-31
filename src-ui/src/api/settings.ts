/** Settings API */

import { apiFetch } from "./client";

export interface LlmSettingsInfo {
  mode?: string;
  model?: string;
  api_base?: string;
  api_key?: string;
  local_model_path?: string;
  ollama_model?: string;
  context_window?: number;
}

export interface ModelParamInfo {
  temperature: number;
  top_p: number;
}

export interface EmbeddingSettingsInfo {
  mode?: string;
  model?: string;
  api_base?: string;
  api_key?: string;
}

export interface SettingsInfo {
  default_llm?: LlmSettingsInfo;
  model_params: Record<string, ModelParamInfo>;
  embedding?: EmbeddingSettingsInfo;
  app?: Record<string, unknown>;
  license?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface TestConnectionRequest {
  mode: string;
  model?: string;
  api_base?: string;
  api_key?: string;
  local_model_path?: string;
  ollama_model?: string;
}

export interface TestConnectionResponse {
  success: boolean;
  model?: string;
  message?: string;
  error_code?: string;
}
export async function getSettings(dataDir = "./fandoms"): Promise<SettingsInfo> {
  return apiFetch(`/api/v1/settings?data_dir=${encodeURIComponent(dataDir)}`);
}

export async function updateSettings(dataDir: string, updates: object): Promise<SettingsInfo> {
  return apiFetch("/api/v1/settings", {
    method: "PUT",
    body: JSON.stringify({ data_dir: dataDir, ...updates }),
  });
}

export async function testConnection(params: TestConnectionRequest): Promise<TestConnectionResponse> {
  return apiFetch("/api/v1/settings/test-connection", {
    method: "POST",
    body: JSON.stringify(params),
  });
}
