// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import {
  LLMMode,
  type OnboardingDefaults,
} from "../../api/engine-client";

export type LlmProvider = "deepseek" | "openai" | "custom";

export type MobileOnboardingSettingsState = {
  provider: LlmProvider;
  apiBase: string;
  apiKey: string;
  model: string;
  useCustomEmbedding: boolean;
  embeddingModel: string;
  embeddingApiBase: string;
  embeddingApiKey: string;
};

export const PROVIDER_PRESETS: Record<LlmProvider, { apiBase: string; model: string }> = {
  deepseek: {
    apiBase: "https://api.deepseek.com",
    model: "deepseek-chat",
  },
  openai: {
    apiBase: "https://api.openai.com/v1",
    model: "",
  },
  custom: {
    apiBase: "",
    model: "",
  },
};

export function inferProvider(apiBase: string): LlmProvider {
  const normalized = apiBase.toLowerCase();
  if (normalized.includes("deepseek")) return "deepseek";
  if (normalized.includes("openai")) return "openai";
  return "custom";
}

export function createDefaultMobileOnboardingSettings(): MobileOnboardingSettingsState {
  return {
    provider: "deepseek",
    apiBase: PROVIDER_PRESETS.deepseek.apiBase,
    apiKey: "",
    model: PROVIDER_PRESETS.deepseek.model,
    useCustomEmbedding: false,
    embeddingModel: "BAAI/bge-m3",
    embeddingApiBase: "https://api.siliconflow.cn/v1",
    embeddingApiKey: "",
  };
}

export function hydrateMobileOnboardingSettings(
  settings: OnboardingDefaults | null | undefined,
): MobileOnboardingSettingsState {
  const state = createDefaultMobileOnboardingSettings();
  if (!settings) return state;

  const llm = settings.default_llm;
  if (llm?.api_base || llm?.model || llm?.api_key) {
    const nextBase = llm.api_base || PROVIDER_PRESETS.deepseek.apiBase;
    state.provider = inferProvider(nextBase);
    state.apiBase = nextBase;
    state.apiKey = llm.api_key || "";
    state.model = llm.model || PROVIDER_PRESETS.deepseek.model;
  }

  const embedding = settings.embedding;
  const hasCustomEmbedding = Boolean(embedding?.model || embedding?.api_key || embedding?.api_base);
  state.useCustomEmbedding = hasCustomEmbedding;
  if (embedding?.model) state.embeddingModel = embedding.model;
  if (embedding?.api_base) state.embeddingApiBase = embedding.api_base;
  if (embedding?.api_key) state.embeddingApiKey = embedding.api_key;

  return state;
}

export function buildOnboardingSettingsSaveInput(state: MobileOnboardingSettingsState) {
  return {
    default_llm: {
      mode: LLMMode.API,
      model: state.model.trim(),
      api_base: state.apiBase.trim(),
      api_key: state.apiKey.trim(),
      local_model_path: "",
      ollama_model: "",
    },
    embedding: {
      // 本地 embedding 三端均不支持（Python sidecar 退役 D-0040/M7），embedding 只有 API 一种。
      // 跳过时存 mode=API + 空字段 → createEmbeddingProvider 返回 undefined → RAG 优雅降级 STALE，
      // 而不是落一个谁也不认的 LOCAL 死模式。用户可稍后在设置里补 embedding。
      mode: LLMMode.API,
      model: state.useCustomEmbedding ? state.embeddingModel.trim() : "",
      api_base: state.useCustomEmbedding ? state.embeddingApiBase.trim() : "",
      api_key: state.useCustomEmbedding ? state.embeddingApiKey.trim() : "",
      ollama_model: "",
    },
  };
}
