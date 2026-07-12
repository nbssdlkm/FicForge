// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 全量 AU 备份导出 / 导入（TD-015）。
 *
 * 把一个 AU 目录打包成可移植的 bundle（manifest + {相对路径: 文件内容}），用于
 * 简版 fork ↔ 主 app 的整体数据迁移。**源真相文件**（chapters / state / facts /
 * threads / ops / 章节摘要 / simple-chat / worldbuilding / project）全量带走；
 * 可由源真相重建的**派生数据**（`.vectors` RAG 索引，且与具体 embedding 模型绑定）
 * 和**临时数据**（`.drafts` 草稿）排除——导入后在主 app 侧按需重建 RAG。
 *
 * 设计为「平台无关的内容包」：用 {相对路径 → 文本内容} 的通用映射而非固定字段，
 * 这样未来 AU 目录新增文件类型也会被自动带上，无需改本模块。同一抽象也支撑
 * 「原始文件夹导入」——把散落的 AU 文件读成同样的 files 映射即可复用 importAuBundle。
 *
 * 安全：bundle 不含明文密钥。project.yaml 里的 api_key 是 `<secure>` 占位符，
 * 真正的密钥在 OS keystore（不导出），导入后为空待用户重填（见 TD-008）。
 * 导入侧另做 project.yaml 消毒（api_key 重脱敏 + api_base/chat_path 剥离，
 * 防外部构造的恶意 bundle 携带可控端点 —— 盲审 R3 HIGH-2，见 sanitizeImportedProjectYaml）。
 */

import * as yaml from "js-yaml";
import type { PlatformAdapter } from "../platform/adapter.js";
import { IndexStatus } from "../domain/enums.js";
import { joinPath, now_utc } from "../utils/file_utils.js";
import { PROJECT_YAML, STATE_YAML } from "../domain/paths.js";
import { warnAlways } from "../logger/index.js";
import { SECURE_PLACEHOLDER } from "../repositories/implementations/secure_fields.js";

export class AuBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuBundleError";
  }
}

/** bundle schema 版本（major 变更即不兼容）。 */
export const AU_BUNDLE_VERSION = "1.0.0";

/**
 * 不进 bundle 的目录名（任意层级匹配 basename）：
 * - `.vectors` RAG 索引：可由章节 + 摘要重建，且与 embedding 模型绑定，跨设备直接搬反而危险。
 * - `.drafts` 草稿：临时数据，非源真相。
 * - `.trash` 回收站：不属于 AU 内容。
 */
export const AU_BUNDLE_EXCLUDED_DIRS = [".vectors", ".drafts", ".trash"];

export interface AuBundleManifest {
  bundle_version: string;
  exported_at: string; // ISO 8601
  au_name: string;
  fandom: string;
  chapter_count: number;
  file_count: number;
  source_platform?: string;
  excluded_dirs: string[];
}

export interface AuBundle {
  manifest: AuBundleManifest;
  /** 相对 AU 根目录的路径 → 文本文件内容。 */
  files: Record<string, string>;
}

export interface CollectAuBundleOptions {
  au_name?: string;
  fandom?: string;
  source_platform?: string;
}

export interface ImportAuBundleResult {
  chapter_count: number;
  file_count: number;
  written: string[];
  skipped: string[];
}

export interface ImportAuBundleOptions {
  /** 写 state.yaml 时把 index_status 无损改成 stale（RAG 不在 bundle 内，导入侧需重建）。 */
  staleIndexStatus?: boolean;
}

/** chapters/main/chNNNN.md（正文章节；不含 .summary.jsonl）。 */
const CHAPTER_FILE_RE = /^chapters\/main\/ch\d{4}\.md$/;

/**
 * 收集一个 AU 目录的全量内容包。递归走目录（用 listDir 非空判定目录，与
 * trash_service.collectTreeFiles 同款约定，平台无 isDirectory），排除派生/临时目录。
 */
