// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Settings Chat — sendSettingsChat.
 */

import {
  build_settings_context,
  call_settings_llm,
  resolve_llm_config,
  create_provider,
} from "@ficforge/engine";
import { getEngine } from "./engine-client";

export async function sendSettingsChat(params: {
  mode: string;
  base_path: string;
  fandom_path?: string;
  messages: any[];
  session_llm?: { api_base?: string; api_key?: string; model?: string };
}) {
  const e = getEngine();
  const sett = await e.repos.settings.get();

  const lang = sett.app?.language || "zh";
  const assembled = await build_settings_context({
    mode: params.mode as "au" | "fandom",
    base_path: params.base_path,
    fandom_path: params.fandom_path,
    messages: params.messages,
    adapter: e.adapter,
    language: lang,
  });

  const llmConfig = resolve_llm_config(
    params.session_llm as Record<string, string> | null,
    {},
    sett,
  );
  // Settings chat 需要 API 模式（tool calling 只有 API 支持）
  if (llmConfig.mode !== "api") {
    throw new Error("设定模式对话需要 API 模式的 LLM 配置（local/ollama 不支持 tool calling）");
  }
  const provider = create_provider(llmConfig);
  const result = await call_settings_llm(assembled, params.mode as "au" | "fandom", provider);

  return {
    content: result.content,
    tool_calls: result.tool_calls,
  };
}
