// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Settings Chat - sendSettingsChat.
 */

import {
  buildSettingsContext,
  callSettingsLlm,
  resolveLlmConfig,
  createProvider,
  type ChatSessionMeta,
  type Message,
  type SettingsChatFile,
  type SettingsChatMessageEnvelope,
} from "@ficforge/engine";
import { ApiError, getFriendlyErrorMessage } from "./client";
import { getEngine } from "./engine-instance";
import { resolveLang } from "./resolve-lang";

export async function sendSettingsChat(params: {
  mode: string;
  base_path: string;
  fandom_path?: string;
  messages: Message[];
  session_llm?: { api_base?: string; api_key?: string; model?: string };
}) {
  const e = getEngine();
  const sett = await e.repos.settings.get();

  const lang = resolveLang(sett);
  const assembled = await buildSettingsContext({
    mode: params.mode as "au" | "fandom",
    base_path: params.base_path,
    fandom_path: params.fandom_path,
    messages: params.messages,
    adapter: e.adapter,
    language: lang,
  });

  const llmConfig = resolveLlmConfig(params.session_llm as Record<string, string> | null, {}, sett);

  if (llmConfig.mode === "api") {
    if (!llmConfig.api_key?.trim()) {
      throw new ApiError("no_api_key", getFriendlyErrorMessage({ error_code: "no_api_key" }), []);
    }
    if (!llmConfig.api_base?.trim()) {
      throw new ApiError("api_base_missing", getFriendlyErrorMessage({ error_code: "api_base_missing" }), []);
    }
  }

  // Settings chat relies on tool calling support.
  // - api: any OpenAI-compatible endpoint that supports tools
  // - ollama: supported by newer /v1-compatible models like llama3.1 / qwen2.5
  // - local: unsupported this version (Python sidecar retired — D-0040/M7)
  if (llmConfig.mode === "local") {
    throw new Error("设定模式对话暂不支持 local 模式，请切换到 API 或 Ollama。");
  }

  const provider = createProvider(llmConfig);
  const result = await callSettingsLlm(assembled, params.mode as "au" | "fandom", provider);

  return {
    content: result.content,
    tool_calls: result.tool_calls,
  };
}

// ---------------------------------------------------------------------------
// 设定助手会话底座（settings-chat-sessions）
// contextPath：fandom 助手 = fandomPath，AU 设定助手 = auPath。
// ---------------------------------------------------------------------------

export type { ChatSessionMeta, SettingsChatFile, SettingsChatMessageEnvelope };

export async function listSettingsChatSessions(contextPath: string): Promise<ChatSessionMeta[]> {
  return await getEngine().repos.settingsChat.listSessions(contextPath);
}

export async function createSettingsChatSession(contextPath: string, title?: string): Promise<ChatSessionMeta> {
  return await getEngine().repos.settingsChat.createSession(contextPath, title);
}

export async function renameSettingsChatSession(contextPath: string, sessionId: string, title: string): Promise<void> {
  await getEngine().repos.settingsChat.renameSession(contextPath, sessionId, title);
}

export async function deleteSettingsChatSession(contextPath: string, sessionId: string): Promise<void> {
  await getEngine().repos.settingsChat.deleteSession(contextPath, sessionId);
}

export async function getSettingsChatSession(contextPath: string, sessionId: string): Promise<SettingsChatFile> {
  return await getEngine().repos.settingsChat.getSession(contextPath, sessionId);
}

export async function saveSettingsChatSession(
  contextPath: string,
  sessionId: string,
  messages: SettingsChatMessageEnvelope[],
): Promise<void> {
  await getEngine().repos.settingsChat.saveSession(contextPath, sessionId, messages);
}
