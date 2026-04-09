// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** LLM 配置解析 + 参数加载链 + Provider 工厂。参见 PRD §2.3.1。 */

import type { LLMProvider } from "./provider.js";
import { OpenAICompatibleProvider } from "./openai_compatible.js";

// ---------------------------------------------------------------------------
// resolve_llm_config（三层模型配置）
// ---------------------------------------------------------------------------

export interface ResolvedLLMConfig {
  mode: string;
  model: string;
  api_base: string;
  api_key: string;
}

/**
 * 解析 LLM 配置（PRD §2.3.1 三层优先级）。
 * 优先级：session_llm > project.llm > settings.default_llm。
 */
export function resolve_llm_config(
  session_llm: Record<string, string> | null,
  project: { llm?: { mode?: string | { value: string }; model?: string; api_base?: string; api_key?: string } },
  settings: { default_llm?: { mode?: string | { value: string }; model?: string; api_base?: string; api_key?: string } },
): ResolvedLLMConfig {
  let cfg: Record<string, string>;

  if (session_llm && session_llm.model) {
    cfg = { ...session_llm };
  } else if (project.llm && project.llm.model) {
    cfg = llmObjToDict(project.llm);
  } else if (settings.default_llm) {
    cfg = llmObjToDict(settings.default_llm);
  } else {
    cfg = {};
  }

  cfg.mode = cfg.mode ?? "api";
  cfg.model = cfg.model ?? "";
  cfg.api_base = cfg.api_base ?? "";
  cfg.api_key = cfg.api_key ?? "";

  // 掩码 api_key 防御
  if (cfg.api_key.startsWith("****") || !cfg.api_key) {
    const realKey = settings.default_llm?.api_key;
    if (typeof realKey === "string" && realKey && !realKey.startsWith("****")) {
      cfg.api_key = realKey;
    }
  }

  return {
    mode: cfg.mode,
    model: cfg.model,
    api_base: cfg.api_base,
    api_key: cfg.api_key,
  };
}

function llmObjToDict(llm: Record<string, unknown>): Record<string, string> {
  let mode = (llm.mode ?? "api") as string | { value: string };
  if (typeof mode === "object" && "value" in mode) mode = mode.value;
  return {
    mode: String(mode),
    model: (llm.model as string) ?? "",
    api_base: (llm.api_base as string) ?? "",
    api_key: (llm.api_key as string) ?? "",
  };
}

// ---------------------------------------------------------------------------
// resolve_llm_params（四层参数加载链）
// ---------------------------------------------------------------------------

export interface ResolvedLLMParams {
  temperature: number;
  top_p: number;
}

export function resolve_llm_params(
  model_name: string,
  session_params: Record<string, number> | null,
  project: { model_params_override?: Record<string, Record<string, unknown>> },
  settings: { model_params?: Record<string, { temperature?: number; top_p?: number }> },
): ResolvedLLMParams {
  const defaults = { temperature: 1.0, top_p: 0.95 };

  // 第 1 层：session_params
  if (session_params) {
    return {
      temperature: session_params.temperature ?? defaults.temperature,
      top_p: session_params.top_p ?? defaults.top_p,
    };
  }

  // 第 2 层：project.model_params_override
  const overrides = project.model_params_override ?? {};
  if (model_name in overrides) {
    const o = overrides[model_name];
    return {
      temperature: Number(o.temperature ?? defaults.temperature),
      top_p: Number(o.top_p ?? defaults.top_p),
    };
  }

  // 第 3 层：settings.model_params
  const modelParams = settings.model_params ?? {};
  if (model_name in modelParams) {
    const mp = modelParams[model_name];
    return {
      temperature: mp.temperature ?? defaults.temperature,
      top_p: mp.top_p ?? defaults.top_p,
    };
  }

  // 第 4 层：硬编码默认
  return defaults;
}

// ---------------------------------------------------------------------------
// create_provider（工厂函数）
// ---------------------------------------------------------------------------

export function create_provider(llmConfig: ResolvedLLMConfig): LLMProvider {
  const mode = llmConfig.mode;
  if (mode === "api") {
    return new OpenAICompatibleProvider(llmConfig.api_base, llmConfig.api_key, llmConfig.model);
  }
  // local 和 ollama 在 TS 端暂不支持（桌面端通过 sidecar 代理，移动端只用 API）
  throw new Error(`不支持的 LLM mode: ${mode}`);
}
