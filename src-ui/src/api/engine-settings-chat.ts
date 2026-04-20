// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Settings Chat - sendSettingsChat.
 */

import {
  build_settings_context,
  call_settings_llm,
  resolve_llm_config,
  create_provider,
} from "@ficforge/engine";
import { ApiError, getFriendlyErrorMessage } from "./client";
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

  if (llmConfig.mode === "api") {
    if (!llmConfig.api_key?.trim()) {
      throw new ApiError(
        "no_api_key",
        getFriendlyErrorMessage({ error_code: "no_api_key" }),
        [],
      );
    }
    if (!llmConfig.api_base?.trim()) {
      throw new ApiError(
        "api_base_missing",
        getFriendlyErrorMessage({ error_code: "api_base_missing" }),
        [],
      );
    }
  }

  // Settings chat relies on tool calling support.
  // - api: any OpenAI-compatible endpoint that supports tools
  // - ollama: supported by newer /v1-compatible models like llama3.1 / qwen2.5
  // - local: not implemented in the current frontend/sidecar flow
  if (llmConfig.mode === "local") {
    throw new Error("设定模式对话暂不支持 local 模式，请切换到 API 或 Ollama。");
  }

  const provider = create_provider(llmConfig);
  const result = await call_settings_llm(assembled, params.mode as "au" | "fandom", provider);

  return {
    content: result.content,
    tool_calls: result.tool_calls,
  };
}
