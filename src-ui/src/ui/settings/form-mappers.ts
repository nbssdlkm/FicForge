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
  syncMode: "none" | "webdav";
  syncUrl: string;
  syncUsername: string;
  syncPassword: string;
  syncRemoteDir: string;
  lastSync: string | null;
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
    model: "deepseek-chat",
    localModelPath: "",
    ollamaModel: "",
    apiBase: "https://api.deepseek.com",
    apiKey: "",
    contextWindow: 128000,
    embeddingModel: "",
    embeddingApiBase: "",
    embeddingApiKey: "",
    useCustomEmbedding: false,
    syncMode: "none",
    syncUrl: "",
    syncUsername: "",
    syncPassword: "",
    syncRemoteDir: "/FicForge/",
    lastSync: null,
  };
}

export function hydrateGlobalSettingsForm(settings: SettingsInfo | null): GlobalSettingsFormState {
  const form = createDefaultGlobalSettingsFormState();
  if (!settings) return form;

  if (settings.default_llm) {
    const nextMode = settings.default_llm.mode || LLMMode.API;
    form.mode = nextMode;
    form.model = settings.default_llm.model || "deepseek-chat";
    form.localModelPath = settings.default_llm.local_model_path || "";
    form.ollamaModel = settings.default_llm.ollama_model || settings.default_llm.model || "";
    form.apiBase = settings.default_llm.api_base
      || (nextMode === "ollama" ? "http://localhost:11434/v1" : "https://api.deepseek.com");
    form.apiKey = settings.default_llm.api_key || "";
    form.contextWindow = settings.default_llm.context_window || 128000;
  }

  form.embeddingModel = settings.embedding?.model || "";
  form.embeddingApiBase = settings.embedding?.api_base || "";
  form.embeddingApiKey = settings.embedding?.api_key || "";
  form.useCustomEmbedding = Boolean(settings.embedding?.model && settings.embedding?.api_key);

  if (settings.sync) {
    form.syncMode = settings.sync.mode || "none";
    if (settings.sync.webdav) {
      form.syncUrl = settings.sync.webdav.url || "";
      form.syncUsername = settings.sync.webdav.username || "";
      form.syncPassword = settings.sync.webdav.password || "";
      form.syncRemoteDir = settings.sync.webdav.remote_dir || "/FicForge/";
    }
    form.lastSync = settings.sync.last_sync || null;
  }

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
    sync: {
      mode: form.syncMode,
      url: form.syncUrl,
      username: form.syncUsername,
      password: form.syncPassword,
      remote_dir: form.syncRemoteDir,
      last_sync: form.lastSync,
    },
  };
}

export function createDefaultAuSettingsFormState(): AuSettingsFormState {
  return {
    perspective: "third_person",
    emotionStyle: "implicit",
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
    contextWindow: 128000,
    isEmbeddingOverride: false,
    embModel: "",
    embApiBase: "",
    embApiKey: "",
  };
}

export function hydrateAuSettingsForm(project: ProjectInfo | null): AuSettingsFormState {
  const form = createDefaultAuSettingsFormState();
  if (!project) return form;

  form.perspective = project.writing_style?.perspective || "third_person";
  form.emotionStyle = project.writing_style?.emotion_style || "implicit";
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
