// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** LocalFileOpsRepository — ops.jsonl 读写实现。参见 PRD §2.6.5、D-0010。 */

import type { PlatformAdapter } from "../../platform/adapter.js";
import type { OpsEntry } from "../../domain/ops_entry.js";
import { createOpsEntry } from "../../domain/ops_entry.js";
import type { OpsRepository } from "../interfaces/ops.js";
import { append_jsonl, joinPath, read_jsonl, rewrite_jsonl } from "./file_utils.js";
import { getNextLamportClock, initLamportClockFromOps } from "../../sync/ops_merge.js";

// ---------------------------------------------------------------------------
// 坏行保留
// ---------------------------------------------------------------------------

/**
 * 重写 JSONL 前，检查原文件中是否有无法解析的行。
 * 如果有，将原文追加到 {path}.bad sidecar 文件，避免永久丢失。
 */
async function preserveBadLines(
  adapter: PlatformAdapter,
  path: string,
  parse: (d: Record<string, unknown>) => OpsEntry,
): Promise<void> {
  const exists = await adapter.exists(path);
  if (!exists) return;

  const text = await adapter.readFile(path);
  const badLines: string[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const d = JSON.parse(trimmed) as Record<string, unknown>;
      parse(d);
    } catch {
      badLines.push(trimmed);
    }
  }

  if (badLines.length === 0) return;

  const badPath = path + ".bad";
  const header = `# ${new Date().toISOString()} — ${badLines.length} bad line(s) preserved before replace_all\n`;
  const badContent = header + badLines.join("\n") + "\n";
  try {
    const existingBad = await adapter.exists(badPath) ? await adapter.readFile(badPath) : "";
    await adapter.writeFile(badPath, existingBad + badContent);
  } catch {
    // sidecar 写入失败不阻断主流程
  }
  console.warn(`[file_ops] Preserved ${badLines.length} bad line(s) to ${badPath}`);
}

// ---------------------------------------------------------------------------
// 写入锁
// ---------------------------------------------------------------------------

const _writeLocks = new Map<string, Promise<void>>();

function withWriteLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = _writeLocks.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  _writeLocks.set(key, next.then(() => {}, () => {}));
  return next;
}

// ---------------------------------------------------------------------------
// OpsEntry ↔ JSON 序列化
// ---------------------------------------------------------------------------

function entryToDict(entry: OpsEntry): Record<string, unknown> {
  const d: Record<string, unknown> = {
    op_id: entry.op_id,
    op_type: entry.op_type,
    target_id: entry.target_id,
    timestamp: entry.timestamp,
    payload: entry.payload,
  };
  if (entry.chapter_num !== null) d.chapter_num = entry.chapter_num;
  // 始终写入 device_id 和 lamport_clock（同步必需字段）
  d.device_id = entry.device_id ?? "";
  d.lamport_clock = entry.lamport_clock ?? 0;
  return d;
}

function dictToEntry(d: Record<string, unknown>): OpsEntry {
  return createOpsEntry({
    op_id: d.op_id as string,
    op_type: (d.op_type as string) ?? "",
    target_id: (d.target_id as string) ?? "",
    timestamp: (d.timestamp as string) ?? "",
    chapter_num: (d.chapter_num as number) ?? null,
    payload: (d.payload as Record<string, unknown>) ?? {},
    device_id: (d.device_id as string) ?? "",
    lamport_clock: (d.lamport_clock as number) ?? 0,
  });
}

// ---------------------------------------------------------------------------
// Repository 实现
// ---------------------------------------------------------------------------

export class FileOpsRepository implements OpsRepository {
  constructor(private adapter: PlatformAdapter) {}

  private opsPath(au_id: string): string {
    return joinPath(au_id, "ops.jsonl");
  }

  async append(au_id: string, entry: OpsEntry): Promise<void> {
    // 自动注入 device_id 和 lamport_clock（如果调用方未设置）
    if (!entry.device_id) {
      entry.device_id = this.adapter.getDeviceId();
    }
    if (!entry.lamport_clock) {
      entry.lamport_clock = getNextLamportClock();
    }
    const path = this.opsPath(au_id);
    await withWriteLock(path, () => append_jsonl(this.adapter, path, entryToDict(entry)));
  }

  async list_all(au_id: string): Promise<OpsEntry[]> {
    const path = this.opsPath(au_id);
    const exists = await this.adapter.exists(path);
    if (!exists) return [];
    const [entries, errors] = await read_jsonl(this.adapter, path, dictToEntry);
    if (errors.length > 0) {
      console.warn(`[file_ops] ${errors.length} bad line(s) in ${path}: ${errors[0]}${errors.length > 1 ? ` (+${errors.length - 1} more)` : ""}`);
    }
    // 懒初始化 lamport clock（首次读取 ops 时设置）
    initLamportClockFromOps(entries);
    return entries;
  }

  async list_by_target(au_id: string, target_id: string): Promise<OpsEntry[]> {
    const entries = await this.list_all(au_id);
    return entries.filter((e) => e.target_id === target_id);
  }

  async list_by_chapter(au_id: string, chapter_num: number): Promise<OpsEntry[]> {
    const entries = await this.list_all(au_id);
    return entries.filter((e) => e.chapter_num === chapter_num);
  }

  async get_by_op_type(au_id: string, op_type: string): Promise<OpsEntry[]> {
    const entries = await this.list_all(au_id);
    return entries.filter((e) => e.op_type === op_type);
  }

  async get_confirm_for_chapter(au_id: string, chapter_num: number): Promise<OpsEntry | null> {
    const entries = await this.list_all(au_id);
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].op_type === "confirm_chapter" && entries[i].chapter_num === chapter_num) {
        return entries[i];
      }
    }
    return null;
  }

  async get_add_facts_for_chapter(au_id: string, chapter_num: number): Promise<OpsEntry[]> {
    const entries = await this.list_all(au_id);
    return entries.filter((e) => e.op_type === "add_fact" && e.chapter_num === chapter_num);
  }

  async get_latest_by_type(au_id: string, op_type: string): Promise<OpsEntry | null> {
    const entries = await this.get_by_op_type(au_id, op_type);
    return entries.length > 0 ? entries[entries.length - 1] : null;
  }

  async replace_all(au_id: string, ops: OpsEntry[]): Promise<void> {
    const path = this.opsPath(au_id);
    await withWriteLock(path, async () => {
      // 写入前保留坏行到 .bad sidecar，防止永久丢失
      await preserveBadLines(this.adapter, path, dictToEntry);
      const items = ops.map(entryToDict);
      await rewrite_jsonl(this.adapter, path, items);
    });
  }
}
