// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Lore — saveLore, readLore, deleteLore, listLoreFiles,
 *   importFromFandom, getLoreContent, sanitizePathSegment.
 */

import { AU_CHARACTERS_DIR } from "@ficforge/engine";
import { getEngine } from "./engine-instance";

const SAFE_PATH_SEGMENT_PATTERN = /[^\p{L}\p{N}._ -]+/gu;

/**
 * 读取已有路径段：只校验合法性、不改写 —— 避免对磁盘已存在的历史文件名（含保留字符）做破坏性 sanitize。
 * 新建路径段应该用 `sanitizePathSegment` 走白名单清洗。
 * 导出给 engine-fandom.ts 等模块复用（单一真相源）。
 */
export function validateExistingPathSegment(segment: string): string {
  if (!segment) throw new Error("Path segment cannot be empty");
  const validated = segment.replace(/[\x00-\x1f\x7f]/g, "").trim();
  if (!validated) throw new Error("Invalid path segment");
  if (/[\/\\]/.test(validated)) throw new Error("Invalid path segment");
  if (validated === "." || validated === "..") throw new Error("Invalid path segment");
  return validated;
}

/** Sanitize newly created path segments to a filesystem/WebDAV-safe whitelist. */
export function sanitizePathSegment(segment: string): string {
  if (!segment) throw new Error("Path segment cannot be empty");
  const sanitized = segment
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(SAFE_PATH_SEGMENT_PATTERN, "_")
    .replace(/\.\.+/g, "_")
    .replace(/^\.+/, "")
    .replace(/[. ]+$/g, "")
    .trim()
    .replace(/_+/g, "_");
  if (!sanitized) throw new Error("Invalid path segment");
  return sanitized;
}

export async function saveLore(req: {
  au_path?: string;
  fandom_path?: string;
  category: string;
  filename: string;
  content: string;
}) {
  const { adapter } = getEngine();
  const basePath = req.au_path ?? req.fandom_path ?? "";
  const safeCategory = sanitizePathSegment(req.category);
  const safeFilename = sanitizePathSegment(req.filename);
  const filePath = `${basePath}/${safeCategory}/${safeFilename}`;
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  await adapter.mkdir(dir);
  await adapter.writeFile(filePath, req.content);
  // 角色卡内容变更（含别名编辑）→ 失效该 AU 的别名归一化表缓存（内容改动不改文件名，
  // 签名兜底兜不住，必须在此写入收口显式失效）。
  if (req.au_path && safeCategory === AU_CHARACTERS_DIR) {
    getEngine().characterAliases.invalidate(req.au_path);
  }
  // M28：回传实际落盘的 filename / category（已过 sanitizePathSegment 白名单清洗）。
  // 调用方传进来的 filename 若含被清洗字符（如全角标点），磁盘名 ≠ 传入名 —— 后续
  // undo/modify/read 用传入名找不到文件。用返回值回填 undoMeta 才能闭环。
  return { status: "ok", path: filePath, filename: safeFilename, category: safeCategory };
}

export async function readLore(req: { au_path?: string; fandom_path?: string; category: string; filename: string }) {
  const { adapter } = getEngine();
  const basePath = req.au_path ?? req.fandom_path ?? "";
  const category = validateExistingPathSegment(req.category);
  const filename = validateExistingPathSegment(req.filename);
  const filePath = `${basePath}/${category}/${filename}`;
  const content = await adapter.readFile(filePath);
  return { content };
}

/**
 * 读旧 lore 内容，含 legacy 文件名回退（F9）。单一真相源，供 modify_* 各路径复用
 * （useSimpleToolExecutor / SettingsChatPanel）。
 *
 * modify_* 写盘统一落 `diskName`（sanitizePathSegment 白名单清洗名），但早期未清洗即落盘的
 * 含全角标点文件其磁盘真名 = `legacyName`（validateExistingPathSegment 允许保留、saveLore
 * 之前的历史遗留）。先按 diskName 读，miss 时用 legacyName 再读一次（readLore 内部走
 * validateExistingPathSegment，允许 legacy 名）；读到则返回内容供 preserveManagedFrontmatter
 * 守护受管字段。两者都 miss（真·新建 / race）返回 null。diskName === legacyName 时不重复读盘。
 *
 * base 参数二选一（au_path / fandom_path），与 readLore 同款。
 */
