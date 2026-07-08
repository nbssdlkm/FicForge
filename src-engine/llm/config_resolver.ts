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
  /**
   * 手动指定的 context window（审计 H4）。undefined = 未手动指定，消费方
   * （get_context_window）按 model 名走 MODEL_CONTEXT_MAP 推断。
   *
   * 与 model **同层同源**：取「胜出的那一层配置」里的 context_window，不跨层混配 ——
   * 否则 A 层的手动窗口会误配到 B 层的模型上（与 api_key 回填的同源原则一致）。
   * 唯一例外见 resolveContextWindow：session 覆盖通常不带 context_window（前端
   * payload 只传 mode/model/api_base），此时若 session 的模型与某层配置的模型
   * 一致，则继承该层的手动窗口（本质仍是"窗口描述该模型"的同源语义）。
   */
  context_window?: number;
  /**
   * 非标聊天补全路径（对应 LLMConfig.chat_path / CustomProviderEntry.chatPath）。
   * undefined = 未设置，Provider 回退 /chat/completions。与 context_window 同法
   * **同层同源**：取胜出层的 chat_path，session 不带时按模型一致继承（见 resolveChatPath）。
   */
  chat_path?: string;
}

/** 归一化手动 context_window：仅正数有效（0 = "自动推断"哨兵值，视同未指定）。 */
function toManualContextWindow(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** 归一化 chat_path：仅非空字符串有效（空串/非串视同未指定，回退默认路径）。 */
function toChatPath(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

type LLMConfigLike = {
  mode?: string | { value: string };
  model?: string;
  api_base?: string;
  api_key?: string;
  ollama_model?: string;
  context_window?: number;
  chat_path?: string;
};

/**
 * 解析生效的 context_window（审计 H4），与 resolve_llm_config 选出的层同源。
 *
 * - project / settings 层胜出：直接取该层的手动 context_window。
 * - session 层胜出：session payload 通常不带 context_window（前端 useSessionParams
 *   只传 mode/model/api_base），此时按「手动窗口描述的是某层配置里的那个模型」原则：
 *   session 模型与 project.llm（优先）或 settings.default_llm 配置的模型一致时，
 *   继承该层手动窗口；模型不一致则不继承（避免 A 模型的手动窗口误配 B 模型），
 *   返回 undefined 交给 MODEL_CONTEXT_MAP 按模型名推断。
 */
function resolveContextWindow(
  layer: "session" | "project" | "settings" | "none",
  sessionModel: string,
  session_llm: Record<string, string> | null,
  project: { llm?: LLMConfigLike },
  settings: { default_llm?: LLMConfigLike },
): number | undefined {
  if (layer === "project") return toManualContextWindow(project.llm?.context_window);
  if (layer === "settings") return toManualContextWindow(settings.default_llm?.context_window);
  if (layer !== "session") return undefined;

  const explicit = toManualContextWindow(session_llm?.context_window);
  if (explicit !== undefined) return explicit;

  const matches = (l: LLMConfigLike | undefined): boolean =>
    Boolean(l && sessionModel && (l.model === sessionModel || l.ollama_model === sessionModel));
  if (matches(project.llm)) return toManualContextWindow(project.llm?.context_window);
  if (matches(settings.default_llm)) return toManualContextWindow(settings.default_llm?.context_window);
  return undefined;
}

/**
 * 解析生效的 chat_path，与 resolve_llm_config 选出的层**同层同源**——
 * 完全仿照 resolveContextWindow（审计 H4）的模式：chat_path 描述的是「某层配置里那个
 * 模型 / 供应商」的非标路径，跟 api_base/model 绑在同一层，跨层混配会把 A 层的路径
 * 误配到 B 层的端点上。
 *
 * - project / settings 层胜出：直接取该层的 chat_path。
 * - session 层胜出：session payload 通常不带 chat_path（前端只传 mode/model/api_base），
 *   此时若 session 模型与某层配置的模型一致，继承该层 chat_path（同「路径描述该模型/端点」
 *   语义）；不一致则不继承，返回 undefined 交给 Provider 回退 /chat/completions。
 */
function resolveChatPath(
  layer: "session" | "project" | "settings" | "none",
  sessionModel: string,
  session_llm: Record<string, string> | null,
  project: { llm?: LLMConfigLike },
  settings: { default_llm?: LLMConfigLike },
): string | undefined {
  if (layer === "project") return toChatPath(project.llm?.chat_path);
  if (layer === "settings") return toChatPath(settings.default_llm?.chat_path);
  if (layer !== "session") return undefined;

  const explicit = toChatPath(session_llm?.chat_path);
  if (explicit !== undefined) return explicit;

  const matches = (l: LLMConfigLike | undefined): boolean =>
    Boolean(l && sessionModel && (l.model === sessionModel || l.ollama_model === sessionModel));
  if (matches(project.llm)) return toChatPath(project.llm?.chat_path);
  if (matches(settings.default_llm)) return toChatPath(settings.default_llm?.chat_path);
  return undefined;
}

/**
 * 解析 LLM 配置（PRD §2.3.1 三层优先级）。
 * 优先级：session_llm > project.llm > settings.default_llm。
 */
export function resolve_llm_config(
  session_llm: Record<string, string> | null,
  project: { llm?: LLMConfigLike },
  settings: { default_llm?: LLMConfigLike },
): ResolvedLLMConfig {
  let cfg: Record<string, string>;
  let layer: "session" | "project" | "settings" | "none";

  if (session_llm && session_llm.model) {
    cfg = { ...session_llm };
    layer = "session";
  } else if (project.llm && (project.llm.model || project.llm.ollama_model)) {
    cfg = llmObjToDict(project.llm);
    layer = "project";
  } else if (settings.default_llm) {
    cfg = llmObjToDict(settings.default_llm);
    layer = "settings";
  } else {
    cfg = {};
    layer = "none";
  }

  cfg.mode = cfg.mode ?? "api";
  cfg.model = cfg.model ?? "";
  cfg.api_base = cfg.api_base ?? "";
  cfg.api_key = cfg.api_key ?? "";
  cfg.ollama_model = cfg.ollama_model ?? "";

  // 掩码 / 占位符 api_key 防御。
  //
  // 前端 session_llm **不携带 api_key**（见 useSessionParams：key 只留在后端），
  // 所以走 session 分支时 cfg.api_key 为空，需在此回填真实 key。
  //
  // 关键：key 必须与 model/api_base **同源**。AU 覆盖了自己的 key（project.llm.api_key
  // 非空，意味着用户为本 AU 配了独立 key/provider）时，**优先用 AU 的 key**，再回退全局。
  // 否则换了 provider 的 AU 会带着全局 key 发到 AU 自己的 api_base → 401 invalid_api_key。
  // 全局/无覆盖场景：project.llm.api_key 为空（saveAuSettings 关闭覆盖时会清空），
  // 自然回退到 settings.default_llm.api_key。
  const isMasked = !cfg.api_key || cfg.api_key.startsWith("****") || cfg.api_key === "<secure>";
  if (isMasked) {
    const isUsableKey = (k: unknown): k is string =>
      typeof k === "string" && k !== "" && !k.startsWith("****") && k !== "<secure>";
    const projectKey = project.llm?.api_key;
    const globalKey = settings.default_llm?.api_key;
    if (isUsableKey(projectKey)) {
      cfg.api_key = projectKey;
    } else if (isUsableKey(globalKey)) {
      cfg.api_key = globalKey;
    }
  }

  const chatPath = resolveChatPath(layer, cfg.model, session_llm, project, settings);
  return {
    mode: cfg.mode,
    model: cfg.model,
    api_base: cfg.api_base,
    api_key: cfg.api_key,
    ollama_model: cfg.ollama_model,
    context_window: resolveContextWindow(layer, cfg.model, session_llm, project, settings),
    ...(chatPath !== undefined ? { chat_path: chatPath } : {}),
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
 *   - "local"  → 本地模型加载。曾依赖 Python sidecar，sidecar 已退役（D-0040/M7），
 *                本版本不支持（本地模型请用 ollama）；UI 通过 capabilities.ts 不渲染
 *                此选项，此处保留运行时防护（防手改 YAML）。
 */
export function create_provider(llmConfig: ResolvedLLMConfig): LLMProvider {
  const mode = llmConfig.mode;

  if (mode === "api") {
    // chat_path 随层带进 Provider（自定义供应商非标网关路径）；缺省 Provider 内部回退
    // /chat/completions。ollama 模式不传：其端点恒为标准 /v1/chat/completions。
    return new OpenAICompatibleProvider(llmConfig.api_base, llmConfig.api_key, llmConfig.model, llmConfig.chat_path);
  }

  if (mode === "ollama") {
    const base = (llmConfig.api_base || "http://localhost:11434/v1").replace(/\/+$/, "");
    const key = llmConfig.api_key || "ollama";  // dummy —— Ollama 不校验
    const model = llmConfig.ollama_model || llmConfig.model;
    if (!model) {
      throw new Error("Ollama 模式需要指定模型名（ollama_model）");
    }
    return new OpenAICompatibleProvider(base, key, model);
  }

  if (mode === "local") {
    // local（内置模型加载）曾依赖 Python sidecar，sidecar 已退役（D-0040 / M7）。
    // 本地模型请改用 Ollama（ollama 模式，OpenAI 兼容，三端可用）。
    throw new Error("本版本不支持 local 模式（本地模型加载）。请改用 Ollama 或在线 API。");
  }

  throw new Error(`未知的 LLM mode: ${mode}`);
}
