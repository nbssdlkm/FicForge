// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** LocalFileOpsRepository — ops.jsonl 读写实现。参见 PRD §2.6.5、D-0010。 */

import type { PlatformAdapter } from "../../platform/adapter.js";
import type { OpsEntry } from "../../domain/ops_entry.js";
import { createOpsEntry } from "../../domain/ops_entry.js";
import type { OpsRepository } from "../interfaces/ops.js";
import { append_jsonl, joinPath, read_jsonl } from "./file_utils.js";

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
  if (entry.chapter_num !== null) {
    d.chapter_num = entry.chapter_num;
  }
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
    const path = this.opsPath(au_id);
    await withWriteLock(path, () => append_jsonl(this.adapter, path, entryToDict(entry)));
  }

  async list_all(au_id: string): Promise<OpsEntry[]> {
    const path = this.opsPath(au_id);
    const exists = await this.adapter.exists(path);
    if (!exists) return [];
    const [entries] = await read_jsonl(this.adapter, path, dictToEntry);
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
}
