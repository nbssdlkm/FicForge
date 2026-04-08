// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** LocalFileProjectRepository — project.yaml 读写实现。参见 PRD §3.4。 */

import yaml from "js-yaml";
import type { PlatformAdapter } from "../../platform/adapter.js";
import { EmotionStyle, LLMMode, Perspective } from "../../domain/enums.js";
import type { CastRegistry, EmbeddingLock, LLMConfig, Project, WritingStyle } from "../../domain/project.js";
import {
  createCastRegistry,
  createEmbeddingLock,
  createLLMConfig,
  createProject,
  createWritingStyle,
} from "../../domain/project.js";
import type { ProjectRepository } from "../interfaces/project.js";
import { joinPath, now_utc, obj_to_plain } from "./file_utils.js";

export class FileProjectRepository implements ProjectRepository {
  constructor(private adapter: PlatformAdapter) {}

  async get(au_id: string): Promise<Project> {
    const path = joinPath(au_id, "project.yaml");
    const exists = await this.adapter.exists(path);
    if (!exists) {
      throw new Error(`project.yaml not found: ${path}`);
    }

    const text = await this.adapter.readFile(path);
    let raw: Record<string, unknown>;
    try {
      const parsed = yaml.load(text);
      raw = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
    } catch {
      throw new Error(`project.yaml 损坏无法解析: ${path}`);
    }

    return dictToProject(raw, au_id);
  }

  async save(project: Project): Promise<void> {
    const path = joinPath(project.au_id, "project.yaml");
    project.updated_at = now_utc();
    project.revision += 1;
    const raw = obj_to_plain(project);
    const content = yaml.dump(raw, { sortKeys: false, lineWidth: -1 });
    const dir = path.substring(0, path.lastIndexOf("/"));
    await this.adapter.mkdir(dir);
    await this.adapter.writeFile(path, content);
  }

  async list_aus(fandom: string): Promise<Project[]> {
    const ausDir = joinPath(fandom, "aus");
    const exists = await this.adapter.exists(ausDir);
    if (!exists) return [];

    const entries = await this.adapter.listDir(ausDir);
    const result: Project[] = [];
    for (const name of entries.sort()) {
      const auPath = joinPath(ausDir, name);
      try {
        const project = await this.get(auPath);
        result.push(project);
      } catch {
        continue;
      }
    }
    return result;
  }
}

// ---------------------------------------------------------------------------
// YAML dict → Project 映射
// ---------------------------------------------------------------------------

function dictToLLMConfig(d: Record<string, unknown> | null): LLMConfig {
  if (!d) return createLLMConfig();
  return createLLMConfig({
    mode: LLMMode[(d.mode as string)?.toUpperCase() as keyof typeof LLMMode] ?? LLMMode.API,
    model: (d.model as string) ?? "",
    api_base: (d.api_base as string) ?? "",
    api_key: (d.api_key as string) ?? "",
    local_model_path: (d.local_model_path as string) ?? "",
    ollama_model: (d.ollama_model as string) ?? "",
    context_window: (d.context_window as number) ?? 0,
  });
}

function dictToWritingStyle(d: Record<string, unknown> | null): WritingStyle {
  if (!d) return createWritingStyle();
  return createWritingStyle({
    perspective: Perspective[(d.perspective as string)?.toUpperCase() as keyof typeof Perspective] ?? Perspective.THIRD_PERSON,
    pov_character: (d.pov_character as string) ?? "",
    emotion_style: EmotionStyle[(d.emotion_style as string)?.toUpperCase() as keyof typeof EmotionStyle] ?? EmotionStyle.IMPLICIT,
    custom_instructions: (d.custom_instructions as string) ?? "",
  });
}

function dictToCastRegistry(d: Record<string, unknown> | null): CastRegistry {
  if (!d) return createCastRegistry();
  // D-0022: 新格式使用 characters 列表；兼容旧格式
  if ("characters" in d) {
    return createCastRegistry({ characters: (d.characters as string[]) ?? [] });
  }
  // 旧格式迁移：合并去重
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const group of ["from_core", "au_specific", "oc"]) {
    const names = (d[group] as string[]) ?? [];
    for (const name of names) {
      if (!seen.has(name)) {
        merged.push(name);
        seen.add(name);
      }
    }
  }
  return createCastRegistry({ characters: merged });
}

function dictToEmbeddingLock(d: Record<string, unknown> | null): EmbeddingLock {
  if (!d) return createEmbeddingLock();
  return createEmbeddingLock({
    mode: (d.mode as string) ?? "",
    model: (d.model as string) ?? "",
    api_base: (d.api_base as string) ?? "",
    api_key: (d.api_key as string) ?? "",
  });
}

function dictToProject(d: Record<string, unknown>, au_id: string): Project {
  const projectId = (d.project_id as string) || crypto.randomUUID();

  return createProject({
    project_id: projectId,
    au_id,
    name: (d.name as string) ?? "",
    fandom: (d.fandom as string) ?? "",
    schema_version: (d.schema_version as string) ?? "1.0.0",
    revision: (d.revision as number) ?? 1,
    created_at: (d.created_at as string) ?? "",
    updated_at: (d.updated_at as string) ?? "",
    llm: dictToLLMConfig(d.llm as Record<string, unknown> | null),
    model_params_override: (d.model_params_override as Record<string, Record<string, unknown>>) ?? {},
    chapter_length: (d.chapter_length as number) ?? 1500,
    writing_style: dictToWritingStyle(d.writing_style as Record<string, unknown> | null),
    ignore_core_worldbuilding: (d.ignore_core_worldbuilding as boolean) ?? false,
    agent_pipeline_enabled: (d.agent_pipeline_enabled as boolean) ?? false,
    cast_registry: dictToCastRegistry(d.cast_registry as Record<string, unknown> | null),
    core_always_include: (d.core_always_include as string[]) ?? [],
    pinned_context: (d.pinned_context as string[]) ?? [],
    rag_decay_coefficient: (d.rag_decay_coefficient as number) ?? 0.05,
    embedding_lock: dictToEmbeddingLock(d.embedding_lock as Record<string, unknown> | null),
    core_guarantee_budget: (d.core_guarantee_budget as number) ?? 400,
    current_branch: (d.current_branch as string) ?? "main",
  });
}
