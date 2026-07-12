// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 文件操作工具函数（对应 Python infra/storage_local/file_utils.py）。
 * 原属 repositories/implementations/ —— 2026-07 架构治本上移：service 层此前
 * 为拿这些通用工具被迫 import repository *实现*层，工具放错层。
 * 纯路径工具在 ./paths.ts（此处 re-export，importer 无需区分两个模块）。
 */

import * as yaml from "js-yaml";
import type { PlatformAdapter } from "../platform/adapter.js";
import { warnAlways } from "../logger/index.js";

export { joinPath, validateBasePath, validatePathSegment } from "./paths.js";

/** 返回当前 UTC 时间的 ISO 8601 字符串。 */
export function nowUtc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** 计算正文的 SHA-256 哈希（D-0011）。 */
export async function computeContentHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 全仓统一的 YAML 落盘序列化（盲审 2026-07-11 重复维：选项字面量此前散落 10+ 处）。
 * sortKeys:false 保持字段书写顺序稳定（diff 友好）；lineWidth:-1 禁止长行折行
 * （折行会破坏 frontmatter / 长 URL 的逐字节可比性）。调整输出口径只改这里。
 */
export function dumpYaml(obj: unknown): string {
  return yaml.dump(obj, { sortKeys: false, lineWidth: -1 });
}

/** 递归将对象中的 enum 值转为字符串。用于 YAML 序列化前。 */
export function objToPlain(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean") return obj;
  if (Array.isArray(obj)) return obj.map(objToPlain);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = objToPlain(v);
    }
    return result;
  }
  return obj;
}

// ---------------------------------------------------------------------------
// 写入锁（单线程环境下串行化 async 写入，防竞态）
// ---------------------------------------------------------------------------

const _writeLocks = new Map<string, Promise<void>>();

/**
 * 对同一 key（通常是文件路径）的 async 写入串行化。
 * 保证先到的操作先执行完，后到的操作排队。
 * 锁释放后自动清理 Map 条目，防止内存泄漏。
 */
export function withWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = _writeLocks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn); // always chain, even on error
  const voidNext = next.then(
    () => {},
    () => {},
  );
  _writeLocks.set(key, voidNext);
  voidNext.then(() => {
    if (_writeLocks.get(key) === voidNext) {
      _writeLocks.delete(key);
    }
  });
  return next;
}

// ---------------------------------------------------------------------------
// JSONL helpers
// ---------------------------------------------------------------------------

/** 逐行解析 JSONL 文本。readJsonl 主文件与 .tmp 恢复共用同一解析判据。 */
function parseJsonlText<T>(text: string, parse: (d: Record<string, unknown>) => T): [T[], string[]] {
  const items: T[] = [];
  const errors: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();
    if (!stripped) continue;
    try {
      const d = JSON.parse(stripped) as Record<string, unknown>;
      items.push(parse(d));
    } catch (e) {
      errors.push(`Line ${i + 1}: ${e}`);
    }
  }
  return [items, errors];
}

/**
 * 逐行读取 JSONL 文件，返回 [解析结果, 错误日志]。
 *
 * 含遗留 .tmp 恢复（审计 H5，迁移期兜底）：旧版 atomicWrite 是「写 .tmp →
 * 二次全量写正式路径 → 删 .tmp」，二次写中途崩溃会留下「正式文件截断/缺失 +
 * .tmp 完整」。新版 atomicWrite 经 rename 原子提交后**不会再产生**这种状态
 * （成功即无 .tmp，失败则正式文件原样），此逻辑只为修复老版本崩溃留下的存量损伤：
 * 仅当主文件缺失或含坏行、且同名 .tmp 能解析出**严格更多**合法行时，才用 .tmp
 * 重建主文件。健康主文件零额外 I/O；行数不占优的 .tmp（如新版写完 .tmp 尚未
 * rename 就崩溃的「未提交写入」残留）不启用，避免复活未提交内容。
 */
export async function readJsonl<T>(
  adapter: PlatformAdapter,
  path: string,
  parse: (d: Record<string, unknown>) => T,
): Promise<[T[], string[]]> {
  const fileExists = await adapter.exists(path);
  let items: T[] = [];
  let errors: string[] = [];
  if (fileExists) {
    const text = await adapter.readFile(path);
    [items, errors] = parseJsonlText(text, parse);
  }
  if (!fileExists || errors.length > 0) {
    const recovered = await tryRecoverFromTmp(adapter, path, parse, items.length);
    if (recovered) return recovered;
    if (!fileExists) return [[], []];
  }
  return [items, errors];
}

