// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Settings query/command layer.
 */

import { OpenAICompatibleProvider, RemoteEmbeddingProvider, type Settings } from "@ficforge/engine";
import { getEngine } from "./engine-instance";
import type {
  AppPreferencesInput,
  DefaultLlmSettingsInput,
  EmbeddingQueryInfo,
  FontPreferences,
  GlobalSettingsSaveInput,
  LlmQueryInfo,
  ModelParamInfo,
  OnboardingDefaults,
  SecretStorageCapabilities,
  SettingsSummary,
  SyncSettingsSaveInput,
  WriterSessionConfig,
} from "./settings";
import { isTauri } from "../utils/platform";

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

function buildSyncSettings(input: SyncSettingsSaveInput): Settings["sync"] {
  return {
    mode: input.mode,
    ...(input.mode === "webdav"
      ? {
          webdav: {
            url: input.url,
            username: input.username,
            password: input.password,
            remote_dir: input.remote_dir,
          },
        }
      : {}),
    ...(input.last_sync ? { last_sync: input.last_sync } : {}),
  };
}

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
  const settings = await readSettings();
  return toFontPreferences(settings);
}

export async function getWriterSessionConfig(): Promise<WriterSessionConfig> {
  const settings = await readSettings();
  return {
    default_llm: toLlmQueryInfo(settings.default_llm),
    model_params: structuredClone(settings.model_params) as Record<string, ModelParamInfo>,
  };
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
      context_window: payload.context_window,
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
    };
    return current.app;
  });
}

export async function saveSyncSettings(payload: SyncSettingsSaveInput) {
  return withSettingsWrite((current) => {
    current.sync = buildSyncSettings(payload);
    return current.sync;
  });
}

export async function saveGlobalSettingsForEditing(payload: GlobalSettingsSaveInput) {
  return withSettingsWrite((current) => {
    current.default_llm = {
      ...current.default_llm,
      mode: payload.default_llm.mode as Settings["default_llm"]["mode"],
      model: payload.default_llm.mode === "api" ? payload.default_llm.model : "",
      api_base: payload.default_llm.mode === "ollama"
        ? (payload.default_llm.api_base || "http://localhost:11434/v1")
        : payload.default_llm.api_base,
      api_key: payload.default_llm.mode === "api" ? payload.default_llm.api_key : "",
      local_model_path: payload.default_llm.mode === "local" ? payload.default_llm.local_model_path : "",
      ollama_model: payload.default_llm.mode === "ollama" ? payload.default_llm.ollama_model : "",
      context_window: payload.default_llm.context_window,
    };

    const useCustomEmbedding = payload.embedding.use_custom_config || !isTauri();
    current.embedding = {
      ...current.embedding,
      mode: (useCustomEmbedding ? "api" : "local") as Settings["embedding"]["mode"],
      model: useCustomEmbedding ? payload.embedding.model : "",
      api_base: useCustomEmbedding ? payload.embedding.api_base : "",
      api_key: useCustomEmbedding ? payload.embedding.api_key : "",
    };

    current.sync = buildSyncSettings(payload.sync);
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
      context_window: current.default_llm.context_window || 128000,
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
    return { success: true, model: params.model, dimension: provider.get_dimension() };
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
}) {
  try {
    if (params.mode === "local") {
      return {
        success: false,
        message: "local 模式续写生成暂未实现（需要 Python sidecar 扩展）",
        error_code: "mode_not_implemented",
      };
    }
    if (params.mode === "ollama") {
      const raw = (params.api_base || "http://localhost:11434/v1").replace(/\/+$/, "");
      const nativeBase = raw.replace(/\/v1$/, "");
      const resp = await fetch(`${nativeBase}/api/tags`);
      if (resp.ok) {
        return { success: true, model: params.ollama_model ?? "ollama" };
      }
      return { success: false, message: "无法连接 Ollama 服务", error_code: "connection_failed" };
    }

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
