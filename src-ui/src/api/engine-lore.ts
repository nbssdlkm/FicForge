// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Lore — saveLore, readLore, deleteLore, listLoreFiles,
 *   importFromFandom, getLoreContent, sanitizePathSegment.
 */

import { getEngine } from "./engine-instance";

const SAFE_PATH_SEGMENT_PATTERN = /[^\p{L}\p{N}._ -]+/gu;

/**
 * 读取已有路径段：只校验合法性、不改写 —— 避免对磁盘已存在的历史文件名（含保留字符）做破坏性 sanitize。
 * 新建路径段应该用 `sanitizePathSegment` 走白名单清洗。
 * 导出给 engine-fandom.ts 等模块复用（单一真相源）。
 */
export function validateExistingPathSegment(segment: string): string {
  if (!segment) throw new Error("Path segment cannot be empty");
  const validated = segment
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim();
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

export async function saveLore(req: { au_path?: string; fandom_path?: string; category: string; filename: string; content: string }) {
  const { adapter } = getEngine();
  const basePath = req.au_path ?? req.fandom_path ?? "";
  const safeCategory = sanitizePathSegment(req.category);
  const safeFilename = sanitizePathSegment(req.filename);
  const filePath = `${basePath}/${safeCategory}/${safeFilename}`;
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  await adapter.mkdir(dir);
  await adapter.writeFile(filePath, req.content);
  return { status: "ok", path: filePath };
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

export async function deleteLore(req: { au_path?: string; fandom_path?: string; category: string; filename: string }) {
  const basePath = req.au_path ?? req.fandom_path ?? "";
  const category = validateExistingPathSegment(req.category);
  const filename = validateExistingPathSegment(req.filename);
  const relativePath = `${category}/${filename}`;
  const entry = await getEngine().trash.move_to_trash(basePath, relativePath, "lore_file", req.filename);
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
    files: files.filter((f) => f.endsWith(".md")).sort().map((f) => ({
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

  for (const filename of req.filenames) {
    const sourceFilename = validateExistingPathSegment(filename);
    const destFilename = sanitizePathSegment(filename);
    const srcPath = `${req.fandom_path}/${srcCat}/${sourceFilename}`;
    const destCat = srcCat === "core_characters" ? "characters" : "worldbuilding";
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

  return { status: "ok", imported: imported.map(({ from }) => from), skipped };
}

export async function getLoreContent(params: { category: string; filename: string; au_path?: string; fandom_path?: string }) {
  return readLore(params);
}
