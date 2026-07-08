// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import {
  LLMMode,
  type OnboardingDefaults,
} from "../../api/engine-client";
import {
  DEFAULT_DEEPSEEK_API_BASE,
  DEFAULT_DEEPSEEK_MODEL,
} from "../../config/defaults";
import { formCtxToSaveInput, persistedCtxToForm } from "../shared/llm-config";

export type MobileOnboardingSettingsState = {
  apiBase: string;
  apiKey: string;
  model: string;
  /** 表单态 ctx（选择器带出/手填）；"" = 窗口未知 → 保存时省略、引擎按模型推断。 */
  contextWindow: string;
  /** 非标聊天补全路径（选中带 chatPath 的服务商时随 apiBase 带出）；"" = 默认。 */
  chatPath: string;
  useCustomEmbedding: boolean;
  embeddingModel: string;
  embeddingApiBase: string;
  embeddingApiKey: string;
};

export function createDefaultMobileOnboardingSettings(): MobileOnboardingSettingsState {
  return {
    apiBase: DEFAULT_DEEPSEEK_API_BASE,
    apiKey: "",
    model: DEFAULT_DEEPSEEK_MODEL,
    contextWindow: "",
    chatPath: "",
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
    state.apiBase = llm.api_base || DEFAULT_DEEPSEEK_API_BASE;
    state.apiKey = llm.api_key || "";
    state.model = llm.model || DEFAULT_DEEPSEEK_MODEL;
    // 0/undefined = 「按模型推断」哨兵 → 表单 ""（窗口未知），不吞成默认值（R2-3）
    state.contextWindow = persistedCtxToForm(llm.context_window);
    state.chatPath = llm.chat_path || "";
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
  const ctx = formCtxToSaveInput(state.contextWindow);
  return {
    default_llm: {
      mode: LLMMode.API,
      model: state.model.trim(),
      api_base: state.apiBase.trim(),
      api_key: state.apiKey.trim(),
      local_model_path: "",
      ollama_model: "",
      // "" → 省略（API 层落 0 哨兵，引擎按模型推断）；chat_path 空 → API 层归一不落盘。
      ...(ctx !== undefined ? { context_window: ctx } : {}),
      ...(state.chatPath.trim() ? { chat_path: state.chatPath.trim() } : {}),
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
