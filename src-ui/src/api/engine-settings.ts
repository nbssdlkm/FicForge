// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Settings query/command layer.
 */

import { isAbortError, isPlaintextRemoteHttp } from "@ficforge/engine";
import {
  OpenAICompatibleProvider,
  RemoteEmbeddingProvider,
  customProviderApiKeySecureKey,
  type CustomModelEntry,
  type CustomProviderEntry,
  type Settings,
} from "@ficforge/engine";
import { getEngine } from "./engine-instance";
import type {
  AppPreferencesInput,
  CustomProviderInfo,
  CustomProviderSaveInput,
  DefaultLlmSettingsInput,
  EmbeddingQueryInfo,
  FontPreferences,
  GlobalSettingsSaveInput,
  LlmQueryInfo,
  ModelCatalog,
  ModelParamInfo,
  OnboardingDefaults,
  RemoteModelListing,
  SecretStorageCapabilities,
  SettingsSummary,
  WriterSessionConfig,
} from "./settings";
import { DEFAULT_OLLAMA_BASE_URL } from "../config/defaults";

/**
 * 归一化 chat_path：非空字符串 → trim 后原样；空/非串 → undefined。
 * undefined 让 js-yaml dump 省略该键（不落盘），实现「缺省即默认 /chat/completions」+
 * 「置空即清除旧路径」，与 engine config_resolver.toChatPath 口径一致（单一语义源）。
 * 导出供 engine-project.ts 复用，避免两处手工维护同一归一化规则。
 */
export function normalizeChatPath(v: string | undefined): string | undefined {
  const trimmed = v?.trim();
  return trimmed ? trimmed : undefined;
}

let settingsWriteQueue: Promise<void> = Promise.resolve();

async function withSettingsWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = settingsWriteQueue;
  let releaseCurrent!: () => void;
  settingsWriteQueue = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    releaseCurrent();
  }
}

async function withSettingsWrite<T>(mutate: (current: Settings) => T | Promise<T>): Promise<T> {
  return withSettingsWriteLock(async () => {
    const { settings } = getEngine().repos;
    const current = await settings.get();
    const result = await mutate(current);
    await settings.save(current);
    return result;
  });
}

async function readSettings(): Promise<Settings> {
  const { settings } = getEngine().repos;
  return settings.get();
}

/**
 * 判断一份 LLM 配置是否有可用连接。接受 Settings.default_llm、Project.llm 或
 * resolve_llm_config 的解析结果（ResolvedLLMConfig）—— 字段形状兼容。
 * 单一真相源：facts 提取 readiness（engine-facts.getFactsExtractionReadiness）复用此谓词，
 * 避免 UI 侧重复实现「可用连接」判据（审计④）。
 */
export function hasUsableConnection(llm: {
  mode?: string;
  api_key?: string;
  local_model_path?: string;
  ollama_model?: string;
  model?: string;
} | null | undefined): boolean {
  if (!llm) return false;
  if (llm.mode === "local") {
    return Boolean(llm.local_model_path?.trim());
  }
  if (llm.mode === "ollama") {
    return Boolean((llm.ollama_model || llm.model || "").trim());
  }
  return Boolean(llm.api_key?.trim());
}

function toLlmQueryInfo(llm: Settings["default_llm"] | null | undefined): LlmQueryInfo {
  return {
    mode: llm?.mode || "api",
    model: llm?.model || "",
    api_base: llm?.api_base || "",
    has_api_key: Boolean(llm?.api_key?.trim()),
    local_model_path: llm?.local_model_path || "",
    ollama_model: llm?.ollama_model || "",
    context_window: llm?.context_window || 0,
    has_usable_connection: hasUsableConnection(llm),
  };
}

function toEmbeddingQueryInfo(embedding: Settings["embedding"] | null | undefined): EmbeddingQueryInfo {
  const hasApiKey = Boolean(embedding?.api_key?.trim());
  const hasCustomConfig = Boolean(
    embedding?.model?.trim() || embedding?.api_base?.trim() || hasApiKey,
  );

  return {
    mode: embedding?.mode || "api",
    model: embedding?.model || "",
    api_base: embedding?.api_base || "",
    has_api_key: hasApiKey,
    local_model_path: embedding?.local_model_path || "",
    ollama_model: embedding?.ollama_model || "",
    has_custom_config: hasCustomConfig,
  };
}

