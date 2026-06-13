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
  embeddingModel: string;
  embeddingApiBase: string;
  embeddingApiKey: string;
  useCustomEmbedding: boolean;
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
    embeddingModel: "",
    embeddingApiBase: "",
    embeddingApiKey: "",
    useCustomEmbedding: false,
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
  }

  form.embeddingModel = settings.embedding?.model || "";
  form.embeddingApiBase = settings.embedding?.api_base || "";
  form.embeddingApiKey = settings.embedding?.api_key || "";
  form.useCustomEmbedding = Boolean(settings.embedding?.model && settings.embedding?.api_key);

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
    },
    embedding: {
      use_custom_config: form.useCustomEmbedding,
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
    },
  };
}
