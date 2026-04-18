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
import { getEngine } from "./engine-instance";

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
  // Settings chat 依赖 tool calling。
  // - api：所有 OpenAI 兼容接口都支持
  // - ollama：/v1 端点从 0.1.x 开始支持，但需要模型本身支持（如 llama3.1, qwen2.5）；
  //   这里放行，用户的模型不支持会收到 tool_call 相关错误，错误会回传给用户
  // - local：需要 sidecar 扩展，未实现
  if (llmConfig.mode === "local") {
    throw new Error("设定模式对话暂不支持 local 模式，请切换到 API 或 Ollama（Ollama 需选择支持 tool calling 的模型如 llama3.1 / qwen2.5）");
  }
  const provider = create_provider(llmConfig);
  const result = await call_settings_llm(assembled, params.mode as "au" | "fandom", provider);

  return {
    content: result.content,
    tool_calls: result.tool_calls,
  };
}