function toFontPreferences(settings: Settings): FontPreferences {
  return {
    ui_latin_font_id: settings.app.fonts.ui_latin_font_id,
    ui_cjk_font_id: settings.app.fonts.ui_cjk_font_id,
    reading_latin_font_id: settings.app.fonts.reading_latin_font_id,
    reading_cjk_font_id: settings.app.fonts.reading_cjk_font_id,
  };
}

export async function getSettingsForEditing() {
  return readSettings();
}

export async function getSettingsSecretCapabilities(): Promise<SecretStorageCapabilities> {
  return getEngine().adapter.getSecretStorageCapabilities();
}

export async function getSettingsSummary(): Promise<SettingsSummary> {
  const settings = await readSettings();
  return {
    default_llm: toLlmQueryInfo(settings.default_llm),
    embedding: toEmbeddingQueryInfo(settings.embedding),
    app: {
      language: settings.app.language,
      fonts: toFontPreferences(settings),
      react_extraction_enabled: settings.app.react_extraction_enabled,
    },
  };
}

export async function getFontPreferences(): Promise<FontPreferences> {
  const settings = await readSettings();
  return toFontPreferences(settings);
}

export async function getWriterSessionConfig(): Promise<WriterSessionConfig> {
  const settings = await readSettings();
  return {
    default_llm: toLlmQueryInfo(settings.default_llm),
    model_params: structuredClone(settings.model_params) as Record<string, ModelParamInfo>,
    catalog: toModelCatalog(settings),
  };
}

// ---------------------------------------------------------------------------
// 模型目录（供应商主导选择器）
// ---------------------------------------------------------------------------

function toCustomProviderInfo(p: CustomProviderEntry): CustomProviderInfo {
  return {
    id: p.id,
    displayName: p.displayName,
    baseUrl: p.baseUrl,
    ...(p.chatPath ? { chatPath: p.chatPath } : {}),
    has_api_key: Boolean(p.api_key?.trim()),
    models: structuredClone(p.models),
  };
}

function toModelCatalog(settings: Settings): ModelCatalog {
  return {
    custom_providers: (settings.custom_providers ?? []).map(toCustomProviderInfo),
    enabled_models: structuredClone(settings.enabled_models ?? {}),
  };
}

export async function getModelCatalog(): Promise<ModelCatalog> {
  const settings = await readSettings();
  return toModelCatalog(settings);
}

/**
 * 自定义供应商 id：`custom-` 前缀 + 时间戳 base36 + 随机段。
 * 全局唯一且**删除后不复用** —— secure storage key 以它为 namespace，
 * 唯一性保证「删供应商后残留的孤儿密钥」永远不会错误水合回新条目。
 */
