// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Fandom / AU 查询与命令层 —— 引擎层单一实现。
 *
 * R4 架构维 HIGH 治本（E3）：此前住在 UI api 层（engine-fandoms.ts），fandom 文件裸读写、
 * 目录布局 `${dataDir}/fandoms/...` 手拼、删除路径的锁序/回收站/向量卸载/别名失效/密钥清理
 * 编排全在 UI。下沉后 UI 只做薄转发；读路径经 FandomRepository/ProjectRepository（get 契约：
 * 缺失=null、fs 错误照抛落日志），写与删除的编排收进引擎。
 *
 * 行为口径：与原 UI 实现逐字节等价迁移（E3 纪律 = 纯搬家）；warnUi → warnAlways（同为
 * 「logger 就绪落文件、未就绪降级 console」的 sanctioned 口径，tag 不变保日志连续性）。
 */

import type { PlatformAdapter } from "../platform/adapter.js";
import type { Fandom } from "../domain/fandom.js";
import type { Project } from "../domain/project.js";
import { createProject } from "../domain/project.js";
import type { State } from "../domain/state.js";
import { warnAlways } from "../logger/index.js";
import { FANDOM_YAML, PROJECT_YAML } from "../domain/paths.js";
import { sanitizePathSegment, validateExistingPathSegment } from "../utils/paths.js";
import { withAuLock } from "./au_lock.js";

/** 依赖注入面（结构兼容 UI EngineInstance 的子集；测试可用最小 mock 满足）。 */
export interface FandomServiceDeps {
  adapter: PlatformAdapter;
  dataDir: string;
  repos: {
    fandom: {
      get(fandom_path: string): Promise<Fandom | null>;
      save(fandom_path: string, fandom: Fandom): Promise<void>;
      list_fandoms(): Promise<string[]>;
      list_aus(fandom_path: string): Promise<string[]>;
    };
    project: {
      get(au_id: string): Promise<Project | null>;
      save(project: Project): Promise<void>;
      removeSecureStorage(au_id: string): Promise<void>;
    };
    state: { get(au_id: string): Promise<State | null> };
  };
  trash: {
    move_tree_to_trash(
      scope_root: string,
      relative_path: string,
      entry_type: string,
      display_name: string,
    ): Promise<{ trash_id: string }>;
  };
  ragManager: { unloadIfCurrent(auPath: string): void };
  characterAliases: { invalidate(auPath: string): void };
}

export interface FandomAuInfo {
  name: string;
  dir_name: string;
}

export interface FandomDisplayInfo {
  name: string;
  dir_name: string;
  path: string;
}

async function withOrderedAuLocks<T>(auPaths: string[], fn: () => Promise<T>): Promise<T> {
  const sorted = [...auPaths].sort();

  const run = async (index: number): Promise<T> => {
    if (index >= sorted.length) {
      return fn();
    }
    return withAuLock(sorted[index], () => run(index + 1));
  };

  return run(0);
}

export async function listFandoms(deps: FandomServiceDeps): Promise<
  Array<{
    name: string;
    dir_name: string;
    aus: Array<FandomAuInfo & { chapter_count: number; has_dirty: boolean }>;
  }>
> {
  const { fandom, state: stateRepo } = deps.repos;
  const dataDir = deps.dataDir;
  const dirNames = await fandom.list_fandoms();
  const result = [];

  for (const dirName of dirNames) {
    const fandomPath = `${dataDir}/fandoms/${dirName}`;
    const fandomInfo = await fandom.get(fandomPath).catch((e) => {
      // get 契约：缺失=null（走 ?? 兜底显示 dirName），真 fs 错误落日志不再静默吞
      warnAlways("engine-fandoms", `read fandom.yaml failed: ${fandomPath}`, { error: String(e) });
      return null;
    });
    const aus = await listAus(deps, dirName);

    // Enrich AU rows with cheap stats from state.yaml so Library can render
    // v13-style AU cards (chapter count + Draft badge) in one batched read.
    // Each AU's state read is parallel within the fandom; failures fall back
    // to zeroed stats so a corrupt or missing state.yaml doesn't break the
    // whole listing.
    const ausWithStats = await Promise.all(
      aus.map(async (au) => {
        const auPath = `${dataDir}/fandoms/${dirName}/aus/${au.dir_name}`;
        try {
          const state = await stateRepo.get(auPath);
          // current_chapter == "next chapter to draft", so confirmed chapter
          // count is current_chapter - 1 (clamped at 0). When chapters_dirty
          // is non-empty, treat the AU as having a draft visible to the user.
          const confirmed = Math.max(0, (state?.current_chapter ?? 1) - 1);
          const dirty = state?.chapters_dirty ?? [];
          return { ...au, chapter_count: confirmed, has_dirty: dirty.length > 0 };
        } catch {
          return { ...au, chapter_count: 0, has_dirty: false };
        }
      }),
    );

    result.push({
      name: fandomInfo?.name?.trim() || dirName,
      dir_name: dirName,
      aus: ausWithStats,
    });
  }

  return result;
}

