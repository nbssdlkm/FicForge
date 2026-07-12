// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Lore（角色卡 / 世界观资料）文件 CRUD —— 引擎层单一实现。
 *
 * R4 架构维 HIGH 治本（E3）：此前整套逻辑（手拼存储路径 + 路径安全白名单 + 目录布局
 * + 别名表失效收口）住在 UI api 层直连 PlatformAdapter，引擎 12 个实体有 repo 唯独
 * lore 没有。下沉后 UI api 只做薄转发；存储布局与安全判据回归引擎，三端一致性由
 * 引擎契约保证，别名缓存失效在引擎内收口（未来任何新消费者不可能忘记失效）。
 *
 * 行为口径：与原 UI 实现逐字节等价迁移（E3 纪律 = 纯搬家）；写路径仍为 adapter.writeFile
 * 直写，收编 atomicWrite 与 import_pipeline 一起在 E5 做（单独批次单独审）。
 */

import type { PlatformAdapter } from "../platform/adapter.js";
import { AU_CHARACTERS_DIR } from "../domain/character_card.js";
import { sanitizePathSegment, validateExistingPathSegment } from "../utils/paths.js";

/** 依赖注入面（结构兼容 UI EngineInstance 的子集；测试可用最小 mock 满足）。 */
export interface LoreServiceDeps {
  adapter: PlatformAdapter;
  trash: {
    move_to_trash(
      scope_root: string,
      relative_path: string,
      entry_type: string,
      display_name: string,
    ): Promise<{ trash_id: string }>;
  };
  characterAliases: { invalidate(auPath: string): void };
}

export interface LoreFileRef {
  au_path?: string;
  fandom_path?: string;
  category: string;
  filename: string;
}

export async function saveLore(
  deps: LoreServiceDeps,
  req: LoreFileRef & { content: string },
): Promise<{ status: "ok"; path: string; filename: string; category: string }> {
  const { adapter } = deps;
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
    deps.characterAliases.invalidate(req.au_path);
  }
  // M28：回传实际落盘的 filename / category（已过 sanitizePathSegment 白名单清洗）。
  // 调用方传进来的 filename 若含被清洗字符（如全角标点），磁盘名 ≠ 传入名 —— 后续
  // undo/modify/read 用传入名找不到文件。用返回值回填 undoMeta 才能闭环。
  return { status: "ok", path: filePath, filename: safeFilename, category: safeCategory };
}

export async function readLore(deps: LoreServiceDeps, req: LoreFileRef): Promise<{ content: string }> {
  const { adapter } = deps;
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
export async function readLoreWithLegacyFallback(
  deps: LoreServiceDeps,
  req: {
    au_path?: string;
    fandom_path?: string;
    category: string;
    diskFilename: string;
    legacyFilename: string;
  },
): Promise<string | null> {
  const base = req.au_path !== undefined ? { au_path: req.au_path } : { fandom_path: req.fandom_path ?? "" };
  try {
    const { content } = await readLore(deps, { ...base, category: req.category, filename: req.diskFilename });
    return content;
  } catch {
    // diskFilename miss
  }
  if (req.legacyFilename && req.legacyFilename !== req.diskFilename) {
    try {
      const { content } = await readLore(deps, { ...base, category: req.category, filename: req.legacyFilename });
      return content;
    } catch {
      // legacy 名也 miss
    }
  }
  return null;
}

export async function deleteLore(
  deps: LoreServiceDeps,
  req: LoreFileRef,
): Promise<{ status: "ok"; trash_id: string; deleted: string }> {
  const basePath = req.au_path ?? req.fandom_path ?? "";
  const category = validateExistingPathSegment(req.category);
  const filename = validateExistingPathSegment(req.filename);
  const relativePath = `${category}/${filename}`;
  const entry = await deps.trash.move_to_trash(basePath, relativePath, "lore_file", req.filename);
  if (req.au_path && category === AU_CHARACTERS_DIR) {
    deps.characterAliases.invalidate(req.au_path);
  }
  return { status: "ok", trash_id: entry.trash_id, deleted: relativePath };
}

export async function listLoreFiles(
  deps: LoreServiceDeps,
  params: { category: string; au_path?: string; fandom_path?: string },
): Promise<{ files: Array<{ name: string; filename: string }> }> {
  const { adapter } = deps;
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

export async function importLoreFromFandom(
  deps: LoreServiceDeps,
  req: {
    fandom_path: string;
    au_path: string;
    filenames: string[];
    source_category?: string;
  },
): Promise<{ status: "ok"; imported: string[]; skipped: string[] }> {
  const { adapter } = deps;
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
    deps.characterAliases.invalidate(req.au_path);
  }
  return { status: "ok", imported: imported.map(({ from }) => from), skipped };
}
