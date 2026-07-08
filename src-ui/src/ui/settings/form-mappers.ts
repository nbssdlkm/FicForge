// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.
// See LICENSE file in the project root for full license text.

import {
  LLMMode,
  type AuSettingsSaveInput,
  type GlobalSettingsSaveInput,
  type ProjectInfo,
  type SettingsInfo,
} from "../../api/engine-client";
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_DEEPSEEK_API_BASE,
  DEFAULT_PERSPECTIVE,
  DEFAULT_EMOTION_STYLE,
} from "../../config/defaults";

export interface GlobalSettingsFormState {
  mode: LLMMode;
  model: string;
  localModelPath: string;
  ollamaModel: string;
  apiBase: string;
  apiKey: string;
  contextWindow: number;
  /** 非标聊天补全路径（选中带 chatPath 的供应商时随 apiBase 带出；默认空 = /chat/completions）。 */
  chatPath: string;
  embeddingModel: string;
  embeddingApiBase: string;
  embeddingApiKey: string;
}

export interface AuSettingsFormState {
  perspective: string;
  emotionStyle: string;
  chapterLength: number;
  customInstructions: string;
  pinnedContext: string[];
  coreIncludes: string[];
  isLlmOverride: boolean;
  llmMode: string;
  auModel: string;
  auLocalModelPath: string;
  auOllamaModel: string;
  auApiBase: string;
  auApiKey: string;
  contextWindow: number;
  /** AU 覆盖的非标聊天补全路径（随 apiBase 带出；默认空 = /chat/completions）。 */
  chatPath: string;
  isEmbeddingOverride: boolean;
  embModel: string;
  embApiBase: string;
  embApiKey: string;
}

export function createDefaultGlobalSettingsFormState(): GlobalSettingsFormState {
  return {
    mode: LLMMode.API,
    model: DEFAULT_DEEPSEEK_MODEL,
    localModelPath: "",
    ollamaModel: "",
    apiBase: DEFAULT_DEEPSEEK_API_BASE,
    apiKey: "",
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    chatPath: "",
    embeddingModel: "",
    embeddingApiBase: "",
    embeddingApiKey: "",
  };
}

export function hydrateGlobalSettingsForm(settings: SettingsInfo | null): GlobalSettingsFormState {
  const form = createDefaultGlobalSettingsFormState();
  if (!settings) return form;

  if (settings.default_llm) {
    const nextMode = settings.default_llm.mode || LLMMode.API;
    form.mode = nextMode;
    form.model = settings.default_llm.model || DEFAULT_DEEPSEEK_MODEL;
    form.localModelPath = settings.default_llm.local_model_path || "";
    form.ollamaModel = settings.default_llm.ollama_model || settings.default_llm.model || "";
    form.apiBase = settings.default_llm.api_base
      || (nextMode === "ollama" ? DEFAULT_OLLAMA_BASE_URL : DEFAULT_DEEPSEEK_API_BASE);
    form.apiKey = settings.default_llm.api_key || "";
    form.contextWindow = settings.default_llm.context_window || DEFAULT_CONTEXT_WINDOW;
    form.chatPath = settings.default_llm.chat_path || "";
  }

  form.embeddingModel = settings.embedding?.model || "";
  form.embeddingApiBase = settings.embedding?.api_base || "";
  form.embeddingApiKey = settings.embedding?.api_key || "";

  return form;
}

export function buildGlobalSettingsSaveInput(form: GlobalSettingsFormState): GlobalSettingsSaveInput {
  return {
    default_llm: {
      mode: form.mode,
      model: form.model,
      api_base: form.apiBase,
      api_key: form.apiKey,
      local_model_path: form.localModelPath,
      ollama_model: form.ollamaModel,
      context_window: form.contextWindow,
      // 空串 → 走 API 层 normalizeChatPath 归一为 undefined（不落盘）；非空即自定义路径。
      chat_path: form.chatPath,
    },
    embedding: {
      model: form.embeddingModel,
      api_base: form.embeddingApiBase,
      api_key: form.embeddingApiKey,
    },
  };
}

export function createDefaultAuSettingsFormState(): AuSettingsFormState {
  return {
    perspective: DEFAULT_PERSPECTIVE,
    emotionStyle: DEFAULT_EMOTION_STYLE,
    chapterLength: 2000,
    customInstructions: "",
    pinnedContext: [],
    coreIncludes: [],
    isLlmOverride: false,
    llmMode: "api",
    auModel: "",
    auLocalModelPath: "",
    auOllamaModel: "",
    auApiBase: "",
    auApiKey: "",
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    chatPath: "",
    isEmbeddingOverride: false,
    embModel: "",
    embApiBase: "",
    embApiKey: "",
  };
}