export async function getFandomDisplayInfo(deps: FandomServiceDeps, fandomPath: string): Promise<FandomDisplayInfo> {
  const { fandom } = deps.repos;
  const dirName = fandomPath.split("/").pop() || "";
  const fandomInfo = await fandom.get(fandomPath).catch((e) => {
    warnAlways("engine-fandoms", `read fandom.yaml failed: ${fandomPath}`, { error: String(e) });
    return null;
  });
  return {
    name: fandomInfo?.name?.trim() || dirName,
    dir_name: dirName,
    path: fandomPath,
  };
}

export async function createFandom(
  deps: FandomServiceDeps,
  name: string,
): Promise<{ name: string; dir_name: string; path: string }> {
  const safeName = sanitizePathSegment(name);
  const dataDir = deps.dataDir;
  const path = `${dataDir}/fandoms/${safeName}`;

  if (await deps.adapter.exists(`${path}/${FANDOM_YAML}`)) {
    throw new Error(`Fandom "${safeName}" already exists`);
  }

  await deps.adapter.mkdir(path);
  await deps.repos.fandom.save(path, {
    name,
    created_at: new Date().toISOString(),
    core_characters: [],
    wiki_source: "",
  });

  return { name, dir_name: safeName, path };
}

export async function listAus(deps: FandomServiceDeps, fandomDirName: string): Promise<FandomAuInfo[]> {
  const safeFandomDir = validateExistingPathSegment(fandomDirName);
  const dataDir = deps.dataDir;
  const { fandom, project } = deps.repos;
  const { adapter } = deps;
  const auDirs = await fandom.list_aus(`${dataDir}/fandoms/${safeFandomDir}`);
  const validAus: FandomAuInfo[] = [];

  for (const dirName of auDirs) {
    const auPath = `${dataDir}/fandoms/${safeFandomDir}/aus/${dirName}`;
    if (!(await adapter.exists(`${auPath}/${PROJECT_YAML}`))) {
      continue;
    }

    const projectInfo = await project.get(auPath).catch((e) => {
      warnAlways("engine-fandoms", `read project.yaml failed: ${auPath}`, { error: String(e) });
      return null;
    });
    validAus.push({
      name: projectInfo?.name?.trim() || dirName,
      dir_name: dirName,
    });
  }

  return validAus;
}

export async function createAu(
  deps: FandomServiceDeps,
  fandomName: string,
  auName: string,
  fandomPath: string,
): Promise<{ name: string; dir_name: string; path: string }> {
  const safeName = sanitizePathSegment(auName);
  const { adapter } = deps;
  const auPath = `${fandomPath}/aus/${safeName}`;

  if (await adapter.exists(`${auPath}/${PROJECT_YAML}`)) {
    throw new Error(`AU "${safeName}" already exists`);
  }

  await adapter.mkdir(auPath);
  const proj = createProject({
    project_id: crypto.randomUUID(),
    au_id: auPath,
    name: auName,
    fandom: fandomName,
  });
  await deps.repos.project.save(proj);

  return { name: auName, dir_name: safeName, path: auPath };
}