/** readJsonl 的 .tmp 恢复分支。恢复成功返回 [items, errors]，否则 null。 */
async function tryRecoverFromTmp<T>(
  adapter: PlatformAdapter,
  path: string,
  parse: (d: Record<string, unknown>) => T,
  mainValidCount: number,
): Promise<[T[], string[]] | null> {
  const tmpPath = path + ".tmp";
  try {
    if (!(await adapter.exists(tmpPath))) return null;
    const tmpText = await adapter.readFile(tmpPath);
    const [tmpItems, tmpErrors] = parseJsonlText(tmpText, parse);
    // 严格更多合法行才恢复：等量/更少说明 .tmp 不比主文件完整（或是未提交写入），不动主文件。
    if (tmpItems.length <= mainValidCount) return null;
    warnAlways("read_jsonl", `recovering ${path} from leftover .tmp (legacy crash-truncation repair)`, {
      main_valid_lines: mainValidCount,
      tmp_valid_lines: tmpItems.length,
    });
    // atomicWrite 会重写 .tmp（同内容）后 rename 到主路径 —— 主文件修复的同时消费掉 .tmp。
    try {
      await atomicWrite(adapter, path, tmpText);
    } catch (e) {
      // 修复落盘失败仍返回更完整的数据供本次读取使用；下次读取会再尝试修复。
      warnAlways("read_jsonl", `failed to persist .tmp recovery for ${path}`, {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return [tmpItems, tmpErrors];
  } catch {
    // 恢复是 best-effort：探测/读取 .tmp 本身出错时退回主文件解析结果
    return null;
  }
}

/**
 * 原子写入辅助（审计 H5）：写 .tmp → rename 到正式路径。
 *
 * rename 是文件系统级原子替换（三端契约见 PlatformAdapter.rename），任一时刻
 * 正式路径要么是完整旧内容、要么是完整新内容 —— 不存在旧版「二次全量写正式路径」
 * 崩溃时的半截文件。写入经 `atomicWrite:` 前缀锁串行化：并发写同一路径共用同一
 * .tmp，交错会让后一个 rename 因 .tmp 已被移走而抛错；用独立前缀（而非裸 path
 * key）避免与调用方已持有的 withWriteLock(path) 重入死锁（withWriteLock 不可重入）。
 * 失败语义：.tmp 写失败或 rename 失败时正式路径不被触碰（旧内容完好），错误原样上抛；
 * .tmp 固定命名是 readJsonl 遗留恢复逻辑的依赖，不可改随机名。
 */
export function atomicWrite(adapter: PlatformAdapter, path: string, content: string): Promise<void> {
  return withWriteLock(`atomicWrite:${path}`, async () => {
    const tmpPath = path + ".tmp";
    await adapter.writeFile(tmpPath, content);
    await adapter.rename(tmpPath, path);
  });
}

/** 追加一行 JSON 到 JSONL 文件。 */
export async function appendJsonl(
  adapter: PlatformAdapter,
  path: string,
  data: Record<string, unknown>,
): Promise<void> {
  const line = JSON.stringify(data) + "\n";

  const fileExists = await adapter.exists(path);
  if (fileExists) {
    const existing = await adapter.readFile(path);
    // 确保末尾换行，防止粘连
    const prefix = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    await atomicWrite(adapter, path, existing + prefix + line);
  } else {
    // 确保目录存在
    const dir = path.substring(0, path.lastIndexOf("/"));
    if (dir) await adapter.mkdir(dir);
    await atomicWrite(adapter, path, line);
  }
}

/** 全量重写 JSONL 文件。 */
export async function rewriteJsonl(
  adapter: PlatformAdapter,
  path: string,
  items: Record<string, unknown>[],
): Promise<void> {
  const content = items.length > 0 ? items.map((item) => JSON.stringify(item)).join("\n") + "\n" : "";
  await atomicWrite(adapter, path, content);
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

const ID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomIdSuffix(): string {
  return Array.from({ length: 4 }, () => ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)]).join("");
}

/** 生成全局唯一 Fact ID：f_{unix时间戳}_{4位随机}。 */
export function generateFactId(): string {
  return `f_${Math.floor(Date.now() / 1000)}_${randomIdSuffix()}`;
}

/** 生成全局唯一操作 ID：op_{unix时间戳}_{4位随机}。 */
export function generateOpId(): string {
  return `op_${Math.floor(Date.now() / 1000)}_${randomIdSuffix()}`;
}

/** 生成全局唯一剧情线 ID：t_{unix时间戳}_{4位随机}（M8-B）。 */
export function generateThreadId(): string {
  return `t_${Math.floor(Date.now() / 1000)}_${randomIdSuffix()}`;
}
