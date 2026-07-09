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
  computeThreadStaleness,
  threadMemberFacts,
  regenerate_thread_state,
} from "@ficforge/engine";
import type { Thread, ThreadStaleness } from "@ficforge/engine";
import { getEngine } from "./engine-instance";
import { editFact, resolveFactsProvider } from "./engine-facts";

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

/**
 * 最后一公里 B2：确定性找出「当前进展可能已过时」的剧情线（零 LLM）——挂了晚于 state 上次
 * 更新的新事实即算陈旧。UI 据此在剧情线上提示「进展待更新」，让隐性陈旧变显性。
 */
export async function getStaleThreads(auPath: string): Promise<ThreadStaleness[]> {
  const e = getEngine();
  const [threads, facts] = await Promise.all([
    e.repos.thread.list(auPath),
    e.repos.fact.list_all(auPath),
  ]);
  return computeThreadStaleness(threads, facts);
}

/**
 * 按需（用户点「刷新进展」）用 LLM 从成员事实重算某条线的「当前进展」并落库。返回新 state 文本；
 * null = 无成员事实 / LLM 失败（未改动，保留旧 state）。落库时刷新 updated_at → 陈旧判定清零。
 * 成本可控：只有用户显式触发才烧 token，不在 confirm 后自动重算。
 */
export async function regenerateThreadState(auPath: string, threadId: string): Promise<string | null> {
  const e = getEngine();
  const thread = await e.repos.thread.get(auPath, threadId);
  if (!thread) return null;
  const facts = await e.repos.fact.list_all(auPath);
  const members = threadMemberFacts(thread, facts);
  const { provider, lang } = await resolveFactsProvider(auPath);
  const state = await regenerate_thread_state(thread, members, provider, { language: lang as "zh" | "en" });
  if (state == null) return null;
  await e.repos.thread.update(auPath, { ...thread, state, updated_at: now_utc() });
  return state;
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

// 这三个操作都先从仓库读 fresh fact 再算 patch（不信 UI 传入的旧 thread_ids/thread_roles），
// 否则 editFact 整字段覆写会丢更新（workflow 审 MAJOR：lost-update）。残留窄窗：fresh 读与
// editFact 自身 withAuLock 非同一把锁，但 ThreadDetail 用 busyRef 同步串行同一 fact 操作 +
// 单用户低频，实际不触发。彻底原子需给 edit_fact 加 in-lock transform 回调（记 TD 后续硬化）。

/** 把一条 Fact 挂到某剧情线（成员关系 = fact.thread_ids）。已挂则 no-op。 */
export async function addFactToThread(auPath: string, factId: string, threadId: string): Promise<void> {
  const fresh = await getEngine().repos.fact.get(auPath, factId);
  const ids = fresh?.thread_ids ?? [];
  if (ids.includes(threadId)) return;
  await editFact(auPath, factId, { thread_ids: [...ids, threadId] });
}

/** 把一条 Fact 从某剧情线摘除：同时清 thread_ids 与 thread_roles[threadId]，不留孤儿。 */
export async function removeFactFromThread(auPath: string, factId: string, threadId: string): Promise<void> {
  const fresh = await getEngine().repos.fact.get(auPath, factId);
  if (!fresh) return;
  const patch: Record<string, unknown> = {
    thread_ids: (fresh.thread_ids ?? []).filter((t) => t !== threadId),
  };
  if (fresh.thread_roles && threadId in fresh.thread_roles) {
    const { [threadId]: _drop, ...rest } = fresh.thread_roles;
    patch.thread_roles = rest;
  }
  await editFact(auPath, factId, patch);
}

/** 设/清某 Fact 在某线里的角色（thread_role）。role 空串=清除该键。 */
export async function setFactThreadRole(auPath: string, factId: string, threadId: string, role: string): Promise<void> {
  const fresh = await getEngine().repos.fact.get(auPath, factId);
  const next: Record<string, string> = { ...(fresh?.thread_roles ?? {}) };
  const trimmed = role.trim();
  if (trimmed) next[threadId] = trimmed;
  else delete next[threadId];
  await editFact(auPath, factId, { thread_roles: next });
}