export async function collectAuBundle(
  auPath: string,
  adapter: PlatformAdapter,
  opts: CollectAuBundleOptions = {},
): Promise<AuBundle> {
  if (!auPath) throw new AuBundleError("auPath 不能为空");
  if (!(await adapter.exists(auPath))) {
    throw new AuBundleError(`AU 路径不存在: ${auPath}`);
  }

  const { entries, unreadable } = await collectFiles(auPath, adapter, "");
  if (unreadable.length > 0) {
    // 备份绝不能静默丢文件：宁可整体中止，也不产出「看着完整、实则缺章」的包。
    // 区分了「真机空目录（跳过）」与「存在但读不出的文件（致命）」，故这里只剩真问题。
    throw new AuBundleError(`以下文件无法读取，已中止备份以防数据丢失：${unreadable.join("、")}`);
  }

  const files: Record<string, string> = {};
  for (const { rel, content } of entries) {
    // project.yaml 直接走原始字节读取（没过 repository.save 的 extractSecureFields），
    // 遗留版本可能含明文 api_key —— 导出前强制脱敏，避免密钥随 bundle 外泄。
    files[rel] = rel === PROJECT_YAML ? redactSecrets(content) : content;
  }

  const chapterCount = Object.keys(files).filter((p) => CHAPTER_FILE_RE.test(p)).length;

  return {
    manifest: {
      bundle_version: AU_BUNDLE_VERSION,
      exported_at: now_utc(),
      au_name: opts.au_name ?? "",
      fandom: opts.fandom ?? "",
      chapter_count: chapterCount,
      file_count: Object.keys(files).length,
      source_platform: opts.source_platform,
      excluded_dirs: [...AU_BUNDLE_EXCLUDED_DIRS],
    },
    files,
  };
}

/**
 * 把 bundle 写入一个目标 AU 路径（应为新建/空 AU——迁移语义是「整体还原」而非合并）。
 * 不安全/被排除的相对路径会被跳过而非写入。**不**触碰 RAG：调用方导入后应将
 * state.index_status 置 STALE 并触发 rebuildForAu（RAG 不在 bundle 内）。
 */
