// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

export type SettingsChatMode = "au" | "fandom";

export interface SettingsChatMessagePayload {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * 会话级 LLM 覆盖的连接字段（不含 api_key）—— 写文会话覆盖（useWriterGeneration.SessionLlmPayload）
 * 与设置聊天会话覆盖共享此单源，两处曾各手写同名字段（盲审 R5 重复 L3）。
 * api_key 有意留在 SettingsChatSessionLlm 扩展里、不进基类：写文会话故意不发 key（后端从磁盘读真实 key）。
 */
export interface SessionLlmConnFields {
  mode?: string;
  model?: string;
  api_base?: string;
  local_model_path?: string;
  ollama_model?: string;
}

export interface SettingsChatSessionLlm extends SessionLlmConnFields {
  api_key?: string;
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
