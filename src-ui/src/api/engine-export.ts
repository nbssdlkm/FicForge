// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Export — exportChapters, importChaptersFromText, 全量 AU 备份（TD-015）。
 */

import {
  AU_BUNDLE_VERSION,
  AU_BUNDLE_EXCLUDED_DIRS,
  collectAuBundle,
  exportChapters as engineExportChapters,
  importAuBundle,
  parseChapterMainPath,
  validateBundle,
  type AuBundle,
} from "@ficforge/engine";
import { getEngine, getProjectOrThrow } from "./engine-instance";
import { createAu } from "./engine-fandoms";
import { swallowToNull } from "../utils/ui-logger";

/** 正文章节判据（不含 .summary.jsonl）：引擎 domain/paths.parseChapterMainPath 单一真相源。 */
const isChapterFile = (p: string): boolean => parseChapterMainPath(p) !== null;

/**
 * 导出文件名消毒的单一判据（R3 低危清扫：此前正文导出与 bundle 导出各写一份同字面量黑名单）。
 * 与引擎 sanitizePathSegment（新建路径段白名单）语义不同：这里只针对「下载文件名」，
 * 剔 OS 保留字符即可，不收紧到白名单——导出名要尽量保留用户的作品名原貌。
 */
const sanitizeExportFilename = (name: string): string => name.replace(/[<>:"/\\|?*]/g, "_");

export async function exportChapters(params: {
  au_path: string;
  format?: string;
  start_chapter?: number;
  end_chapter?: number;
  include_title?: boolean;
}) {
  const { chapter, state } = getEngine().repos;
  const [st, proj] = await Promise.all([state.get(params.au_path), getProjectOrThrow(params.au_path)]);
  const text = await engineExportChapters({
    au_id: params.au_path,
    chapter_repo: chapter,
    format: (params.format ?? "txt") as "txt" | "md",
    start_chapter: params.start_chapter,
    end_chapter: params.end_chapter,
    chapter_titles: st.chapter_titles,
  });
  const blob = new Blob([text], { type: "text/plain" });
  const ext = params.format ?? "txt";
  const safeName = sanitizeExportFilename(proj.name || "export");
  const filename = `${safeName}.${ext}`;
  return { blob, filename };
}

// ============================================================
// TD-015：全量 AU 备份导出 / 导入（简版 fork ↔ 主 app 数据迁移）
// ============================================================

const BUNDLE_EXT = ".ffbundle.json";

/** 导出整个 AU 为可移植备份文件（含进度/事实/线索/聊天/章节，RAG 除外，导入侧重建）。 */
export async function exportAuBundle(auPath: string): Promise<{ blob: Blob; filename: string }> {
  const { adapter, repos } = getEngine();
  const proj = await repos.project
    .get(auPath)
    .catch(swallowToNull("engine-export", "load project for bundle export failed"));
  const auName = proj?.name?.trim() || auPath.split("/").pop() || "au";
  const bundle = await collectAuBundle(auPath, adapter, {
    au_name: auName,
    fandom: proj?.fandom ?? "",
    source_platform: adapter.getPlatform(),
  });
  const blob = new Blob([JSON.stringify(bundle)], { type: "application/json" });
  const safeName = sanitizeExportFilename(auName);
  // 带时间戳，避免在 Capacitor Documents 回退路径上同名覆盖掉上一次备份（备份就是要冗余）。
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  return { blob, filename: `${safeName}-${stamp}${BUNDLE_EXT}` };
}

/** 解析 + 校验一个备份文件文本（坏 JSON / 不兼容版本会抛错）。 */
export function parseAuBundle(text: string): AuBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("不是有效的备份文件（JSON 解析失败）");
  }
  validateBundle(parsed); // 抛 AuBundleError（结构/major 版本不符）
  return parsed as AuBundle;
}

/**
 * 原始文件夹导入：把散落的 AU 文件（relpath 已相对 AU 根）合成一个 bundle，
 * 复用 restoreAuBundle 走同一条还原路径。用于用户能直接拿到简版 AU 目录文件的场景。
 */
export function bundleFromRawFiles(
  files: Array<{ relpath: string; content: string }>,
  meta: { au_name?: string; fandom?: string } = {},
): AuBundle {
  const map: Record<string, string> = {};
  for (const f of files) {
    // 归一化：反斜杠→正斜杠，丢掉空段与 "." 段（如 "./"），但**保留**带点目录名
    // （.vectors / .well-known）—— 不能用 /^[./]+/ 那种贪婪剥前缀，否则会把
    // ".well-known/simple-chat.yaml" 误剥成 "well-known/..."，把聊天记录搬丢。
    const rel = f.relpath
      .replace(/\\/g, "/")
      .split("/")
      .filter((seg) => seg !== "" && seg !== ".")
      .join("/");
    if (!rel) continue;
    // 原始文件夹常夹带 .vectors/.drafts —— 在这里就剔除，让 manifest 计数与实际写入一致（不虚高）。
    if (rel.split("/").some((seg) => AU_BUNDLE_EXCLUDED_DIRS.includes(seg))) continue;
    map[rel] = f.content;
  }
  const chapterCount = Object.keys(map).filter(isChapterFile).length;
  return {
    manifest: {
      bundle_version: AU_BUNDLE_VERSION,
      exported_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
      au_name: meta.au_name ?? "",
      fandom: meta.fandom ?? "",
      chapter_count: chapterCount,
      file_count: Object.keys(map).length,
      excluded_dirs: [],
    },
    files: map,
  };
}

export interface RestoreAuBundleResult {
  auPath: string;
  dirName: string;
  chapterCount: number;
  fileCount: number;
  /** 被跳过未写入的相对路径（不安全/排除/非字符串）——调用方应在非空时告警而非报成功。 */
  skipped: string[];
}

/**
 * 把备份还原成一个**新建** AU。createAu 先写默认 project.yaml/state.yaml，随后 bundle
 * 覆盖；index_status 在写 state.yaml 时无损置 STALE（RAG 不在 bundle 内，导入侧重建）。
 * 导入**中途失败会回滚**：把半张 AU 移入回收站，避免「缺章的半成品冒充完整」+ 让同名重试可行。
 */
export async function restoreAuBundle(
  fandomName: string,
  fandomPath: string,
  newAuName: string,
  bundle: AuBundle,
): Promise<RestoreAuBundleResult> {
  validateBundle(bundle);
  const created = await createAu(fandomName, newAuName, fandomPath);
  const { adapter } = getEngine();
  try {
    const result = await importAuBundle(created.path, bundle, adapter, { staleIndexStatus: true });
    return {
      auPath: created.path,
      dirName: created.dir_name,
      chapterCount: result.chapter_count,
      fileCount: result.file_count,
      skipped: result.skipped,
    };
  } catch (err) {
    // 回滚：createAu 已落 project.yaml，半张 AU 会在 Library 里像正常文却缺数据。
    try {
      await getEngine().trash.move_tree_to_trash(fandomPath, `aus/${created.dir_name}`, "au", newAuName);
    } catch {
      // 回滚 best-effort；原始导入错误更重要，继续抛出。
    }
    throw err;
  }
}