export async function readLoreWithLegacyFallback(req: {
  au_path?: string;
  fandom_path?: string;
  category: string;
  diskFilename: string;
  legacyFilename: string;
}): Promise<string | null> {
  const base = req.au_path !== undefined ? { au_path: req.au_path } : { fandom_path: req.fandom_path ?? "" };
  try {
    const { content } = await readLore({ ...base, category: req.category, filename: req.diskFilename });
    return content;
  } catch {
    // diskFilename miss
  }
  if (req.legacyFilename && req.legacyFilename !== req.diskFilename) {
    try {
      const { content } = await readLore({ ...base, category: req.category, filename: req.legacyFilename });
      return content;
    } catch {
      // legacy 名也 miss
    }
  }
  return null;
}

export async function deleteLore(req: { au_path?: string; fandom_path?: string; category: string; filename: string }) {
  const basePath = req.au_path ?? req.fandom_path ?? "";
  const category = validateExistingPathSegment(req.category);
  const filename = validateExistingPathSegment(req.filename);
  const relativePath = `${category}/${filename}`;
  const entry = await getEngine().trash.move_to_trash(basePath, relativePath, "lore_file", req.filename);
  if (req.au_path && category === AU_CHARACTERS_DIR) {
    getEngine().characterAliases.invalidate(req.au_path);
  }
  return { status: "ok", trash_id: entry.trash_id, deleted: relativePath };
}

export async function listLoreFiles(params: { category: string; au_path?: string; fandom_path?: string }) {
  const { adapter } = getEngine();
  const basePath = params.au_path ?? params.fandom_path ?? "";
  const category = validateExistingPathSegment(params.category);
  const dirPath = `${basePath}/${category}`;
  const exists = await adapter.exists(dirPath);
  if (!exists) return { files: [] };
  const files = await adapter.listDir(dirPath);
  return {
    files: files
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((f) => ({
        name: f.replace(/\.md$/, ""),
        filename: f,
      })),
  };
}

export async function importFromFandom(req: {
  fandom_path: string;
  au_path: string;
  filenames: string[];
  source_category?: string;
}) {
  const { adapter } = getEngine();
  const imported: Array<{ from: string; to: string }> = [];
  const skipped: string[] = [];
  const srcCat = validateExistingPathSegment(req.source_category ?? "core_characters");
  const destCat = srcCat === "core_characters" ? AU_CHARACTERS_DIR : "worldbuilding";

  for (const filename of req.filenames) {
    const sourceFilename = validateExistingPathSegment(filename);
    const destFilename = sanitizePathSegment(filename);
    const srcPath = `${req.fandom_path}/${srcCat}/${sourceFilename}`;
    const destPath = `${req.au_path}/${destCat}/${destFilename}`;

    if (await adapter.exists(destPath)) {
      skipped.push(filename);
      continue;
    }

    try {
      const content = await adapter.readFile(srcPath);
      const dir = destPath.substring(0, destPath.lastIndexOf("/"));
      await adapter.mkdir(dir);
      await adapter.writeFile(destPath, content);
      imported.push({ from: sourceFilename, to: destFilename });
    } catch {
      skipped.push(filename);
    }
  }

  if (imported.length > 0 && destCat === AU_CHARACTERS_DIR) {
    getEngine().characterAliases.invalidate(req.au_path);
  }
  return { status: "ok", imported: imported.map(({ from }) => from), skipped };
}

export async function getLoreContent(params: {
  category: string;
  filename: string;
  au_path?: string;
  fandom_path?: string;
}) {
  return readLore(params);
}
