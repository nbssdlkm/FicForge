// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** AU 项目配置领域对象。参见 PRD §3.4 project.yaml。 */

import { EmotionStyle, LLMMode, Perspective } from "./enums.js";

export interface LLMConfig {
  mode: LLMMode;
  model: string;
  api_base: string;
  api_key: string;
  local_model_path: string;
  ollama_model: string;
  context_window: number;    // 0 = 自动推断
}

export function createLLMConfig(partial?: Partial<LLMConfig>): LLMConfig {
  return {
    mode: LLMMode.API,
    model: "",
    api_base: "",
    api_key: "",
    local_model_path: "",
    ollama_model: "",
    context_window: 0,
    ...partial,
  };
}

export interface WritingStyle {
  perspective: Perspective;
  pov_character: string;        // first_person 时必填
  emotion_style: EmotionStyle;
  custom_instructions: string;
}

export function createWritingStyle(partial?: Partial<WritingStyle>): WritingStyle {
  return {
    perspective: Perspective.THIRD_PERSON,
    pov_character: "",
    emotion_style: EmotionStyle.IMPLICIT,
    custom_instructions: "",
    ...partial,
  };
}

/** 出场人物注册表。参见 PRD §3.4 / D-0022。 */
export interface CastRegistry {
  characters: string[];
}

export function createCastRegistry(partial?: Partial<CastRegistry>): CastRegistry {
  return {
    characters: [],
    ...partial,
  };
}

/** Embedding 模型锁定配置。参见 PRD §3.4。 */
export interface EmbeddingLock {
  mode: string;
  model: string;
  api_base: string;
  api_key: string;
}

export function createEmbeddingLock(partial?: Partial<EmbeddingLock>): EmbeddingLock {
  return {
    mode: "",
    model: "",
    api_base: "",
    api_key: "",
    ...partial,
  };
}

/** AU 项目配置。字段名与 PRD §3.4 project.yaml 一致。 */
export interface Project {
  project_id: string;
  au_id: string;
  name: string;
  fandom: string;
  schema_version: string;
  revision: number;
  created_at: string;                           // ISO 8601
  updated_at: string;                           // ISO 8601

  llm: LLMConfig;
  model_params_override: Record<string, Record<string, unknown>>;

  chapter_length: number;
  writing_style: WritingStyle;
  ignore_core_worldbuilding: boolean;
  agent_pipeline_enabled: boolean;

  cast_registry: CastRegistry;
  core_always_include: string[];
  pinned_context: string[];

  rag_decay_coefficient: number;
  embedding_lock: EmbeddingLock;
  core_guarantee_budget: number;               // D-0015

  current_branch: string;
}

export function createProject(partial: Pick<Project, "project_id" | "au_id"> & Partial<Project>): Project {
  return {
    name: "",
    fandom: "",
    schema_version: "1.0.0",
    revision: 0,
    created_at: "",
    updated_at: "",
    llm: createLLMConfig(),
    model_params_override: {},
    chapter_length: 1500,
    writing_style: createWritingStyle(),
    ignore_core_worldbuilding: false,
    agent_pipeline_enabled: false,
    cast_registry: createCastRegistry(),
    core_always_include: [],
    pinned_context: [],
    rag_decay_coefficient: 0.05,
    embedding_lock: createEmbeddingLock(),
    core_guarantee_budget: 400,
    current_branch: "main",
    ...partial,
  };
}
