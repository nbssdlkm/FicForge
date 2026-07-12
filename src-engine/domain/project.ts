// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** AU 项目配置领域对象。参见 PRD §3.4 project.yaml。 */

import { EmotionStyle, LLMMode, Perspective } from "./enums.js";

/**
 * 盘上缺省 revision 约定（读侧真相源）：YAML 无 revision 字段（引擎早期版本产物）
 * 一律认作「已持久化的首版」= 1。与 createProject 的 revision: 0（未持久化的新建，
 * 首次 save += 1 后变 1）是同一约定的读写两面——不是漂移，别把两侧"统一"掉（R4 重复维 M7 勘误）。
 * project/state/chapter/fact/ops 投影五处 dict-to-domain 映射器共用本常量。
 */
export const ON_DISK_DEFAULT_REVISION = 1;

/** RAG 时间衰减系数默认值（真相源：createProject 缺省与 retrieveRag 参数默认共用）。 */
export const DEFAULT_RAG_DECAY_COEFFICIENT = 0.05;

export interface LLMConfig {
  mode: LLMMode;
  model: string;
  api_base: string;
  api_key: string;
  local_model_path: string;
  ollama_model: string;
  context_window: number; // 0 = 自动推断
  /**
   * 非标聊天补全路径（默认 /chat/completions）。特殊网关（自定义供应商 chatPath）用。
   * 与 api_base 同源随层持久化：缺省 = 未设置（消费方回退默认路径），不写默认值 ——
   * 与 CustomProviderEntry.chatPath 的「缺省即默认」语义一致，避免把默认伪装成用户配置。
   */
  chat_path?: string;
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
    // chat_path 有意不设默认：optional 字段，只在用户配了自定义路径时才存在，
    // 缺省交给消费方回退 /chat/completions（禁静默把默认写进持久化层）。
    ...partial,
  };
}

/**
 * YAML dict → LLMConfig（持久化读映射）。file_settings 与 file_project 共用——
 * 此前两文件各持一份字节级相同的拷贝，LLMConfig 增删字段须两处同改（R4 重复维 M1），收敛于此。
 */
export function dictToLLMConfig(d: Record<string, unknown> | null): LLMConfig {
  if (!d) return createLLMConfig();
  return createLLMConfig({
    mode: LLMMode[(d.mode as string)?.toUpperCase() as keyof typeof LLMMode] ?? LLMMode.API,
    model: (d.model as string) ?? "",
    api_base: (d.api_base as string) ?? "",
    api_key: (d.api_key as string) ?? "",
    local_model_path: (d.local_model_path as string) ?? "",
    ollama_model: (d.ollama_model as string) ?? "",
    context_window: (d.context_window as number) ?? 0,
    // chat_path：optional，只在 YAML 真有非空值时映射（缺省 = 未设置，走默认路径）。
    // 与 custom_providers.chatPath 的「未知≠默认」映射口径一致。
    ...(typeof d.chat_path === "string" && d.chat_path ? { chat_path: d.chat_path } : {}),
  });
}

export interface WritingStyle {
  perspective: Perspective;
  pov_character: string; // first_person 时必填
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
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601

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
  core_guarantee_budget: number; // D-0015

  current_branch: string;
}

export function createProject(partial: Pick<Project, "project_id" | "au_id"> & Partial<Project>): Project {
  return {
    name: "",
    fandom: "",
    schema_version: "1.0.0",
    revision: 0, // 未持久化的新建；首次 save += 1。盘上缺省的读侧约定见 ON_DISK_DEFAULT_REVISION
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
    rag_decay_coefficient: DEFAULT_RAG_DECAY_COEFFICIENT,
    embedding_lock: createEmbeddingLock(),
    core_guarantee_budget: 400,
    current_branch: "main",
    ...partial,
  };
}
