// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** LLM 配置解析 + 参数加载链 + Provider 工厂。参见 PRD §2.3.1。 */

import type { LLMProvider } from "./provider.js";
import { OpenAICompatibleProvider } from "./openai_compatible.js";
import { OLLAMA_DEFAULT_BASE_URL } from "../domain/provider_manifest.js";
import { warnAlways } from "../logger/index.js";

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
   * 唯一例外见 resolveInheritedLayerField：session 覆盖通常不带 context_window（前端
   * payload 只传 mode/model/api_base），此时若 session 的模型 + api_base 与某层配置
   * 一致，则继承该层的手动窗口（本质仍是"窗口描述该模型@该端点"的同源语义）。
   */
  context_window?: number;
  /**
   * 非标聊天补全路径（对应 LLMConfig.chat_path / CustomProviderEntry.chatPath）。
   * undefined = 未设置，Provider 回退 /chat/completions。与 context_window 同法
   * **同层同源**：取胜出层的 chat_path，session 不带时按模型 + api_base 一致继承
   * （见 resolveInheritedLayerField）。
   */
  chat_path?: string;
}

/** 归一化手动 context_window：仅正数有效（0 = "自动推断"哨兵值，视同未指定）。 */
function toManualContextWindow(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * chat_path 是否会改变请求宿主（authority）—— 安全关键（盲审 R3 HIGH-2 对抗审）。
 * chat_path 只应是「api_base 之后的路径段」；绝对 URL / 协议相对 `//host` / 反斜杠
 * 都能把请求（连同回填的密钥）导向任意主机。恶意 bundle 正是用
 * `chat_path: "//attacker/v1/chat/completions"` + 空 api_base 偷渡宿主。
 */
function chatPathChangesHost(path: string): boolean {
  const p = path.trim();
  return (
    p.startsWith("//") || // 协议相对：webview 解析为 //host
    p.startsWith("\\") || // 反斜杠变体
    p.includes("\\") ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(p) || // scheme://host 绝对 URL
    p.includes("://")
  );
}

/**
 * 归一化 chat_path：仅非空、且**不改变宿主**的路径有效（空串/非串/宿主注入视同未指定，
 * 回退默认 /chat/completions）。宿主注入值被拒时告警——它要么是配置错误，要么是攻击。
 */
function toChatPath(v: unknown): string | undefined {
  if (typeof v !== "string" || !v.trim()) return undefined;
  if (chatPathChangesHost(v)) {
    warnAlways("llm", "chat_path 被拒绝：含宿主/协议前缀，只允许 api_base 之后的路径段", { chat_path: v });
    return undefined;
  }
  return v;
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
 * 归一化 api_base 用于「同一端点」判定：去尾斜杠 + 小写 scheme://host 段
 * （URL 主机大小写不敏感，路径段大小写敏感故保留原样）。
 *
 * 刻意不 import UI 侧 model-picker-utils 的同名函数 —— 引擎不依赖 UI 层；
 * 且语义不同：这里「双空视为相等」（两层都没配 base = 同为默认端点，如 Ollama），
 * UI 侧的供应商匹配则把双空视为不匹配。
 */
function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  // 前半 = 可选 scheme:// + 首个斜杠前的 host（无 scheme 的裸 host 也命中），后半 = 路径。
  const m = /^((?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/)?[^/]*)(.*)$/.exec(trimmed);
  return m ? m[1].toLowerCase() + m[2] : trimmed.toLowerCase();
}

/**
 * session 层继承判据：session 的模型**且端点**都与某层配置一致，才视为「同一份配置」。
 *
 * 终审跑码实证（审计 3-A）：只按模型名匹配会跨供应商渗漏 —— AU 用官方 DeepSeek、
 * 全局是自建网关上的**同名模型**（手动 ctx + 非标 chat_path）时，会话切到该模型名
 * 会把网关的窗口/路径误配到官方端点上。session payload 恒带 api_base
 * （useSessionParams 发 mode/model/api_base），据此加同源判据。
 */
function sessionMatchesLayer(layer: LLMConfigLike | undefined, sessionModel: string, sessionApiBase: string): boolean {
  return Boolean(
    layer &&
      sessionModel &&
      (layer.model === sessionModel || layer.ollama_model === sessionModel) &&
      normalizeBaseUrl(layer.api_base ?? "") === normalizeBaseUrl(sessionApiBase),
  );
}

/**
 * 「同层同源」字段（context_window / chat_path）的统一解析骨架（审计 H4 + NIT 去双拷贝）。
 * 这类字段描述的是「某层配置里那个模型 / 端点」的属性，必须取 resolve_llm_config
 * 选出的胜出层，跨层混配会把 A 层的值误配到 B 层的模型/端点上。
 *
 * - project / settings 层胜出：直接取该层字段。
 * - session 层胜出：session payload 显式带了就用；没带（前端通常只传 mode/model/api_base）
 *   时，若 session 的模型 + api_base 与某层配置一致（见 sessionMatchesLayer），继承该层
 *   字段（本质仍是「字段描述该模型@该端点」的同源语义）；不一致则不继承，返回
 *   undefined 交给下游兜底（ctx → MODEL_CONTEXT_MAP 推断；chat_path → /chat/completions）。
 */
function resolveInheritedLayerField<T>(
  field: "context_window" | "chat_path",
  normalize: (v: unknown) => T | undefined,
  layer: "session" | "project" | "settings" | "none",
  sessionModel: string,
  session_llm: Record<string, string> | null,
  project: { llm?: LLMConfigLike },
  settings: { default_llm?: LLMConfigLike },
): T | undefined {
  if (layer === "project") return normalize(project.llm?.[field]);
  if (layer === "settings") return normalize(settings.default_llm?.[field]);
  if (layer !== "session") return undefined;

  const explicit = normalize(session_llm?.[field]);
  if (explicit !== undefined) return explicit;

  const sessionApiBase = session_llm?.api_base ?? "";
  if (sessionMatchesLayer(project.llm, sessionModel, sessionApiBase)) {
    return normalize(project.llm?.[field]);
  }
  if (sessionMatchesLayer(settings.default_llm, sessionModel, sessionApiBase)) {
    return normalize(settings.default_llm?.[field]);
  }
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
  //
  // 同源门（盲审 R3 HIGH-2）：候选 key 只能回填到「它被配置时所属的端点」。
  // 反例（攻击面）：导入的恶意 AU 覆盖带陌生 api_base + 占位符 key —— 若无此门，
  // 全局 key 会被回填后随请求发往该陌生主机，等于把全局密钥泄漏给任意端点。
  // 「双空视为相等」沿用 normalizeBaseUrl 的既有语义（两层都没配 = 同为默认端点）。
  const isMasked = !cfg.api_key || cfg.api_key.startsWith("****") || cfg.api_key === "<secure>";
  if (isMasked) {
    // 掩码/占位符本质不可用：先清空，回填失败时保持空串 —— 下游按「未配置密钥」
    // 失败，而不是把 "<secure>"/"****" 字面量当 bearer token 发出去。
    cfg.api_key = "";
    const isUsableKey = (k: unknown): k is string =>
      typeof k === "string" && k !== "" && !k.startsWith("****") && k !== "<secure>";
    const sameOrigin = (layerBase: unknown): boolean =>
      normalizeBaseUrl(cfg.api_base) === normalizeBaseUrl(typeof layerBase === "string" ? layerBase : "");
    const projectKey = project.llm?.api_key;
    const globalKey = settings.default_llm?.api_key;
    if (isUsableKey(projectKey) && sameOrigin(project.llm?.api_base)) {
      cfg.api_key = projectKey;
    } else if (isUsableKey(globalKey) && sameOrigin(settings.default_llm?.api_base)) {
      cfg.api_key = globalKey;
    } else if (isUsableKey(projectKey) || isUsableKey(globalKey)) {
      // 有可用 key 但端点不同源 → 宁缺勿漏：留空让下游按「未配置密钥」失败，
      // 用户需为该端点显式配置密钥。
      warnAlways("llm", "api_key 跨层回填被拒绝：目标 api_base 与已存密钥的端点不同源，请为该端点显式配置密钥", {
        api_base: cfg.api_base,
      });
    }
  }

  const chatPath = resolveInheritedLayerField(
    "chat_path",
    toChatPath,
    layer,
    cfg.model,
    session_llm,
    project,
    settings,
  );
  return {
    mode: cfg.mode,
    model: cfg.model,
    api_base: cfg.api_base,
    api_key: cfg.api_key,
    ollama_model: cfg.ollama_model,
    context_window: resolveInheritedLayerField(
      "context_window",
      toManualContextWindow,
      layer,
      cfg.model,
      session_llm,
      project,
      settings,
    ),
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

/**
 * api_base 是否为「明文 HTTP 且非本机回环」—— 密钥将不加密传输的判据（单一真相源：
 * 生成路径的 warnAlways 与 UI「测试连接」的告警透出共用；盲审 2026-07-11 安全维）。
 * 桌面 CSP 保留 http: 通配是为支持局域网自建端点（如局域网 Ollama）这一真实场景，
 * 拦截层因此不能一刀切 —— 改为让用户知情：明文远端 → 告警不阻断。
 */
export function isPlaintextRemoteHttp(apiBase: string): boolean {
  const base = (apiBase ?? "").trim();
  if (!/^http:\/\//i.test(base)) return false;
  try {
    const host = new URL(base).hostname.toLowerCase();
    return !(
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "[::1]" ||
      host.endsWith(".localhost")
    );
  } catch {
    return true; // 以 http:// 开头但解析失败 → 按远端保守告警
  }
}

// 每主机只告警一次（create_provider 每次生成都会被调用，避免刷日志）
const _warnedPlaintextHosts = new Set<string>();

export function warnIfPlaintextRemote(apiBase: string): void {
  if (!isPlaintextRemoteHttp(apiBase)) return;
  let host = apiBase;
  try {
    host = new URL(apiBase.trim()).host;
  } catch {
    /* 保留原串 */
  }
  if (_warnedPlaintextHosts.has(host)) return;
  _warnedPlaintextHosts.add(host);
  warnAlways("llm", "api_base 为明文 HTTP 非本机端点，API 密钥将不加密传输（仅建议可信局域网使用）", { host });
}

export function create_provider(llmConfig: ResolvedLLMConfig): LLMProvider {
  const mode = llmConfig.mode;

  if (mode === "api") {
    // api 模式必须有非空 api_base：空 base 会让 Provider 拼出相对 URL，在 webview 中
    // 被解析到 app 自身 origin 或（配合协议相对 chat_path）任意主机 —— 是全局密钥外泄链
    // 的使能点（盲审 R3 HIGH-2 对抗审）。宁可清晰报错，不静默发往错误端点。
    if (!llmConfig.api_base || !llmConfig.api_base.trim()) {
      throw new Error("api 模式需要非空 api_base（请在设置中为该服务商配置端点）");
    }
    warnIfPlaintextRemote(llmConfig.api_base);
    // chat_path 随层带进 Provider（自定义供应商非标网关路径）；缺省 Provider 内部回退
    // /chat/completions。ollama 模式不传：其端点恒为标准 /v1/chat/completions。
    return new OpenAICompatibleProvider(llmConfig.api_base, llmConfig.api_key, llmConfig.model, llmConfig.chat_path);
  }

  if (mode === "ollama") {
    const base = (llmConfig.api_base || OLLAMA_DEFAULT_BASE_URL).replace(/\/+$/, "");
    warnIfPlaintextRemote(base);
    const key = llmConfig.api_key || "ollama"; // dummy —— Ollama 不校验
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
