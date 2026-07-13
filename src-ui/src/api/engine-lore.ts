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
  AU_CHARACTERS_DIR,
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
import { rescanChunkCharacterTags } from "./engine-state";

export { sanitizePathSegment, validateExistingPathSegment };

/**
 * TD-020：AU 角色卡变更（增/删/改/导入）后 fire-and-forget 重扫 chunk 角色标签——
 * 用户改完别名，检索的 char_filter 立即认新表（免嵌，纯本地）。引擎 lore_service
 * 已在这些写路径失效别名缓存，此处只负责把新表推进向量 metadata；失败不冒泡。
 */
function rescanAfterCharacterCardChange(req: { au_path?: string; category?: string }): void {
  if (req.au_path && req.category === AU_CHARACTERS_DIR) void rescanChunkCharacterTags(req.au_path);
}

export async function saveLore(req: {
  au_path?: string;
  fandom_path?: string;
  category: string;
  filename: string;
  content: string;
}) {
  const result = await engineSaveLore(getEngine(), req);
  rescanAfterCharacterCardChange(req);
  return result;
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
  const result = await engineDeleteLore(getEngine(), req);
  rescanAfterCharacterCardChange(req);
  return result;
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
  const result = await engineImportLoreFromFandom(getEngine(), req);
  // 引擎侧 importFromFandom 会失效别名缓存（E8 收口点），此处恒重扫——非角色卡导入时
  // 表未变、重算得同标签、changed=0 不落盘，幂等无害。
  rescanAfterCharacterCardChange({ au_path: req.au_path, category: AU_CHARACTERS_DIR });
  return result;
}

export async function getLoreContent(params: {
  category: string;
  filename: string;
  au_path?: string;
  fandom_path?: string;
}) {
  return readLore(params);
}