export function hydrateAuSettingsForm(project: ProjectInfo | null): AuSettingsFormState {
  const form = createDefaultAuSettingsFormState();
  if (!project) return form;

  form.perspective = project.writing_style?.perspective || DEFAULT_PERSPECTIVE;
  form.emotionStyle = project.writing_style?.emotion_style || DEFAULT_EMOTION_STYLE;
  form.chapterLength = project.chapter_length || 2000;
  form.customInstructions = project.writing_style?.custom_instructions || "";
  form.pinnedContext = project.pinned_context || [];
  form.coreIncludes = project.core_always_include || [];

  if (project.embedding_lock && (project.embedding_lock.model || project.embedding_lock.api_key)) {
    form.isEmbeddingOverride = true;
    form.embModel = project.embedding_lock.model || "";
    form.embApiBase = project.embedding_lock.api_base || "";
    form.embApiKey = project.embedding_lock.api_key || "";
  }

  if (
    project.llm
    && (
      project.llm.mode !== "api"
      || project.llm.model
      || project.llm.api_base
      || project.llm.api_key
      || project.llm.local_model_path
      || project.llm.ollama_model
      || project.llm.chat_path
    )
  ) {
    form.isLlmOverride = true;
    form.llmMode = project.llm.mode || "api";
    form.auModel = project.llm.model || "";
    form.auLocalModelPath = project.llm.local_model_path || "";
    form.auOllamaModel = project.llm.ollama_model || project.llm.model || "";
    form.auApiBase = project.llm.api_base || "";
    form.auApiKey = project.llm.api_key || "";
    form.contextWindow = project.llm.context_window || 128000;
    form.chatPath = project.llm.chat_path || "";
  }

  return form;
}

export function buildAuSettingsSaveInput(form: AuSettingsFormState): AuSettingsSaveInput {
  return {
    chapter_length: form.chapterLength,
    writing_style: {
      perspective: form.perspective,
      emotion_style: form.emotionStyle,
      custom_instructions: form.customInstructions,
    },
    pinned_context: form.pinnedContext,
    core_always_include: form.coreIncludes,
    embedding_override: {
      enabled: form.isEmbeddingOverride,
      model: form.embModel,
      api_base: form.embApiBase,
      api_key: form.embApiKey,
    },
    llm_override: {
      enabled: form.isLlmOverride,
      mode: form.llmMode,
      model: form.auModel,
      api_base: form.auApiBase,
      api_key: form.auApiKey,
      local_model_path: form.auLocalModelPath,
      ollama_model: form.auOllamaModel,
      context_window: form.contextWindow,
      // 空串 → API 层 normalizeChatPath 归一为 undefined（不落盘）；非空即自定义路径。
      chat_path: form.chatPath,
    },
  };
}

/**
 * 是否提示「本篇 AU 的 API Key 为空」（TD-008）。
 *
 * 触发条件：覆盖被识别为开启（`isLlmOverride`）+ API 模式 + key 留空。常见成因是
 * AU 被删除后从回收站恢复 —— 删除时会**立即清除**密钥（缩小凭据泄漏窗口，见
 * engine-fandom `deleteAu`/`removeSecureStorage`），project.yaml 里只剩 `<secure>`
 * 占位符，恢复后读出来是空字符串，用户会困惑「之前填过怎么没了」。也覆盖「开了覆盖
 * 但一直没填 key」的情形。措辞只陈述「为空 + 恢复会清除」这一事实、不断言成因，故无误报。
 *
 * **已知局限（见 TECH-DEBT TD-008 + 后续任务）**：`isLlmOverride` 目前由
 * `hydrateAuSettingsForm` 从 llm 各字段「真值推断」，没有独立持久化的开关位。对一个
 * **只覆盖了 key**（model / api_base 都沿用全局）的 AU，删除→恢复把唯一非空字段
 * （key）也清空后，推断结果退回 `false` —— 覆盖区整体折叠，本提示不会出现。此时
 * 用户的真实问题更深（覆盖被静默丢失），需要持久化「覆盖开启」标志位才能根治，且涉及
 * 运行时 has_override 的产品取舍，单列后续任务跟踪。本提示对「整段覆盖（model/api_base
 * 非空）+ key 被清」这一更常见场景工作正常。
 */
export function shouldWarnEmptyAuApiKey(
  isLlmOverride: boolean,
  llmMode: string,
  auApiKey: string,
): boolean {
  return isLlmOverride && llmMode === "api" && auApiKey.trim() === "";
}
