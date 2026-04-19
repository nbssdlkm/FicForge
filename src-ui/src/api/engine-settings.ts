// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Settings — getSettings, updateSettings, testConnection.
 */

import { OpenAICompatibleProvider, RemoteEmbeddingProvider, type Settings } from "@ficforge/engine";
import { getEngine } from "./engine-instance";
import type {
  EmbeddingQueryInfo,
  FontPreferences,
  LlmQueryInfo,
  ModelParamInfo,
  SettingsSummary,
  WriterSessionConfig,
} from "./settings";

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function hasUsableConnection(llm: {
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

export async function getSettings() {
  const { settings } = getEngine().repos;
  const s = await settings.get();
  return s;
}

export async function getSettingsSummary(): Promise<SettingsSummary> {
  const settings = await getSettings();
  return {
    default_llm: toLlmQueryInfo(settings.default_llm),
    embedding: toEmbeddingQueryInfo(settings.embedding),
    sync: {
      enabled: settings.sync.mode !== "none",
      mode: settings.sync.mode,
      has_password: Boolean(settings.sync.webdav?.password?.trim()),
      last_sync: settings.sync.last_sync || null,
    },
    app: {
      language: settings.app.language,
      fonts: toFontPreferences(settings),
    },
  };
}

export async function getFontPreferences(): Promise<FontPreferences> {
  const settings = await getSettings();
  return toFontPreferences(settings);
}

export async function getWriterSessionConfig(): Promise<WriterSessionConfig> {
  const settings = await getSettings();
  return {
    default_llm: toLlmQueryInfo(settings.default_llm),
    model_params: structuredClone(settings.model_params) as Record<string, ModelParamInfo>,
  };
}

export async function updateSettings(updates: DeepPartial<Settings>) {
  const { settings } = getEngine().repos;
  const current = await settings.get();
  // 深合并嵌套对象，避免覆盖 app.theme 等未传入的字段
  const currentRec = current as unknown as Record<string, unknown>;
  const updatesRec = updates as Record<string, unknown>;
  for (const key of Object.keys(updatesRec)) {
    const val = updatesRec[key];
    if (val && typeof val === "object" && !Array.isArray(val) && typeof currentRec[key] === "object") {
      currentRec[key] = { ...(currentRec[key] as Record<string, unknown>), ...(val as Record<string, unknown>) };
    } else {
      currentRec[key] = val;
    }
  }
  await settings.save(current);
  return current;
}

export async function saveGlobalModelParams(model: string, params: ModelParamInfo) {
  const { settings } = getEngine().repos;
  const current = await settings.get();
  current.model_params = current.model_params || {};
  current.model_params[model] = {
    temperature: params.temperature,
    top_p: params.top_p,
  };
  await settings.save(current);
  return current.model_params[model];
}

export async function testEmbeddingConnection(params: { api_base: string; api_key: string; model: string }) {
  try {
    const provider = new RemoteEmbeddingProvider(params.api_base, params.api_key, params.model);
    await provider.embed(["connection test"]);
    return { success: true, model: params.model, dimension: provider.get_dimension() };
  } catch (e: unknown) {
    const err = e as { message?: string };
    return { success: false, message: err.message };
  }
}

export async function testConnection(params: { mode: string; model?: string; api_base?: string; api_key?: string; local_model_path?: string; ollama_model?: string }) {
  try {
    if (params.mode === "local") {
      // local 模式的续写生成需要 Python sidecar 扩展，当前版本未实现
      // （见 engine-generate.ts 的 UNSUPPORTED_MODE 拦截）。
      // 即使 sidecar /health 存活，实际生成仍会抛错 —— 为避免"测试成功、使用报错"
      // 的断层，这里和 create_provider 的行为保持一致。
      return {
        success: false,
        message: "local 模式续写生成暂未实现（需要 Python sidecar 扩展）",
        error_code: "mode_not_implemented",
      };
    }
    if (params.mode === "ollama") {
      // /api/tags 是 Ollama 原生端点，不在 OpenAI 兼容层 /v1 子路径下。
      // 若 api_base 按新约定带了 /v1，strip 掉再拼 /api/tags。
      const raw = (params.api_base || "http://localhost:11434/v1").replace(/\/+$/, "");
      const nativeBase = raw.replace(/\/v1$/, "");
      const resp = await fetch(`${nativeBase}/api/tags`);
      if (resp.ok) {
        return { success: true, model: params.ollama_model ?? "ollama" };
      }
      return { success: false, message: "无法连接 Ollama 服务", error_code: "connection_failed" };
    }
    // API 模式：发送测试请求
    const provider = new OpenAICompatibleProvider(
      params.api_base ?? "",
      params.api_key ?? "",
      params.model ?? "",
    );
    const resp = await provider.generate({
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 1,
      temperature: 0,
      top_p: 1,
    });
    return { success: true, model: resp.model };
  } catch (e: unknown) {
    const err = e as { message?: string; error_code?: string };
    return { success: false, message: err.message, error_code: err.error_code };
  }
}
