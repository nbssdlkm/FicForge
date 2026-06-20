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
  data: { title: string; description?: string; state?: string; status?: ThreadStatus },
): Promise<Thread> {
  const ts = now_utc();
  const thread = createThread({
    id: generate_thread_id(),
    title: data.title,
    description: data.description ?? "",
    state: data.state ?? "",
    // 单次写入即定状态（codex 审 MAJOR：原先固定 ACTIVE + 二次 setThreadStatus，
    // 二次写失败不回滚 → 用户再保存会重复建线）。
    status: data.status ?? ThreadStatus.ACTIVE,
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

/**
 * 删线。成员关系单一真相源 = fact.thread_ids，故删线前先把各 fact 上对本线的引用清掉
 * （含 thread_roles[id]），否则留下 orphaned 引用、数据层不一致（codex 审 MAJOR）。
 *
 * 先扫 fact、后删 thread：若中途某条 fact 清理失败抛出，thread 仍在 → 用户可重试删除，
 * 不会出现「thread 没了但 fact 还引用」的状态。每条 editFact 各自 withAuLock（非单事务原子，
 * 但顺序保证可重入收敛）。
 */
export async function removeThread(auPath: string, id: string): Promise<void> {
  const e = getEngine();
  const facts = await e.repos.fact.list_all(auPath);
  for (const f of facts) {
    const ids = f.thread_ids ?? [];
    if (!ids.includes(id)) continue;
    const patch: Record<string, unknown> = { thread_ids: ids.filter((tid) => tid !== id) };
    if (f.thread_roles && id in f.thread_roles) {
      const { [id]: _drop, ...rest } = f.thread_roles;
      patch.thread_roles = rest;
    }
    await editFact(auPath, f.id, patch);
  }
  await e.repos.thread.remove(auPath, id);
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
