// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine fandom query/command layer.
 */

import { withAuLock } from "@ficforge/engine";
import { getDataDir, getEngine } from "./engine-instance";
import { sanitizePathSegment, validateExistingPathSegment } from "./engine-lore";
import type { AuInfo, FandomDisplayInfo } from "./fandoms";

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
  const dataDir = getDataDir();
  const dirNames = await fandom.list_fandoms();
  const result = [];

  for (const dirName of dirNames) {
    const fandomPath = `${dataDir}/fandoms/${dirName}`;
    const fandomInfo = await fandom.get(fandomPath).catch(() => null);
    const aus = await listAus(dirName);
    result.push({
      name: fandomInfo?.name?.trim() || dirName,
      dir_name: dirName,
      aus,
    });
  }

  return result;
}

export async function getFandomDisplayInfo(fandomPath: string): Promise<FandomDisplayInfo> {
  const { fandom } = getEngine().repos;
  const dirName = fandomPath.split("/").pop() || "";
  const fandomInfo = await fandom.get(fandomPath).catch(() => null);
  return {
    name: fandomInfo?.name?.trim() || dirName,
    dir_name: dirName,
    path: fandomPath,
  };
}

export async function createFandom(name: string) {
  const safeName = sanitizePathSegment(name);
  const dataDir = getDataDir();
  const engine = getEngine();
  const path = `${dataDir}/fandoms/${safeName}`;

  if (await engine.adapter.exists(`${path}/fandom.yaml`)) {
    throw new Error(`Fandom "${safeName}" already exists`);
  }

  await engine.adapter.mkdir(path);
  await engine.repos.fandom.save(path, {
    name,
    created_at: new Date().toISOString(),
    core_characters: [],
    wiki_source: "",
  });

  return { name, dir_name: safeName, path };
}

export async function listAus(fandomDirName: string): Promise<AuInfo[]> {
  const safeFandomDir = validateExistingPathSegment(fandomDirName);
  const dataDir = getDataDir();
  const { fandom, project } = getEngine().repos;
  const { adapter } = getEngine();
  const auDirs = await fandom.list_aus(`${dataDir}/fandoms/${safeFandomDir}`);
  const validAus: AuInfo[] = [];

  for (const dirName of auDirs) {
    const auPath = `${dataDir}/fandoms/${safeFandomDir}/aus/${dirName}`;
    if (!(await adapter.exists(`${auPath}/project.yaml`))) {
      continue;
    }

    const projectInfo = await project.get(auPath).catch(() => null);
    validAus.push({
      name: projectInfo?.name?.trim() || dirName,
      dir_name: dirName,
    });
  }

  return validAus;
}

export async function createAu(fandomName: string, auName: string, fandomPath: string) {
  const safeName = sanitizePathSegment(auName);
  const { adapter } = getEngine();
  const auPath = `${fandomPath}/aus/${safeName}`;

  if (await adapter.exists(`${auPath}/project.yaml`)) {
    throw new Error(`AU "${safeName}" already exists`);
  }

  await adapter.mkdir(auPath);
  const { project } = getEngine().repos;
  const { createProject } = await import("@ficforge/engine");
  const proj = createProject({
    project_id: crypto.randomUUID(),
    au_id: auPath,
    name: auName,
    fandom: fandomName,
  });
  await project.save(proj);

  return { name: auName, dir_name: safeName, path: auPath };
}

export async function deleteFandom(fandomDirName: string) {
  const safeFandomDir = validateExistingPathSegment(fandomDirName);
  const dataDir = getDataDir();
  const engine = getEngine();
  const { adapter } = engine;
  const fandomsRoot = `${dataDir}/fandoms`;
  const fandomRoot = `${dataDir}/fandoms/${safeFandomDir}`;
  const fandomInfo = await engine.repos.fandom.get(fandomRoot).catch(() => null);
  const displayName = fandomInfo?.name?.trim() || safeFandomDir;

  const ausDir = `${fandomRoot}/aus`;
  const auPaths = (await adapter.exists(ausDir))
    ? (await adapter.listDir(ausDir)).map((au) => `${ausDir}/${au}`)
    : [];

  return withOrderedAuLocks(auPaths, async () => {
    const entry = await getEngine().trash.move_tree_to_trash(
      fandomsRoot,
      safeFandomDir,
      "fandom",
      displayName,
    );

    for (const auPath of auPaths) {
      try {
        await getEngine().repos.project.removeSecureStorage(auPath);
      } catch {
        // Best effort cleanup for per-AU secrets.
      }
    }

    return { status: "ok", trash_id: entry.trash_id };
  });
}

export async function deleteAu(fandomDirName: string, auName: string) {
  const safeFandomDir = validateExistingPathSegment(fandomDirName);
  const safeAuName = validateExistingPathSegment(auName);
  const dataDir = getDataDir();
  const fandomRoot = `${dataDir}/fandoms/${safeFandomDir}`;
  const auPath = `${fandomRoot}/aus/${safeAuName}`;

  return withAuLock(auPath, async () => {
    const projectInfo = await getEngine().repos.project.get(auPath).catch(() => null);
    const displayName = projectInfo?.name?.trim() || safeAuName;
    const entry = await getEngine().trash.move_tree_to_trash(
      fandomRoot,
      `aus/${safeAuName}`,
      "au",
      displayName,
    );
    try {
      await getEngine().repos.project.removeSecureStorage(auPath);
    } catch {
      // Best effort cleanup for per-AU secrets.
    }
    return { status: "ok", trash_id: entry.trash_id };
  });
}

export async function listFandomFiles(fandomName: string) {
  const safeFandomName = validateExistingPathSegment(fandomName);
  const dataDir = getDataDir();
  const { adapter } = getEngine();
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

export async function readFandomFile(fandomName: string, category: string, filename: string) {
  const safeFandomName = validateExistingPathSegment(fandomName);
  const safeCategory = validateExistingPathSegment(category);
  const safeFilename = validateExistingPathSegment(filename);
  const dataDir = getDataDir();
  const { adapter } = getEngine();
  const content = await adapter.readFile(`${dataDir}/fandoms/${safeFandomName}/${safeCategory}/${safeFilename}`);
  return { filename, category, content };
}

export async function renameFandom(_fandomDirName: string, _newName: string) {
  throw new Error("renameFandom not yet implemented in engine-client");
}

export async function renameAu(_fandomDirName: string, _auName: string, _newName: string) {
  throw new Error("renameAu not yet implemented in engine-client");
}
