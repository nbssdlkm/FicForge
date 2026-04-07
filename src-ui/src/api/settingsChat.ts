// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import { apiFetch } from "./client";

export type SettingsChatMode = "au" | "fandom";

export interface SettingsChatMessagePayload {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface SettingsChatSessionLlm {
  mode?: string;
  model?: string;
  api_base?: string;
  api_key?: string;
  local_model_path?: string;
  ollama_model?: string;
}

export interface SettingsChatToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface SettingsChatResponse {
  content: string;
  tool_calls: SettingsChatToolCall[];
}

export async function sendSettingsChat(payload: {
  base_path: string;
  mode: SettingsChatMode;
  messages: SettingsChatMessagePayload[];
  fandom_path?: string;
  session_llm?: SettingsChatSessionLlm;
}): Promise<SettingsChatResponse> {
  return apiFetch("/api/v1/settings-chat", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
