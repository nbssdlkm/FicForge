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
  // 过滤掉 project.yaml 已被 trash 的 AU（deleteAu 只 trash project.yaml）
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
  const fandomRoot = `${dd}/fandoms/${safeFandomDir}`;

  // 先 trash 所有 AU 的 project.yaml（使 listAus 不再列出它们）+ 立即清理 AU 级 secure storage。
  // 立即清理原因：API key 的安全半衰期远小于 30 天 trash 保留期，延迟清理 = 扩大泄漏窗口。
  // 用户从 trash 恢复后重填 key 是可接受的（安全最佳实践）。
  //
  // AU 锁：对每个 AU 分别持锁执行删除，避免和该 AU 正在进行的 confirm / generate /
  // edit 等操作交叉（比如 confirm 刚写完 chapter.md 就被 delete 移走 project.yaml）。
  // 顺序加锁不会死锁 —— 本函数是唯一持多把 AU 锁的路径，其它 service 都只持一把。
  const ausDir = `${fandomRoot}/aus`;
  if (await adapter.exists(ausDir)) {
    const auDirs = await adapter.listDir(ausDir);
    for (const au of auDirs) {
      const auPath = `${ausDir}/${au}`;
      await withAuLock(auPath, async () => {
        try {
          await getEngine().trash.move_to_trash(fandomRoot, `aus/${au}/project.yaml`, "au", au);
        } catch { /* 可能已删或不存在 */ }
        try {
          await getEngine().repos.project.removeSecureStorage(auPath);
        } catch { /* secure 清理失败不阻断 delete 主流程 */ }
      });
    }
  }

  // 再 trash fandom.yaml（使 listFandoms 不再列出此 fandom）
  const entry = await getEngine().trash.move_to_trash(fandomRoot, "fandom.yaml", "fandom", fandomDirName);
  return { status: "ok", trash_id: entry.trash_id };
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
    const entry = await getEngine().trash.move_to_trash(
      fandomRoot, `aus/${safeAuName}/project.yaml`, "au", safeAuName,
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
