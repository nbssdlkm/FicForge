// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Lore — saveLore, readLore, deleteLore, listLoreFiles,
 *   importFromFandom, getLoreContent, sanitizePathSegment.
 */

import { getEngine } from "./engine-instance";

/** 防止路径穿越：去除 / \ .. 和开头的点，拒绝空段 */
export function sanitizePathSegment(segment: string): string {
  if (!segment) throw new Error("Path segment cannot be empty");
  const sanitized = segment
    .replace(/[\x00-\x1f\x7f]/g, "")   // 去除 NUL 和控制字符
    .replace(/[\/\\]/g, "")
    .replace(/\.\./g, "")
    .replace(/^\.+/, "")
    .trim();
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
  const safeCategory = sanitizePathSegment(req.category);
  const safeFilename = sanitizePathSegment(req.filename);
  const filePath = `${basePath}/${safeCategory}/${safeFilename}`;
  const content = await adapter.readFile(filePath);
  return { content };
}

export async function deleteLore(req: { au_path?: string; fandom_path?: string; category: string; filename: string }) {
  const basePath = req.au_path ?? req.fandom_path ?? "";
  const safeCategory = sanitizePathSegment(req.category);
  const safeFilename = sanitizePathSegment(req.filename);
  const relativePath = `${safeCategory}/${safeFilename}`;
  const entry = await getEngine().trash.move_to_trash(basePath, relativePath, "lore_file", req.filename);
  return { status: "ok", trash_id: entry.trash_id, deleted: relativePath };
}

export async function listLoreFiles(params: { category: string; au_path?: string; fandom_path?: string }) {
  const { adapter } = getEngine();
  const basePath = params.au_path ?? params.fandom_path ?? "";
  const safeCategory = sanitizePathSegment(params.category);
  const dirPath = `${basePath}/${safeCategory}`;
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
  const imported: string[] = [];
  const skipped: string[] = [];
  const srcCat = sanitizePathSegment(req.source_category ?? "core_characters");

  for (const filename of req.filenames) {
    const safeFilename = sanitizePathSegment(filename);
    const srcPath = `${req.fandom_path}/${srcCat}/${safeFilename}`;
    const destCat = srcCat === "core_characters" ? "characters" : "worldbuilding";
    const destPath = `${req.au_path}/${destCat}/${safeFilename}`;

    if (await adapter.exists(destPath)) {
      skipped.push(filename);
      continue;
    }

    try {
      const content = await adapter.readFile(srcPath);
      const dir = destPath.substring(0, destPath.lastIndexOf("/"));
      await adapter.mkdir(dir);
      await adapter.writeFile(destPath, content);
      imported.push(filename);
    } catch {
      skipped.push(filename);
    }
  }

  return { status: "ok", imported, skipped };
}

export async function getLoreContent(params: { category: string; filename: string; au_path?: string; fandom_path?: string }) {
  return readLore(params);
}
