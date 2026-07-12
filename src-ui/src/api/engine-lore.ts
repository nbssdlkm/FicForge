// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Lore — UI 薄转发层。
 *
 * R4 架构维 HIGH 治本（E3）：CRUD 实现、存储布局、路径安全白名单、别名表失效收口
 * 已全部下沉引擎 services/lore_service.ts（deps 注入 EngineInstance 结构子集）。
 * 本文件只做 getEngine() 绑定 + 既有导出名兼容（含 sanitizePathSegment 等的 re-export，
 * execute-settings-tool / useSimpleToolExecutor / form-mappers 消费点零改动）。
 */

import {
  deleteLore as engineDeleteLore,
  importLoreFromFandom as engineImportLoreFromFandom,
  listLoreFiles as engineListLoreFiles,
  readLore as engineReadLore,
  readLoreWithLegacyFallback as engineReadLoreWithLegacyFallback,
  saveLore as engineSaveLore,
  sanitizePathSegment,
  validateExistingPathSegment,
} from "@ficforge/engine";
import { getEngine } from "./engine-instance";

export { sanitizePathSegment, validateExistingPathSegment };

export async function saveLore(req: {
  au_path?: string;
  fandom_path?: string;
  category: string;
  filename: string;
  content: string;
}) {
  return engineSaveLore(getEngine(), req);
}

export async function readLore(req: { au_path?: string; fandom_path?: string; category: string; filename: string }) {
  return engineReadLore(getEngine(), req);
}

/** 读旧 lore 内容，含 legacy 文件名回退（F9）——实现见引擎 lore_service。 */
export async function readLoreWithLegacyFallback(req: {
  au_path?: string;
  fandom_path?: string;
  category: string;
  diskFilename: string;
  legacyFilename: string;
}): Promise<string | null> {
  return engineReadLoreWithLegacyFallback(getEngine(), req);
}

export async function deleteLore(req: { au_path?: string; fandom_path?: string; category: string; filename: string }) {
  return engineDeleteLore(getEngine(), req);
}

export async function listLoreFiles(params: { category: string; au_path?: string; fandom_path?: string }) {
  return engineListLoreFiles(getEngine(), params);
}

export async function importFromFandom(req: {
  fandom_path: string;
  au_path: string;
  filenames: string[];
  source_category?: string;
}) {
  return engineImportLoreFromFandom(getEngine(), req);
}

export async function getLoreContent(params: {
  category: string;
  filename: string;
  au_path?: string;
  fandom_path?: string;
}) {
  return readLore(params);
}