export async function deleteFandom(
  deps: FandomServiceDeps,
  fandomDirName: string,
): Promise<{ status: "ok"; trash_id: string }> {
  const safeFandomDir = validateExistingPathSegment(fandomDirName);
  const dataDir = deps.dataDir;
  const { adapter } = deps;
  const fandomsRoot = `${dataDir}/fandoms`;
  const fandomRoot = `${dataDir}/fandoms/${safeFandomDir}`;
  const fandomInfo = await deps.repos.fandom.get(fandomRoot).catch((e) => {
    warnAlways("engine-fandoms", `read fandom.yaml failed: ${fandomRoot}`, { error: String(e) });
    return null;
  });
  const displayName = fandomInfo?.name?.trim() || safeFandomDir;

  const ausDir = `${fandomRoot}/aus`;
  const auPaths = (await adapter.exists(ausDir)) ? (await adapter.listDir(ausDir)).map((au) => `${ausDir}/${au}`) : [];

  return withOrderedAuLocks(auPaths, async () => {
    const entry = await deps.trash.move_tree_to_trash(fandomsRoot, safeFandomDir, "fandom", displayName);

    for (const auPath of auPaths) {
      // H9c：树已移入 trash，卸载其中任何仍驻留内存的 AU 向量索引 ——
      // 否则同名重建会经 ensureLoaded 跳过 load、继承已删作品的内存向量并在下次 persist 落盘固化。
      deps.ragManager.unloadIfCurrent(auPath);
      // 同理失效别名表缓存：同名重建且角色卡文件名集合恰好相同时，签名兜底判不出差异。
      deps.characterAliases.invalidate(auPath);
      try {
        await deps.repos.project.removeSecureStorage(auPath);
      } catch {
        // Best effort cleanup for per-AU secrets.
      }
    }

    return { status: "ok", trash_id: entry.trash_id };
  });
}

export async function deleteAu(
  deps: FandomServiceDeps,
  fandomDirName: string,
  auName: string,
): Promise<{ status: "ok"; trash_id: string }> {
  const safeFandomDir = validateExistingPathSegment(fandomDirName);
  const safeAuName = validateExistingPathSegment(auName);
  const dataDir = deps.dataDir;
  const fandomRoot = `${dataDir}/fandoms/${safeFandomDir}`;
  const auPath = `${fandomRoot}/aus/${safeAuName}`;

  return withAuLock(auPath, async () => {
    const projectInfo = await deps.repos.project.get(auPath).catch((e) => {
      warnAlways("engine-fandoms", `read project.yaml failed: ${auPath}`, { error: String(e) });
      return null;
    });
    const displayName = projectInfo?.name?.trim() || safeAuName;
    const entry = await deps.trash.move_tree_to_trash(fandomRoot, `aus/${safeAuName}`, "au", displayName);
    // H9c：AU 已移入 trash，卸载其内存向量索引（不 persist —— 数据已移走）。
    // 否则同名重建的 AU 会经 ensureLoaded 跳过 load、直接继承已删作品的内存向量，
    // 且首次 indexChapter 的 persist 会把它落盘固化进新 AU。trash 恢复路径天然对称：
    // 恢复后首次 ensureLoaded 从磁盘重新 load 原 .vectors/。
    deps.ragManager.unloadIfCurrent(auPath);
    // 同理失效别名表缓存：同名重建且角色卡文件名集合恰好相同时，签名兜底判不出差异。
    deps.characterAliases.invalidate(auPath);
    try {
      await deps.repos.project.removeSecureStorage(auPath);
    } catch {
      // Best effort cleanup for per-AU secrets.
    }
    return { status: "ok", trash_id: entry.trash_id };
  });
}

export async function listFandomFiles(
  deps: FandomServiceDeps,
  fandomName: string,
): Promise<{
  characters: Array<{ name: string; filename: string }>;
  worldbuilding: Array<{ name: string; filename: string }>;
}> {
  const safeFandomName = validateExistingPathSegment(fandomName);
  const dataDir = deps.dataDir;
  const { adapter } = deps;
  const base = `${dataDir}/fandoms/${safeFandomName}`;

  const readDir = async (sub: string) => {
    const dir = `${base}/${sub}`;
    if (!(await adapter.exists(dir))) return [];
    const files = await adapter.listDir(dir);
    return files
      .filter((file) => file.endsWith(".md"))
      .sort()
      .map((file) => ({ name: file.replace(/\.md$/, ""), filename: file }));
  };

  return {
    characters: await readDir("core_characters"),
    worldbuilding: await readDir("core_worldbuilding"),
  };
}

export async function readFandomFile(
  deps: FandomServiceDeps,
  fandomName: string,
  category: string,
  filename: string,
): Promise<{ filename: string; category: string; content: string }> {
  const safeFandomName = validateExistingPathSegment(fandomName);
  const safeCategory = validateExistingPathSegment(category);
  const safeFilename = validateExistingPathSegment(filename);
  const dataDir = deps.dataDir;
  const { adapter } = deps;
  const content = await adapter.readFile(`${dataDir}/fandoms/${safeFandomName}/${safeCategory}/${safeFilename}`);
  return { filename, category, content };
}
