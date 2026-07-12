// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** LocalFileProjectRepository — project.yaml 读写实现。参见 PRD §3.4。 */

import * as yaml from "js-yaml";
import type { PlatformAdapter } from "../../platform/adapter.js";
import { EmotionStyle, Perspective } from "../../domain/enums.js";
import type { CastRegistry, EmbeddingLock, Project, WritingStyle } from "../../domain/project.js";
import {
  createCastRegistry,
  createEmbeddingLock,
  createProject,
  createWritingStyle,
  dictToLLMConfig,
  ON_DISK_DEFAULT_REVISION,
} from "../../domain/project.js";
import type { ProjectRepository } from "../interfaces/project.js";
import { PROJECT_YAML } from "../../domain/paths.js";
import { atomicWrite, dumpYaml, joinPath, nowUtc, objToPlain, validateBasePath } from "../../utils/file_utils.js";
import {
  extractSecureFields,
  hasLegacyPlaintextSecureFields,
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
      set: (p, v) => {
        p.llm.api_key = v;
      },
    },
    {
      secureKey: `project.${au_id}.embedding_lock.api_key`,
      get: (p) => p.embedding_lock.api_key,
      set: (p, v) => {
        p.embedding_lock.api_key = v;
      },
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

  async get(au_id: string): Promise<Project | null> {
    validateBasePath(au_id, "au_id");
    const path = joinPath(au_id, PROJECT_YAML);
    const exists = await this.adapter.exists(path);
    // 缺失返回 null、fs 错误照抛（get 契约，盲审 2026-07-09 全仓储统一）
    if (!exists) return null;

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

  /**
   * 全量覆盖写 project.yaml。**不自持文件锁**（避免与调用方持有的 withProjectFileLock
   * 同 key 重入死锁；本方法内部只再取 atomicWrite 的独立文件锁，key 不同不自锁）。
   * 契约：任何「读 project → 改 → save」的调用方，必须把 get+save 整段包在
   * withProjectFileLock(auPath) 内，否则会与 TrashService 的 cast_registry 读改写
   * 并发丢更新（盲审 R3 M1）。当前所有 RMW 入口都已就位：
   * engine-project.withProjectWrite / deletePinned / TrashService.updateCastRegistry /
   * secure_storage_migration（对 migrateLegacySecureStorage 的调用）。
   */
  async save(project: Project): Promise<void> {
    validateBasePath(project.au_id, "au_id");
    const path = joinPath(project.au_id, PROJECT_YAML);
    const copy = structuredClone(project);
    copy.updated_at = nowUtc();
    copy.revision += 1;
    // 把 AU 级 api_key 抽到 secure storage —— 写入 project.yaml 的只是占位符，
    // 防止项目工作目录备份 / 同步 / 导出时凭据扩散（审计 P1）
    await extractSecureFields(copy, projectSecureSpecs(copy.au_id), this.adapter);
    const raw = objToPlain(copy);
    const content = dumpYaml(raw);
    const dir = path.substring(0, path.lastIndexOf("/"));
    await this.adapter.mkdir(dir);
    // project.yaml 损坏时 get() 直接抛错、整 AU 不可开 —— 原子写（审计 H5）
    await atomicWrite(this.adapter, path, content);
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
        // 无 project.yaml 的目录（非 AU / 半删除残留）→ 跳过
        if (project) result.push(project);
      } catch {}
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

  /**
   * 显式迁移旧版 project.yaml 中的明文 secret。
   * 仅重写占位符，不推进 revision / updated_at。
   */
  async migrateLegacySecureStorage(au_id: string): Promise<boolean> {
    validateBasePath(au_id, "au_id");
    const path = joinPath(au_id, PROJECT_YAML);
    const exists = await this.adapter.exists(path);
    if (!exists) return false;

    const text = await this.adapter.readFile(path);
    let raw: Record<string, unknown>;
    try {
      const parsed = yaml.load(text);
      raw = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
    } catch {
      return false;
    }

    const project = dictToProject(raw, au_id);
    const specs = projectSecureSpecs(au_id);
    if (!hasLegacyPlaintextSecureFields(project, specs)) {
      return false;
    }

    await restoreSecureFields(project, specs, this.adapter);
    const sanitized = structuredClone(project);
    await extractSecureFields(sanitized, specs, this.adapter);
    const content = dumpYaml(objToPlain(sanitized));
    await atomicWrite(this.adapter, path, content);
    return true;
  }
}

// ---------------------------------------------------------------------------
// YAML dict → Project 映射
// ---------------------------------------------------------------------------

function dictToWritingStyle(d: Record<string, unknown> | null): WritingStyle {
  if (!d) return createWritingStyle();
  return createWritingStyle({
    perspective:
      Perspective[(d.perspective as string)?.toUpperCase() as keyof typeof Perspective] ?? Perspective.THIRD_PERSON,
    pov_character: (d.pov_character as string) ?? "",
    emotion_style:
      EmotionStyle[(d.emotion_style as string)?.toUpperCase() as keyof typeof EmotionStyle] ?? EmotionStyle.IMPLICIT,
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

  // 可调默认值单源（R4 重复维 M7）：1500/400/0.05/"1.0.0"/"main" 只在 createProject 声明一份，
  // 本映射器对这些字段只透传「YAML 真有的合法值」（条件展开省略缺省键，避免 undefined 覆盖默认）；
  // 类型不合法的值同样交还默认——此前 `(d.x as number) ?? 1500` 会把字符串脏值原样放行。
  // revision 的 `?? 1` 是有意的读侧约定（非漂移），见 ON_DISK_DEFAULT_REVISION 文档。
  return createProject({
    project_id: projectId,
    au_id,
    name: (d.name as string) ?? "",
    fandom: (d.fandom as string) ?? "",
    ...(typeof d.schema_version === "string" && d.schema_version ? { schema_version: d.schema_version } : {}),
    revision: (d.revision as number) ?? ON_DISK_DEFAULT_REVISION,
    created_at: (d.created_at as string) ?? "",
    updated_at: (d.updated_at as string) ?? "",
    llm: dictToLLMConfig(d.llm as Record<string, unknown> | null),
    model_params_override: (d.model_params_override as Record<string, Record<string, unknown>>) ?? {},
    ...(typeof d.chapter_length === "number" && Number.isFinite(d.chapter_length)
      ? { chapter_length: d.chapter_length }
      : {}),
    writing_style: dictToWritingStyle(d.writing_style as Record<string, unknown> | null),
    ignore_core_worldbuilding: (d.ignore_core_worldbuilding as boolean) ?? false,
    agent_pipeline_enabled: (d.agent_pipeline_enabled as boolean) ?? false,
    cast_registry: dictToCastRegistry(d.cast_registry as Record<string, unknown> | null),
    core_always_include: (d.core_always_include as string[]) ?? [],
    pinned_context: (d.pinned_context as string[]) ?? [],
    ...(typeof d.rag_decay_coefficient === "number" && Number.isFinite(d.rag_decay_coefficient)
      ? { rag_decay_coefficient: d.rag_decay_coefficient }
      : {}),
    embedding_lock: dictToEmbeddingLock(d.embedding_lock as Record<string, unknown> | null),
    ...(typeof d.core_guarantee_budget === "number" && Number.isFinite(d.core_guarantee_budget)
      ? { core_guarantee_budget: d.core_guarantee_budget }
      : {}),
    ...(typeof d.current_branch === "string" && d.current_branch ? { current_branch: d.current_branch } : {}),
  });
}
