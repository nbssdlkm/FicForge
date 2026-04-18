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
  /** Ollama 模式下的模型名（对应 LLMConfig.ollama_model）。api 模式下忽略。 */
  ollama_model?: string;
}

/**
 * 解析 LLM 配置（PRD §2.3.1 三层优先级）。
 * 优先级：session_llm > project.llm > settings.default_llm。
 */
export function resolve_llm_config(
  session_llm: Record<string, string> | null,
  project: { llm?: { mode?: string | { value: string }; model?: string; api_base?: string; api_key?: string; ollama_model?: string } },
  settings: { default_llm?: { mode?: string | { value: string }; model?: string; api_base?: string; api_key?: string; ollama_model?: string } },
): ResolvedLLMConfig {
  let cfg: Record<string, string>;

  if (session_llm && session_llm.model) {
    cfg = { ...session_llm };
  } else if (project.llm && (project.llm.model || project.llm.ollama_model)) {
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
  cfg.ollama_model = cfg.ollama_model ?? "";

  // 掩码 / 占位符 api_key 防御
  const isMasked = !cfg.api_key || cfg.api_key.startsWith("****") || cfg.api_key === "<secure>";
  if (isMasked) {
    const realKey = settings.default_llm?.api_key;
    if (typeof realKey === "string" && realKey && !realKey.startsWith("****") && realKey !== "<secure>") {
      cfg.api_key = realKey;
    }
  }

  return {
    mode: cfg.mode,
    model: cfg.model,
    api_base: cfg.api_base,
    api_key: cfg.api_key,
    ollama_model: cfg.ollama_model,
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
    ollama_model: (llm.ollama_model as string) ?? "",
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

/**
 * 根据解析后的 LLM 配置创建 Provider。
 *
 * 支持的 mode（来自 llm/capabilities.ts 的能力矩阵）：
 *   - "api"    → OpenAI 兼容接口（DeepSeek / OpenAI / Claude 中转 / 自建中转等）
 *   - "ollama" → Ollama 的 /v1 端点（100% 兼容 OpenAI chat/completions 协议），
 *                所以直接复用 OpenAICompatibleProvider。api_base 为空时默认
 *                http://localhost:11434/v1；api_key 为空时填 dummy "ollama"
 *                （Ollama 不校验 key，但 OpenAI SDK 要求非空）
 *   - "local"  → 本地模型文件。当前需要 Python sidecar 扩展支持，未实现；
 *                UI 通过 capabilities.ts 禁用此选项，此处保留运行时防护。
 */
export function create_provider(llmConfig: ResolvedLLMConfig): LLMProvider {
  const mode = llmConfig.mode;

  if (mode === "api") {
    return new OpenAICompatibleProvider(llmConfig.api_base, llmConfig.api_key, llmConfig.model);
  }

  if (mode === "ollama") {
    const base = (llmConfig.api_base || "http://localhost:11434/v1").replace(/\/+$/, "");
    // Ollama 自己的 /api/chat 不走 OpenAI 协议；只有 /v1 子路径兼容。若用户填了
    // 裸 host 而没带 /v1，补齐；若已带则不重复。
    const normalizedBase = /\/v1$/.test(base) ? base : `${base}/v1`;
    const key = llmConfig.api_key || "ollama";  // dummy —— Ollama 不校验
    const model = llmConfig.ollama_model || llmConfig.model;
    if (!model) {
      throw new Error("Ollama 模式需要指定模型名（ollama_model）");
    }
    return new OpenAICompatibleProvider(normalizedBase, key, model);
  }

  if (mode === "local") {
    throw new Error("local 模式需要 Python sidecar 扩展支持，当前版本暂未实现");
  }

  throw new Error(`未知的 LLM mode: ${mode}`);
}