export async function importAuBundle(
  targetAuPath: string,
  bundle: AuBundle,
  adapter: PlatformAdapter,
  opts: ImportAuBundleOptions = {},
): Promise<ImportAuBundleResult> {
  if (!targetAuPath) throw new AuBundleError("targetAuPath 不能为空");
  validateBundle(bundle);

  const written: string[] = [];
  const skipped: string[] = [];

  try {
    for (const [rel, content] of Object.entries(bundle.files)) {
      if (!isSafeRelPath(rel) || isExcludedPath(rel) || typeof content !== "string") {
        skipped.push(rel);
        continue;
      }
      // index_status 无损置 stale：行级文本替换，保留 state.yaml 其余所有键/顺序，
      // 不走 dictToState 白名单（跨程序迁移时简版可能带主 app 不认识的字段，白名单会吞掉）。
      // 判据用「OS 归一化后的 basename」（盲审 R3 HIGH-2 二次对抗审）：大小写不敏感 FS
      // 会把 `Project.yaml`、`./project.yaml`、`project.yaml `（尾空格）、`project.yaml.`
      // 都读回成仓储路径 `project.yaml`；若判据不同步归一，这些形态会绕过消毒直接落盘。
      // isSafeRelPath 已拒绝 `.`/尾空格/尾点段作第一道，这里的 canon 判据是第二道。
      const canonBase = canonicalizedBasename(rel);
      let toWrite = content;
      if (canonBase === PROJECT_YAML) {
        toWrite = sanitizeImportedProjectYaml(content);
      } else if (opts.staleIndexStatus && canonBase === STATE_YAML) {
        toWrite = forceStaleIndexStatus(content);
      }
      const dest = joinPath(targetAuPath, rel);
      const slash = dest.lastIndexOf("/");
      if (slash > 0) await adapter.mkdir(dest.substring(0, slash));
      await adapter.writeFile(dest, toWrite);
      written.push(rel);
    }
  } catch (err) {
    // 中途失败不留半成品（盲审 2026-07-09）：目标语义是新建/空 AU，部分文件已落的
    // 迷惑状态会让重试导入面对脏目标。best-effort 删除本次已写文件后原样抛出；
    // 单个删除失败不掩盖原始错误（剩余残留由用户删除目标 AU 兜底）。
    for (const rel of [...written].reverse()) {
      try {
        await adapter.deleteFile(joinPath(targetAuPath, rel));
      } catch {
        /* best-effort cleanup */
      }
    }
    warnAlways("au_bundle", "importAuBundle failed mid-way; partial files cleaned up", {
      written_before_failure: written.length,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  const chapterCount = written.filter((p) => CHAPTER_FILE_RE.test(p)).length;
  return { chapter_count: chapterCount, file_count: written.length, written, skipped };
}

/** 校验 bundle 结构 + major 版本兼容。 */
export function validateBundle(bundle: unknown): asserts bundle is AuBundle {
  if (!bundle || typeof bundle !== "object") {
    throw new AuBundleError("bundle 不是对象");
  }
  const b = bundle as Partial<AuBundle>;
  if (!b.manifest || typeof b.manifest !== "object") {
    throw new AuBundleError("bundle 缺少 manifest");
  }
  if (!b.files || typeof b.files !== "object") {
    throw new AuBundleError("bundle 缺少 files");
  }
  const ver = b.manifest.bundle_version;
  if (typeof ver !== "string" || !ver) {
    throw new AuBundleError("bundle 缺少 bundle_version");
  }
  const major = ver.split(".")[0];
  const expectedMajor = AU_BUNDLE_VERSION.split(".")[0];
  if (major !== expectedMajor) {
    throw new AuBundleError(`bundle 版本不兼容: ${ver}（当前支持 ${expectedMajor}.x）`);
  }
}

interface CollectResult {
  entries: Array<{ rel: string; content: string }>;
  /** 存在但读不出的文件（二进制 / 锁定 / 权限 / 子目录瞬时不可列）—— 备份必须报告，不能静默丢。 */
  unreadable: string[];
}

/**
 * 递归收集目录内容。平台无 isDirectory，用 listDir 行为区分目录/文件/空目录：
 * - listDir 返回非空数组 → 目录，递归。
 * - listDir 抛错（真机对文件 listDir 会抛）→ 文件：读得出→收，读不出→记 unreadable（致命）。
 * - listDir 返回空数组 → 真机的空目录，或 MockAdapter 下的文件：读得出→收（文件），
 *   读不出→空目录，静默跳过（不记 unreadable，避免把空目录误报成丢数据）。
 */
async function collectFiles(root: string, adapter: PlatformAdapter, prefix: string): Promise<CollectResult> {
  const currentPath = prefix ? joinPath(root, prefix) : root;
  let listed: string[];
  try {
    listed = await adapter.listDir(currentPath);
  } catch {
    // 走到这里说明外层已把它判定为目录，再次 listDir 失败多半瞬时故障 ——
    // 记为不可读子树而非静默丢弃整棵子树。
    return { entries: [], unreadable: [prefix || "."] };
  }

  const result: CollectResult = { entries: [], unreadable: [] };
  for (const entry of listed) {
    if (AU_BUNDLE_EXCLUDED_DIRS.includes(entry)) continue; // 任意层级排除
    const rel = prefix ? `${prefix}/${entry}` : entry;
    const candidate = joinPath(root, rel);

    let child: string[] | null = null;
    try {
      child = await adapter.listDir(candidate);
    } catch {
      child = null; // 真机：对文件 listDir 抛错
    }

    if (child && child.length > 0) {
      const sub = await collectFiles(root, adapter, rel);
      result.entries.push(...sub.entries);
      result.unreadable.push(...sub.unreadable);
      continue;
    }

    let content: string | null = null;
    try {
      content = await adapter.readFile(candidate);
    } catch {
      content = null;
    }
    if (content !== null) {
      result.entries.push({ rel, content });
    } else if (child === null || adapter.getPlatform() === "web") {
      // 读不出且确定是文件 → 报告为不可读（不能静默丢，否则备份缺章还报成功）。
      // 判「确定是文件」分两种平台语义：
      //   · 真机(tauri/capacitor)：对文件 listDir 抛错 → child===null。空目录则 child===[]，静默跳过。
      //   · web/IndexedDB(含 MockAdapter)：目录是 key 前缀派生的，**空目录不存在**于列表里，
      //     所以一个出现在父级 listDir 里、自身 listDir 又返回 [] 的条目必是文件 —— 读不出即不可读。
      // 简版 fork 正是从 web 平台导出，这条分支堵的就是「web 上静默丢文件」（全量审阅 HIGH）。
      result.unreadable.push(rel);
    }
  }
  return result;
}

/** 把 project.yaml 里所有 api_key 行的值改成 `<secure>` 占位符（行级、保留缩进），防遗留明文密钥外泄。 */
function redactSecrets(projectYaml: string): string {
  return projectYaml.replace(/^(\s*api_key:).*$/gm, `$1 ${SECURE_PLACEHOLDER}`);
}

/** 需在导入 project.yaml 里擦除的字段（小写归一比较）：密钥→占位符，端点/路径→空串。 */
const IMPORT_SECRET_KEYS = new Set(["api_key"]);
const IMPORT_ENDPOINT_KEYS = new Set(["api_base", "chat_path"]);

/** 递归擦除已解析对象里的密钥/端点字段（表示无关：flow/引号键/显式键解析后都是同名键）。 */
function scrubEndpointsDeep(node: unknown): void {
  if (Array.isArray(node)) {
    for (const el of node) scrubEndpointsDeep(el);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const k = key.toLowerCase();
    if (IMPORT_SECRET_KEYS.has(k)) {
      obj[key] = SECURE_PLACEHOLDER;
    } else if (IMPORT_ENDPOINT_KEYS.has(k)) {
      obj[key] = "";
    } else {
      scrubEndpointsDeep(obj[key]);
    }
  }
}

/**
 * 导入侧 project.yaml 消毒（盲审 R3 HIGH-2 纵深防御）：
 * - api_key 重脱敏：外部构造的 bundle 可能带明文 key，不得原样落盘。
 * - api_base / chat_path 置空：导入的 AU 不携带可控端点（防内容外泄 + 模型响应注入）。
 *   与「导入后密钥为空待用户重填」（TD-008）语义一致 —— 用户重配 key 时本就要重选服务商。
 *
 * 用 **解析→深度擦除→重序列化**（而非行级正则）：行级正则被 YAML 流式映射
 * `{api_base: x}`、引号键 `"api_base":`、显式键 `? api_base` 等表示形式全面绕过
 * （对抗审实证）。yaml.load→dump 保留所有键（非白名单，跨程序未知字段不丢），
 * 仅损失注释/顺序 —— 对结构化 project.yaml 可接受（导出器本就 yaml.dump 产出）。
 * 解析失败（无法被下游 yaml.load 消费、AU 本就打不开）时回退行级 best-effort + 告警。
 */
function sanitizeImportedProjectYaml(projectYaml: string): string {
  let doc: unknown;
  try {
    doc = yaml.load(projectYaml);
  } catch {
    warnAlways("au_bundle", "导入 project.yaml 解析失败，回退行级消毒", {});
    return redactSecrets(projectYaml)
      .replace(/^(\s*api_base:).*$/gm, `$1 ""`)
      .replace(/^(\s*chat_path:).*$/gm, `$1 ""`);
  }
  // 标量 / null / 非对象：无端点字段可注入，原样返回（保留原字节）。
  if (!doc || typeof doc !== "object") return projectYaml;
  scrubEndpointsDeep(doc);
  return yaml.dump(doc, { lineWidth: -1, noRefs: true });
}

/** 把 state.yaml 的 index_status 行无损置为 stale（保留其余键/顺序/注释）。 */
function forceStaleIndexStatus(stateYaml: string): string {
  const line = `index_status: ${IndexStatus.STALE}`;
  if (/^index_status:.*$/m.test(stateYaml)) {
    return stateYaml.replace(/^index_status:.*$/m, line);
  }
  return `${stateYaml.replace(/\s*$/, "")}\n${line}\n`;
}

/**
 * 相对路径安全：非空、无绝对前导、无 `..`/`.` 越界段，且无「OS 会归一化掉」的段
 * （前后空白 / 尾点）—— 这些段会让写入路径与仓储读取路径不对称，从而绕过 basename
 * 判据的消毒/置 stale（盲审 R3 HIGH-2 二次对抗审：`./project.yaml`、`project.yaml `）。
 */
function isSafeRelPath(rel: string): boolean {
  if (!rel || rel.startsWith("/") || rel.startsWith("\\")) return false;
  if (/^[a-zA-Z]:/.test(rel)) return false; // Windows 盘符
  return !rel.split(/[\\/]/).some(
    (seg) =>
      seg === ".." ||
      seg === "." ||
      seg === "" ||
      seg !== seg.trim() || // 前后空白（Windows 会剥离）
      /\.$/.test(seg), // 尾点（Windows 会剥离）
  );
}

/**
 * 取 rel 的「OS 归一化后 basename」用于 project.yaml / state.yaml 判据：末段 + 剥离
 * 尾部空白/点（Windows/macOS 文件系统会做同样归一）+ 小写（大小写不敏感 FS）。
 * 与 isSafeRelPath 的段级拒绝互为双保险。
 */
function canonicalizedBasename(rel: string): string {
  const base = rel.split(/[\\/]/).pop() ?? "";
  return base
    .trim()
    .replace(/[.\s]+$/, "")
    .toLowerCase();
}

/** 任意层级落在排除目录下 → 跳过（防原始文件夹导入夹带 .vectors）。 */
function isExcludedPath(rel: string): boolean {
  return rel.split(/[\\/]/).some((seg) => AU_BUNDLE_EXCLUDED_DIRS.includes(seg));
}
