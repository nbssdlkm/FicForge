// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** 文件操作工具函数（对应 Python infra/storage_local/file_utils.py）。 */

import type { PlatformAdapter } from "../../platform/adapter.js";

/** 返回当前 UTC 时间的 ISO 8601 字符串。 */
export function now_utc(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** 计算正文的 SHA-256 哈希（D-0011）。 */
export async function compute_content_hash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 递归将对象中的 enum 值转为字符串。用于 YAML 序列化前。 */
export function obj_to_plain(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean") return obj;
  if (Array.isArray(obj)) return obj.map(obj_to_plain);
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      result[k] = obj_to_plain(v);
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
 */
export function withWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = _writeLocks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn); // always chain, even on error
  _writeLocks.set(key, next.then(() => {}, () => {}));
  return next;
}

// ---------------------------------------------------------------------------
// JSONL helpers
// ---------------------------------------------------------------------------

/** 逐行读取 JSONL 文件，返回 [解析结果, 错误日志]。 */
export async function read_jsonl<T>(
  adapter: PlatformAdapter,
  path: string,
  parse: (d: Record<string, unknown>) => T,
): Promise<[T[], string[]]> {
  const fileExists = await adapter.exists(path);
  if (!fileExists) return [[], []];

  const text = await adapter.readFile(path);
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

/** 追加一行 JSON 到 JSONL 文件。 */
export async function append_jsonl(
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
    await adapter.writeFile(path, existing + prefix + line);
  } else {
    // 确保目录存在
    const dir = path.substring(0, path.lastIndexOf("/"));
    if (dir) await adapter.mkdir(dir);
    await adapter.writeFile(path, line);
  }
}

/** 全量重写 JSONL 文件。 */
export async function rewrite_jsonl(
  adapter: PlatformAdapter,
  path: string,
  items: Record<string, unknown>[],
): Promise<void> {
  const content = items.length > 0
    ? items.map((item) => JSON.stringify(item)).join("\n") + "\n"
    : "";
  await adapter.writeFile(path, content);
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/** 拼接路径（简单字符串拼接，确保单个 /）。 */
export function joinPath(...parts: string[]): string {
  return parts
    .map((p, i) => (i === 0 ? p.replace(/\/+$/, "") : p.replace(/^\/+|\/+$/g, "")))
    .filter(Boolean)
    .join("/");
}

// ---------------------------------------------------------------------------
// ID generation
// ---------------------------------------------------------------------------

/** 生成全局唯一 Fact ID：f_{unix时间戳}_{4位随机}。 */
export function generate_fact_id(): string {
  const ts = Math.floor(Date.now() / 1000);
  const rand = Array.from({ length: 4 }, () =>
    "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)],
  ).join("");
  return `f_${ts}_${rand}`;
}

/** 生成全局唯一操作 ID：op_{unix时间戳}_{4位随机}。 */
export function generate_op_id(): string {
  const ts = Math.floor(Date.now() / 1000);
  const rand = Array.from({ length: 4 }, () =>
    "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)],
  ).join("");
  return `op_${ts}_${rand}`;
}
