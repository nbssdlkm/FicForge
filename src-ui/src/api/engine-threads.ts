// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Threads — 剧情线 CRUD（M8-B）。
 *
 * 薄封装（mirror engine-facts.ts）：未来「剧情线面板」UI 调本文件。
 * 成员关系（给 Fact 挂线）走 setFactThreads → 既有 edit_fact op 路径，
 * 不新增 op 类型，复用 facts 的 ops/undo/锁机制。
 */

import {
  ThreadStatus,
  createThread,
  generate_thread_id,
  now_utc,
} from "@ficforge/engine";
import type { Thread } from "@ficforge/engine";
import { getEngine } from "./engine-instance";
import { editFact } from "./engine-facts";

export async function listThreads(auPath: string): Promise<Thread[]> {
  return getEngine().repos.thread.list(auPath);
}

export async function addThread(
  auPath: string,
  data: { title: string; description?: string; state?: string },
): Promise<Thread> {
  const ts = now_utc();
  const thread = createThread({
    id: generate_thread_id(),
    title: data.title,
    description: data.description ?? "",
    state: data.state ?? "",
    status: ThreadStatus.ACTIVE,
    created_at: ts,
    updated_at: ts,
  });
  await getEngine().repos.thread.add(auPath, thread);
  return thread;
}

/** 整条更新（标题/描述/进展/状态）。updated_at 由仓库刷新。 */
export async function updateThread(auPath: string, thread: Thread): Promise<void> {
  await getEngine().repos.thread.update(auPath, thread);
}

/** 改状态（收束 resolved / 搁置 dormant / 重新激活 active）。 */
export async function setThreadStatus(
  auPath: string,
  id: string,
  status: ThreadStatus,
): Promise<void> {
  const t = await getEngine().repos.thread.get(auPath, id);
  if (!t) return;
  await getEngine().repos.thread.update(auPath, { ...t, status });
}

export async function removeThread(auPath: string, id: string): Promise<void> {
  await getEngine().repos.thread.remove(auPath, id);
}

/**
 * 给一条 Fact 设置所属剧情线（成员关系单一真相源 = fact.thread_ids）。
 * 走 edit_fact op（thread_ids 已在 EDITABLE_FIELDS 白名单），ops rebuild 可还原。
 *
 * 注意：thread_roles 是 M8-B 留位字段，v1 无任何生产者（没有 API / 提取会写它），
 * 故此处只动 thread_ids 不会造成 thread_roles 漂移。M9 若开始用 thread_roles，
 * 需在此处（及 removeThread）同步裁剪 thread_roles 使其键与 thread_ids 一致。
 */
export async function setFactThreads(
  auPath: string,
  factId: string,
  threadIds: string[],
): Promise<void> {
  await editFact(auPath, factId, { thread_ids: threadIds });
}
