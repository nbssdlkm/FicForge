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
import { joinPath, now_utc, obj_to_plain, validateBasePath } from "./file_utils.js";
import {
  extractSecureFields,
  removeSecureFields,
  restoreSecureFields,
  type SecureFieldSpec,
} from "./secure_fields.js";

/**
 * AU 级敏感字段 spec factory。
 * secureKey 用 `project.{au_id}.` 做 namespace，不同 AU 的凭据独立存储。
 *
 * ⚠️ 历史遗留：在引入本 spec 之前，AU 级 llm.api_key 会被明文写进 project.yaml
 *    （审计 P1 问题）。restoreSecureFields 里的"旧明文自动迁移"分支会无感地把
 *    老 project.yaml 的明文 key 搬进 secure storage，下次 save 时写占位符。
 */
function projectSecureSpecs(au_id: string): SecureFieldSpec<Project>[] {
  return [
    {
      secureKey: `project.${au_id}.llm.api_key`,
      get: (p) => p.llm.api_key,
      set: (p, v) => { p.llm.api_key = v; },
    },
    {
      secureKey: `project.${au_id}.embedding_lock.api_key`,
      get: (p) => p.embedding_lock.api_key,
      set: (p, v) => { p.embedding_lock.api_key = v; },
    },
  ];
}

/** 返回 au_id 对应的所有 secure keys（供删除 AU 时一并清理）。 */
export function projectSecureKeysFor(au_id: string): string[] {
  // 临时构造一个空壳 project 以复用 spec factory
  return projectSecureSpecs(au_id).map((s) => s.secureKey);
}

export class FileProjectRepository implements ProjectRepository {
  constructor(private adapter: PlatformAdapter) {}

  async get(au_id: string): Promise<Project> {
    validateBasePath(au_id, "au_id");
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

    const project = dictToProject(raw, au_id);
    // 还原敏感字段（占位符→secure storage；旧明文→自动迁移）
    await restoreSecureFields(project, projectSecureSpecs(au_id), this.adapter);
    return project;
  }

  async save(project: Project): Promise<void> {
    validateBasePath(project.au_id, "au_id");
    const path = joinPath(project.au_id, "project.yaml");
    const copy = structuredClone(project);
    copy.updated_at = now_utc();
    copy.revision += 1;
    // 把 AU 级 api_key 抽到 secure storage —— 写入 project.yaml 的只是占位符，
    // 防止项目工作目录备份 / 同步 / 导出时凭据扩散（审计 P1）
    await extractSecureFields(copy, projectSecureSpecs(copy.au_id), this.adapter);
    const raw = obj_to_plain(copy);
    const content = yaml.dump(raw, { sortKeys: false, lineWidth: -1 });
    const dir = path.substring(0, path.lastIndexOf("/"));
    await this.adapter.mkdir(dir);
    await this.adapter.writeFile(path, content);
  }

  async list_aus(fandom: string): Promise<Project[]> {
    validateBasePath(fandom, "fandom");
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

  /**
   * 删除 AU 时调用：清理该 AU 在 secure storage 里的所有凭据。
   * 避免孤儿 key 留在 secure storage 里造成信息残留。
   */
  async removeSecureStorage(au_id: string): Promise<void> {
    await removeSecureFields(projectSecureKeysFor(au_id), this.adapter);
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
