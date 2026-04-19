// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Fandom — listFandoms, createFandom, listAus, createAu,
 *   deleteFandom, deleteAu, listFandomFiles, readFandomFile,
 *   renameFandom, renameAu.
 */

import { withAuLock } from "@ficforge/engine";
import { getEngine, getDataDir } from "./engine-instance";
import { sanitizePathSegment } from "./engine-lore";

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

export async function listFandoms() {
  const { fandom } = getEngine().repos;
  const names = await fandom.list_fandoms();
  const result = [];
  for (const name of names) {
    // 复用 listAus 的过滤逻辑（排除已删除的 AU）
    const aus = await listAus(name);
    result.push({ name, dir_name: name, aus });
  }
  return result;
}

export async function createFandom(name: string) {
  const safeName = sanitizePathSegment(name);
  const dd = getDataDir();
  const e = getEngine();
  const path = `${dd}/fandoms/${safeName}`;
  if (await e.adapter.exists(`${path}/fandom.yaml`)) {
    throw new Error(`Fandom "${safeName}" already exists`);
  }
  await e.adapter.mkdir(path);
  await e.repos.fandom.save(path, { name: safeName, created_at: new Date().toISOString(), core_characters: [], wiki_source: "" });
  return { name: safeName, path };
}

export async function listAus(fandomName: string) {
  const safeFandomName = sanitizePathSegment(fandomName);
  const dd = getDataDir();
  const { fandom } = getEngine().repos;
  const { adapter } = getEngine();
  const auDirs = await fandom.list_aus(`${dd}/fandoms/${safeFandomName}`);
  // 过滤掉已删除的 AU：目录级删除后 project.yaml 不再存在；fandom 级删除仍会先 trash 各 AU 的 project.yaml。
  const validAus: string[] = [];
  for (const au of auDirs) {
    if (await adapter.exists(`${dd}/fandoms/${safeFandomName}/aus/${au}/project.yaml`)) {
      validAus.push(au);
    }
  }
  return validAus;
}

export async function createAu(fandomName: string, auName: string, fandomPath: string) {
  const safeName = sanitizePathSegment(auName);
  const { adapter } = getEngine();
  const auPath = `${fandomPath}/aus/${safeName}`;
  // 检查 AU 是否已存在
  if (await adapter.exists(`${auPath}/project.yaml`)) {
    throw new Error(`AU "${safeName}" already exists`);
  }
  await adapter.mkdir(auPath);
  // Initialize project.yaml
  const { project } = getEngine().repos;
  const { createProject } = await import("@ficforge/engine");
  const proj = createProject({ project_id: crypto.randomUUID(), au_id: auPath, name: auName, fandom: fandomName });
  await project.save(proj);
  return { name: auName, path: auPath };
}

export async function deleteFandom(fandomDirName: string) {
  const safeFandomDir = sanitizePathSegment(fandomDirName);
  const dd = getDataDir();
  const { adapter } = getEngine();
  const fandomsRoot = `${dd}/fandoms`;
  const fandomRoot = `${dd}/fandoms/${safeFandomDir}`;

  const ausDir = `${fandomRoot}/aus`;
  const auPaths = (await adapter.exists(ausDir))
    ? (await adapter.listDir(ausDir)).map((au) => `${ausDir}/${au}`)
    : [];

  // Fandom 是实体级目录删除：整棵目录进入全局 fandoms/.trash。
  // 仍按 AU 路径顺序持锁，避免和该 fandom 下任一 AU 的写操作交叉。
  return withOrderedAuLocks(auPaths, async () => {
    const entry = await getEngine().trash.move_tree_to_trash(
      fandomsRoot,
      safeFandomDir,
      "fandom",
      fandomDirName,
    );

    // 删除成功后再清理 AU 级 secure storage。
    // 若清理失败，不阻断删除主流程；恢复后用户需要重新填写密钥是可接受的。
    for (const auPath of auPaths) {
      try {
        await getEngine().repos.project.removeSecureStorage(auPath);
      } catch { /* secure 清理失败不阻断 delete 主流程 */ }
    }

    return { status: "ok", trash_id: entry.trash_id };
  });
}

export async function deleteAu(fandomDirName: string, auName: string) {
  const safeFandomDir = sanitizePathSegment(fandomDirName);
  const safeAuName = sanitizePathSegment(auName);
  const dd = getDataDir();
  // AU 是目录——在 fandom 级别的 .trash/ 创建记录（这样 Library 的 TrashPanel 能看到）
  const fandomRoot = `${dd}/fandoms/${safeFandomDir}`;
  const auPath = `${fandomRoot}/aus/${safeAuName}`;
  // AU 锁：避免和该 AU 上正在进行的任何写操作（confirm / generate / edit / extractFacts 等）
  // 交叉 —— 否则删除中途可能读到半成品，或写操作在 project.yaml 被移走后读不到配置。
  return withAuLock(auPath, async () => {
    const entry = await getEngine().trash.move_tree_to_trash(
      fandomRoot, `aus/${safeAuName}`, "au", safeAuName,
    );
    // 立即清理 AU 级 secure storage —— 避免凭据在 trash 保留期内继续驻留。
    // 详见 deleteFandom 的相同注释。
    try {
      await getEngine().repos.project.removeSecureStorage(auPath);
    } catch { /* secure 清理失败不阻断 delete 主流程 */ }
    return { status: "ok", trash_id: entry.trash_id };
  });
}

export async function listFandomFiles(fandomName: string) {
  const safeFandomName = sanitizePathSegment(fandomName);
  const dd = getDataDir();
  const { adapter } = getEngine();
  const base = `${dd}/fandoms/${safeFandomName}`;
  const readDir = async (sub: string) => {
    const dir = `${base}/${sub}`;
    if (!(await adapter.exists(dir))) return [];
    const files = await adapter.listDir(dir);
    return files.filter((f) => f.endsWith(".md")).sort().map((f) => ({ name: f.replace(/\.md$/, ""), filename: f }));
  };
  return { characters: await readDir("core_characters"), worldbuilding: await readDir("core_worldbuilding") };
}

export async function readFandomFile(fandomName: string, category: string, filename: string) {
  const safeFandomName = sanitizePathSegment(fandomName);
  const safeCategory = sanitizePathSegment(category);
  const safeFilename = sanitizePathSegment(filename);
  const dd = getDataDir();
  const { adapter } = getEngine();
  const content = await adapter.readFile(`${dd}/fandoms/${safeFandomName}/${safeCategory}/${safeFilename}`);
  return { filename, category, content };
}

export async function renameFandom(_fandomDirName: string, _newName: string) {
  // Filesystem rename not directly supported by PlatformAdapter. Requires read+write+delete.
  throw new Error("renameFandom not yet implemented in engine-client");
}

export async function renameAu(_fandomDirName: string, _auName: string, _newName: string) {
  throw new Error("renameAu not yet implemented in engine-client");
}
