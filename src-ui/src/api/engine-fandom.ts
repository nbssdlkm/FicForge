// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine fandom query/command layer.
 */

import { warnUi } from "../utils/ui-logger";
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
  const { fandom, state: stateRepo } = getEngine().repos;
  const dataDir = getDataDir();
  const dirNames = await fandom.list_fandoms();
  const result = [];

  for (const dirName of dirNames) {
    const fandomPath = `${dataDir}/fandoms/${dirName}`;
    const fandomInfo = await fandom.get(fandomPath).catch((e) => {
      // get 契约：缺失=null（走 ?? 兜底显示 dirName），真 fs 错误落日志不再静默吞
      warnUi("engine-fandom", `read fandom.yaml failed: ${fandomPath}`, e);
      return null;
    });
    const aus = await listAus(dirName);

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

export async function getFandomDisplayInfo(fandomPath: string): Promise<FandomDisplayInfo> {
  const { fandom } = getEngine().repos;
  const dirName = fandomPath.split("/").pop() || "";
  const fandomInfo = await fandom.get(fandomPath).catch((e) => {
    warnUi("engine-fandom", `read fandom.yaml failed: ${fandomPath}`, e);
    return null;
  });
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

    const projectInfo = await project.get(auPath).catch((e) => {
      warnUi("engine-fandom", `read project.yaml failed: ${auPath}`, e);
      return null;
    });
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
  const fandomInfo = await engine.repos.fandom.get(fandomRoot).catch((e) => {
    warnUi("engine-fandom", `read fandom.yaml failed: ${fandomRoot}`, e);
    return null;
  });
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
      // H9c：树已移入 trash，卸载其中任何仍驻留内存的 AU 向量索引 ——
      // 否则同名重建会经 ensureLoaded 跳过 load、继承已删作品的内存向量并在下次 persist 落盘固化。
      getEngine().ragManager.unloadIfCurrent(auPath);
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
    const projectInfo = await getEngine().repos.project.get(auPath).catch((e) => {
    warnUi("engine-fandom", `read project.yaml failed: ${auPath}`, e);
    return null;
  });
    const displayName = projectInfo?.name?.trim() || safeAuName;
    const entry = await getEngine().trash.move_tree_to_trash(
      fandomRoot,
      `aus/${safeAuName}`,
      "au",
      displayName,
    );
    // H9c：AU 已移入 trash，卸载其内存向量索引（不 persist —— 数据已移走）。
    // 否则同名重建的 AU 会经 ensureLoaded 跳过 load、直接继承已删作品的内存向量，
    // 且首次 indexChapter 的 persist 会把它落盘固化进新 AU。trash 恢复路径天然对称：
    // 恢复后首次 ensureLoaded 从磁盘重新 load 原 .vectors/。
    getEngine().ragManager.unloadIfCurrent(auPath);
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