function generateCustomProviderId(): string {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 新建或更新自定义供应商（按 id 定位；id 缺省 = 新建）。返回查询视图。 */
export async function saveCustomProvider(input: CustomProviderSaveInput): Promise<CustomProviderInfo> {
  return withSettingsWrite((current) => {
    current.custom_providers = current.custom_providers ?? [];
    const existing = input.id
      ? current.custom_providers.find((p) => p.id === input.id)
      : undefined;

    const entry: CustomProviderEntry = {
      id: existing?.id ?? input.id ?? generateCustomProviderId(),
      displayName: input.displayName,
      baseUrl: input.baseUrl,
      ...(input.chatPath?.trim() ? { chatPath: input.chatPath.trim() } : {}),
      // undefined = 保持已存密钥；字符串（含空串=清除）= 覆盖。
      // 空串清除语义与 secure_fields.extractSecureFields 的「显式置空即删密钥」一致。
      api_key: input.api_key !== undefined ? input.api_key : (existing?.api_key ?? ""),
      models: structuredClone(input.models),
    };

    if (existing) {
      current.custom_providers = current.custom_providers.map((p) => (p.id === existing.id ? entry : p));
    } else {
      current.custom_providers = [...current.custom_providers, entry];
    }
    return toCustomProviderInfo(entry);
  });
}

/**
 * 删除自定义供应商：条目 + 关联 enabled_models 一并清除，
 * 并 best-effort 移除 secure storage 里的供应商密钥（孤儿清理）。
 * 「正被全局/AU 配置引用」的提示在 UI 层做（api_base 匹配判据）——此处只负责数据一致性。
 */
export async function deleteCustomProvider(providerId: string): Promise<void> {
  await withSettingsWrite((current) => {
    current.custom_providers = (current.custom_providers ?? []).filter((p) => p.id !== providerId);
    if (current.enabled_models && providerId in current.enabled_models) {
      const next = { ...current.enabled_models };
      delete next[providerId];
      current.enabled_models = next;
    }
  });
  try {
    await getEngine().adapter.secureRemove(customProviderApiKeySecureKey(providerId));
  } catch {
    // best-effort：id 不复用（见 generateCustomProviderId），孤儿密钥无水合路径，仅占存储
  }
}

/** 读取某自定义供应商已存的真实 api_key（选中该供应商时自动带入配置表单）。 */
export async function getCustomProviderApiKey(providerId: string): Promise<string> {
  const settings = await readSettings();
  return settings.custom_providers?.find((p) => p.id === providerId)?.api_key ?? "";
}

/** 覆写某供应商（内置或自定义）的「已启用模型」清单（拉取 sheet 勾选确认时调用）。 */
export async function saveEnabledModels(providerId: string, models: CustomModelEntry[]): Promise<void> {
  await withSettingsWrite((current) => {
    current.enabled_models = {
      ...(current.enabled_models ?? {}),
      [providerId]: structuredClone(models),
    };
  });
}

/** /models 端点超时（毫秒）。 */
const FETCH_MODELS_TIMEOUT_MS = 15_000;

/**
 * fetchProviderModels 的错误分类（审计鲜眼 R2-4）：
 *   auth    — 401/403（密钥无效或未填）
 *   network — 超时 / fetch 网络层失败（复用 error_messages.connection_failed 口径）
 *   http    — 其余非 2xx（带 status 供 UI 简述）
 * UI（FetchModelsSheet）按 code 映射 i18n 文案；API 层不做 i18n。
 */
export type FetchModelsErrorCode = "auth" | "network" | "http";

export class FetchModelsError extends Error {
  code: FetchModelsErrorCode;
  status?: number;
  constructor(message: string, code: FetchModelsErrorCode, status?: number) {
    super(message);
    this.name = "FetchModelsError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

/**
 * 「从 API 获取列表」—— GET {api_base}/models（OpenAI 兼容），带超时。
 * 路径口径与 OpenAICompatibleProvider 的 `{api_base}/chat/completions` 一致：
 * api_base 含不含 /v1 由供应商条目决定，这里只拼 /models。
 * key 传参来自表单态（与 testConnection 同路径：表单持有 secure 还原后的真实 key）。
 */
export async function fetchProviderModels(params: { api_base: string; api_key: string }): Promise<RemoteModelListing> {
  const base = params.api_base.trim().replace(/\/+$/, "");
  if (!base) {
    throw new Error("api_base is empty");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_MODELS_TIMEOUT_MS);
  try {
    let resp: Response;
    try {
      resp = await fetch(`${base}/models`, {
        method: "GET",
        headers: {
          ...(params.api_key.trim() ? { Authorization: `Bearer ${params.api_key.trim()}` } : {}),
        },
        signal: controller.signal,
      });
    } catch (e: unknown) {
      if (isAbortError(e)) {
        throw new FetchModelsError(`timeout after ${FETCH_MODELS_TIMEOUT_MS / 1000}s`, "network");
      }
      // fetch 网络层失败（DNS / 拒连 / CORS）—— 统一归 network
      throw new FetchModelsError(e instanceof Error ? e.message : String(e), "network");
    }
    if (!resp.ok) {
      throw new FetchModelsError(
        `HTTP ${resp.status}`,
        resp.status === 401 || resp.status === 403 ? "auth" : "http",
        resp.status,
      );
    }
    const data = (await resp.json()) as { data?: unknown };
    const list = Array.isArray(data?.data) ? data.data : [];
    const ids = list
      .map((item) => (item && typeof item === "object" ? (item as { id?: unknown }).id : undefined))
      .filter((id): id is string => typeof id === "string" && id.length > 0);
    return { ids: [...new Set(ids)] };
  } finally {
    clearTimeout(timer);
  }
}

export async function getOnboardingDefaults(): Promise<OnboardingDefaults> {
  const settings = await readSettings();
  return {
    default_llm: {
      mode: settings.default_llm.mode,
      model: settings.default_llm.model,
      api_base: settings.default_llm.api_base,
      api_key: settings.default_llm.api_key,
      local_model_path: settings.default_llm.local_model_path,
      ollama_model: settings.default_llm.ollama_model,
      context_window: settings.default_llm.context_window,
      ...(settings.default_llm.chat_path ? { chat_path: settings.default_llm.chat_path } : {}),
    },
    embedding: {
      mode: settings.embedding.mode,
      model: settings.embedding.model,
      api_base: settings.embedding.api_base,
      api_key: settings.embedding.api_key,
      local_model_path: settings.embedding.local_model_path,
      ollama_model: settings.embedding.ollama_model,
    },
  };
}

export async function saveDefaultLlmSettings(payload: DefaultLlmSettingsInput) {
  return withSettingsWrite((current) => {
    current.default_llm = {
      ...current.default_llm,
      mode: payload.mode as Settings["default_llm"]["mode"],
      model: payload.model,
      api_base: payload.api_base,
      api_key: payload.api_key,
      local_model_path: payload.local_model_path,
      ollama_model: payload.ollama_model,
      // 缺省（表单「窗口未知」）→ 0 = 引擎「按模型推断」哨兵（LLMConfig 注释），
      // 不再静默补 128000 伪装成用户手填值（审计鲜眼 R2-3）。
      context_window: payload.context_window ?? 0,
      // 与 saveGlobalSettingsForEditing 同口径：显式覆盖，空/缺 → undefined（dump 省略）。
      chat_path: normalizeChatPath(payload.chat_path),
    };
    return current.default_llm;
  });
}

export async function saveFontPreferences(payload: FontPreferences) {
  return withSettingsWrite((current) => {
    current.app = {
      ...current.app,
      fonts: {
        ...current.app.fonts,
        ...payload,
      },
    };
    return toFontPreferences(current);
  });
}

export async function saveAppPreferences(payload: AppPreferencesInput) {
  return withSettingsWrite((current) => {
    current.app = {
      ...current.app,
      ...(payload.language ? { language: payload.language as Settings["app"]["language"] } : {}),
      // boolean：用 !== undefined 而非 truthiness，否则 false（关闭）会被跳过
      ...(payload.react_extraction_enabled !== undefined
        ? { react_extraction_enabled: payload.react_extraction_enabled }
        : {}),
    };
    return current.app;
  });
}

export async function saveGlobalSettingsForEditing(payload: GlobalSettingsSaveInput) {
  return withSettingsWrite((current) => {
    current.default_llm = {
      ...current.default_llm,
      mode: payload.default_llm.mode as Settings["default_llm"]["mode"],
      model: payload.default_llm.mode === "api" ? payload.default_llm.model : "",
      api_base: payload.default_llm.mode === "ollama"
        ? (payload.default_llm.api_base || DEFAULT_OLLAMA_BASE_URL)
        : payload.default_llm.api_base,
      // 非 API 模式置空 = 删除 secure storage 密钥（TD-016 修复后行为）；切回 API 需重填。详见
      // engine-project.ts 同款注释。有意如此：磁盘配置即唯一真相源。
      api_key: payload.default_llm.mode === "api" ? payload.default_llm.api_key : "",
      local_model_path: payload.default_llm.mode === "local" ? payload.default_llm.local_model_path : "",
      ollama_model: payload.default_llm.mode === "ollama" ? payload.default_llm.ollama_model : "",
      // 缺省（「窗口未知」）→ 0 哨兵（引擎按模型推断），round-trip 读回仍是「未知」。
      context_window: payload.default_llm.context_window ?? 0,
      // chat_path：只在 API 模式且非空时落库（optional，缺省即默认路径 /chat/completions）。
      // 显式赋值（在 ...current.default_llm 之后）覆盖旧值：空/非 API → undefined，
      // js-yaml dump 会省略 undefined 键 → 旧路径不残留（与 api_key 置空同口径）。
      chat_path: normalizeChatPath(payload.default_llm.mode === "api" ? payload.default_llm.chat_path : undefined),
    };

    // embedding 只有 API 一种模式（本地 embedding 三端均不支持，sidecar 退役 D-0040/M7）。
    // 直接落用户填的字段；留空即「未配置」→ createEmbeddingProvider 返回 undefined → RAG STALE。
    current.embedding = {
      ...current.embedding,
      mode: "api" as Settings["embedding"]["mode"],
      model: payload.embedding.model,
      api_base: payload.embedding.api_base,
      api_key: payload.embedding.api_key,
    };

    return current;
  });
}

export async function saveGlobalModelParams(model: string, params: ModelParamInfo) {
  return withSettingsWrite((current) => {
    current.model_params = current.model_params || {};
    current.model_params[model] = {
      temperature: params.temperature,
      top_p: params.top_p,
    };
    return current.model_params[model];
  });
}

export async function saveOnboardingSettings(payload: {
  default_llm: {
    mode: string;
    model: string;
    api_base: string;
    api_key: string;
    local_model_path: string;
    ollama_model: string;
    /** 选择器带出的 ctx；缺省 = 未知 → 0 哨兵（引擎按模型推断）。 */
    context_window?: number;
    /** 选择器带出的非标聊天路径；缺省/空 = 默认 /chat/completions。 */
    chat_path?: string;
  };
  embedding: {
    mode: string;
    model: string;
    api_base: string;
    api_key: string;
    ollama_model: string;
  };
}) {
  return withSettingsWrite((current) => {
    current.default_llm = {
      ...current.default_llm,
      mode: payload.default_llm.mode as Settings["default_llm"]["mode"],
      model: payload.default_llm.model,
      api_base: payload.default_llm.api_base,
      api_key: payload.default_llm.api_key,
      local_model_path: payload.default_llm.local_model_path,
      ollama_model: payload.default_llm.ollama_model,
      // ctx / chat_path 与本次选的模型同源：不沿用描述旧模型的存量值，也不硬塞
      // 128000 默认（0 = 引擎「按模型推断」哨兵；chat_path 空 → dump 省略）。
      context_window: payload.default_llm.context_window ?? 0,
      chat_path: normalizeChatPath(payload.default_llm.chat_path),
    };
    current.embedding = {
      ...current.embedding,
      mode: payload.embedding.mode as Settings["embedding"]["mode"],
      model: payload.embedding.model,
      api_base: payload.embedding.api_base,
      api_key: payload.embedding.api_key,
      ollama_model: payload.embedding.ollama_model,
    };
    return current;
  });
}

export async function testEmbeddingConnection(params: { api_base: string; api_key: string; model: string }) {
  try {
    const provider = new RemoteEmbeddingProvider(params.api_base, params.api_key, params.model);
    await provider.embed(["connection test"]);
    return {
      success: true,
      model: params.model,
      dimension: provider.get_dimension(),
      ...(isPlaintextRemoteHttp(params.api_base) ? { warning_code: "plaintext_http" as const } : {}),
    };
  } catch (e: unknown) {
    const err = e as { message?: string };
    return { success: false, message: err.message };
  }
}

export async function testConnection(params: {
  mode: string;
  model?: string;
  api_base?: string;
  api_key?: string;
  local_model_path?: string;
  ollama_model?: string;
  /** 非标聊天补全路径 —— 测试连接必须与真实生成同 URL（缺省 /chat/completions）。 */
  chat_path?: string;
}) {
  try {
    if (params.mode === "local") {
      // 不在 API 层硬编码中文文案：只回 error_code，i18n 映射在 UI 层
      // （useLlmConnectionTest → error_messages.unsupported_mode）。
      return { success: false, error_code: "unsupported_mode" };
    }
    if (params.mode === "ollama") {
      const raw = (params.api_base || DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "");
      const nativeBase = raw.replace(/\/v1$/, "");
      const resp = await fetch(`${nativeBase}/api/tags`);
      if (resp.ok) {
        return {
          success: true,
          model: params.ollama_model ?? "ollama",
          ...(isPlaintextRemoteHttp(raw) ? { warning_code: "plaintext_http" as const } : {}),
        };
      }
      // 同上：error_code 交 UI 层映射 error_messages.connection_failed。
      return { success: false, error_code: "connection_failed" };
    }

    const provider = new OpenAICompatibleProvider(
      params.api_base ?? "",
      params.api_key ?? "",
      params.model ?? "",
      // 与生成路径同口径：自定义 chatPath 的网关，测试也得打同一 URL，
      // 否则「测试通过、生成 404」（审计 5b）。
      normalizeChatPath(params.chat_path),
    );
    const resp = await provider.generate({
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1,
      temperature: 0,
      top_p: 1,
    });
    // 判据与引擎生成路径同源（isPlaintextRemoteHttp）：明文 HTTP 远端连接「能通」，
    // 但密钥不加密传输 —— 成功 + 告警，让用户知情而不阻断局域网自建端点（盲审 2026-07-11）
    return {
      success: true,
      model: resp.model,
      ...(isPlaintextRemoteHttp(params.api_base ?? "") ? { warning_code: "plaintext_http" as const } : {}),
    };
  } catch (e: unknown) {
    const err = e as { message?: string; error_code?: string };
    return { success: false, message: err.message, error_code: err.error_code };
  }
}
