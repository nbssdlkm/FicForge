// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** FileThreadRepository — threads.jsonl 读写实现（M8-B）。镜像 file_fact.ts 模式。 */

import type { PlatformAdapter } from "../../platform/adapter.js";
import { ThreadStatus, THREAD_STATUS_VALUES } from "../../domain/enums.js";
import type { Thread } from "../../domain/thread.js";
import { createThread } from "../../domain/thread.js";
import type { ThreadRepository } from "../interfaces/thread.js";
import {
  appendJsonl,
  joinPath,
  nowUtc,
  readJsonl,
  rewriteJsonl,
  validateBasePath,
  withWriteLock,
} from "../../utils/file_utils.js";
import { hasLogger, getLogger } from "../../logger/index.js";

// ---------------------------------------------------------------------------
// Thread ↔ JSON 序列化
// ---------------------------------------------------------------------------

export function threadToDict(t: Thread): Record<string, unknown> {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    state: t.state,
    status: t.status,
    created_at: t.created_at,
    updated_at: t.updated_at,
  };
}

function dictToThread(d: Record<string, unknown>): Thread {
  const now = nowUtc();
  const rawStatus = d.status as string;
  // 枚举校验：非法值兜底 active（align M8-A dictToFact 的 time_kind/suspense_type 校验模式）
  const status = (THREAD_STATUS_VALUES as readonly string[]).includes(rawStatus)
    ? (rawStatus as ThreadStatus)
    : ThreadStatus.ACTIVE;
  return createThread({
    id: d.id as string,
    title: (d.title as string) ?? "",
    description: (d.description as string) ?? "",
    state: (d.state as string) ?? "",
    status,
    created_at: (d.created_at as string) || now,
    updated_at: (d.updated_at as string) || now,
  });
}

// ---------------------------------------------------------------------------
// Repository 实现
// ---------------------------------------------------------------------------

export class FileThreadRepository implements ThreadRepository {
  constructor(private adapter: PlatformAdapter) {}

  private threadsPath(au_id: string): string {
    validateBasePath(au_id, "au_id");
    return joinPath(au_id, "threads.jsonl");
  }

  private async readAll(au_id: string): Promise<Thread[]> {
    const path = this.threadsPath(au_id);
    const [threads, errors] = await readJsonl(this.adapter, path, dictToThread);
    if (errors.length > 0) {
      if (hasLogger())
        getLogger().warn("file_thread", "bad lines on read", { path, count: errors.length, first: errors[0] });
    }
    return threads;
  }

  async list(au_id: string): Promise<Thread[]> {
    return this.readAll(au_id);
  }

  async get(au_id: string, id: string): Promise<Thread | null> {
    const threads = await this.readAll(au_id);
    return threads.find((t) => t.id === id) ?? null;
  }

  async add(au_id: string, thread: Thread): Promise<void> {
    const path = this.threadsPath(au_id);
    await withWriteLock(path, () => appendJsonl(this.adapter, path, threadToDict(thread)));
  }

  async update(au_id: string, thread: Thread): Promise<void> {
    thread.updated_at = nowUtc();
    const path = this.threadsPath(au_id);
    await withWriteLock(path, async () => {
      const [threads, errors] = await readJsonl(this.adapter, path, dictToThread);
      if (errors.length > 0) {
        if (hasLogger()) getLogger().warn("file_thread", "bad lines on update", { path, count: errors.length });
      }
      // 不存在则保持原样（不新增）；存在则整条替换
      const items = threads.map((t) => (t.id === thread.id ? threadToDict(thread) : threadToDict(t)));
      await rewriteJsonl(this.adapter, path, items);
    });
  }

  async remove(au_id: string, id: string): Promise<void> {
    const path = this.threadsPath(au_id);
    await withWriteLock(path, async () => {
      const [threads, errors] = await readJsonl(this.adapter, path, dictToThread);
      if (errors.length > 0) {
        if (hasLogger()) getLogger().warn("file_thread", "bad lines on remove", { path, count: errors.length });
      }
      const remaining = threads.filter((t) => t.id !== id);
      await rewriteJsonl(this.adapter, path, remaining.map(threadToDict));
    });
  }
}
