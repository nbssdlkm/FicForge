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
  generateThreadId,
  nowUtc,
  computeThreadStaleness,
  sortThreadFacts,
  allocateThreadOrder,
  normalizeThreadOrders,
  isColdFact,
  regenerateThreadState as regenerateThreadStateEngine,
} from "@ficforge/engine";
import type { Fact, Thread, ThreadStaleness } from "@ficforge/engine";
import { getEngine } from "./engine-instance";
import { editFact, resolveFactsProvider } from "./engine-facts";

export async function listThreads(auPath: string): Promise<Thread[]> {
  return getEngine().repos.thread.list(auPath);
}

export async function addThread(
  auPath: string,
  data: { title: string; description?: string; state?: string; status?: ThreadStatus },
): Promise<Thread> {
  const ts = nowUtc();
  const thread = createThread({
    id: generateThreadId(),
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
  const [threads, facts] = await Promise.all([e.repos.thread.list(auPath), e.repos.fact.listAll(auPath)]);
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
  const facts = await e.repos.fact.listAll(auPath);
  // REQ-140：喂 LLM 的顺序跟用户编排序（显式 thread_order 优先，派生序兜底），滤冷不变
  const members = sortThreadFacts(facts, threadId).filter((f) => !isColdFact(f));
  const { provider, lang } = await resolveFactsProvider(auPath);
  const state = await regenerateThreadStateEngine(thread, members, provider, { language: lang as "zh" | "en" });
  if (state == null) return null;
  await e.repos.thread.update(auPath, { ...thread, state, updated_at: nowUtc() });
  return state;
}

// setThreadStatus / setFactThreads 已删除（2026-07-09 盲审孤儿管线清理）：全仓零调用点。
// 改状态走 updateThread 整对象更新；成员关系走 addFactToThread / removeFactFromThread
// （fresh-read 版，防 lost-update）。

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
  const facts = await e.repos.fact.listAll(auPath);
  for (const f of facts) {
    const ids = f.thread_ids ?? [];
    if (!ids.includes(id)) continue;
    const patch: Record<string, unknown> = { thread_ids: ids.filter((tid) => tid !== id) };
    if (f.thread_roles && id in f.thread_roles) {
      const { [id]: _drop, ...rest } = f.thread_roles;
      patch.thread_roles = rest;
    }
    if (f.thread_order && id in f.thread_order) {
      const { [id]: _dropO, ...restO } = f.thread_order;
      patch.thread_order = restO;
    }
    await editFact(auPath, f.id, patch);
  }
  await e.repos.thread.remove(auPath, id);
}

// 以下操作都先从仓库读 fresh fact 再算 patch（不信 UI 传入的旧 thread_ids/thread_roles），
// 否则 editFact 整字段覆写会丢更新（workflow 审 MAJOR：lost-update）。残留窄窗：fresh 读与
// editFact 自身 withAuLock 非同一把锁，但 ThreadDetail 用 busyRef 同步串行同一 fact 操作 +
// 单用户低频，实际不触发。彻底原子需给 editFact 加 in-lock transform 回调（记 TD 后续硬化）。

/**
 * 把一条 Fact 挂到某剧情线（成员关系 = fact.thread_ids）。已挂则 no-op。
 * REQ-140：`at` 可指定插入位置（beforeFactId/afterFactId 为线上邻居节点 id，均空 = 尾部追加）。
 * 序号用 gap 中点；间隙耗尽时先把全线归一化（10/20/30…）再分配。
 */
export async function addFactToThread(
  auPath: string,
  factId: string,
  threadId: string,
  at?: { beforeFactId?: string; afterFactId?: string },
): Promise<void> {
  const e = getEngine();
  const fresh = await e.repos.fact.get(auPath, factId);
  const ids = fresh?.thread_ids ?? [];
  if (ids.includes(threadId)) return;
  const patch: Record<string, unknown> = { thread_ids: [...ids, threadId] };

  if (at) {
    let facts = await e.repos.fact.listAll(auPath);
    let members = sortThreadFacts(facts, threadId);
    const orderOf = (fid: string | undefined): number | undefined => {
      if (!fid) return undefined;
      const v = facts.find((x) => x.id === fid)?.thread_order?.[threadId];
      return typeof v === "number" ? v : undefined;
    };
    // 两套词汇表对齐（对抗审 blocker 实证）：UI 侧 beforeFactId=「插到它之前」的后继节点、
    // afterFactId=「插到它之后」的前驱节点；allocateThreadOrder 契约 before=前驱序号、after=后继序号。
    // 所以交叉映射：before ← afterFactId（上方邻居），after ← beforeFactId（下方邻居）。接反则三个
    // 缝隙两个落错位、中间缝必撞号（REQ-140 对抗审 kimi 抓出，回归测试见 engine-threads 位置用例）。
    let before = orderOf(at.afterFactId);
    let after = orderOf(at.beforeFactId);
    // 邻居没有显式序号（旧线）→ 先全线归一化再定位
    if ((at.beforeFactId && after === undefined) || (at.afterFactId && before === undefined)) {
      await writeNormalizedOrders(auPath, threadId, members);
      facts = await e.repos.fact.listAll(auPath);
      members = sortThreadFacts(facts, threadId);
      before = orderOf(at.afterFactId);
      after = orderOf(at.beforeFactId);
    }
    // 邻居本来就没传（尾追加）但线上有节点 → 追加到最大序号之后
    if (!at.beforeFactId && !at.afterFactId && members.length > 0) {
      before = orderOf(members[members.length - 1].id);
      if (before === undefined) {
        await writeNormalizedOrders(auPath, threadId, members);
        facts = await e.repos.fact.listAll(auPath);
        members = sortThreadFacts(facts, threadId);
        before = orderOf(members[members.length - 1].id);
      }
      after = undefined;
    }
    let order = allocateThreadOrder(before, after);
    if (order === null) {
      // 间隙耗尽 → 归一化后重算中点；仍失败则大声抛错（不许静默撞号——silent fallback 教训）
      await writeNormalizedOrders(auPath, threadId, members);
      facts = await e.repos.fact.listAll(auPath);
      order = allocateThreadOrder(orderOf(at.afterFactId), orderOf(at.beforeFactId));
      if (order === null) throw new Error(`thread ${threadId} 序号归一化后仍无法分配插入位`);
    }
    const nextOrder = { ...(fresh?.thread_order ?? {}), [threadId]: order };
    patch.thread_order = nextOrder;
  }
  await editFact(auPath, factId, patch);
}

/** 全线归一化写回（10/20/30…）。members 应已是目标顺序。
 *  best-effort 语义（REQ-140 codex 审 R2 修复）：逐条 editFact 无事务，任一失败不中断——
 *  继续写完其余（序号任意数值都能排序，多写一条就多收敛一条），末尾聚合抛出让 UI 响亮报错；
 *  已是目标值的跳过不写，收窄失败窗口。重试可自愈（下次归一化从混合序号继续收敛）。 */
async function writeNormalizedOrders(auPath: string, threadId: string, members: Fact[]): Promise<void> {
  const mapping = normalizeThreadOrders(members);
  const total = Object.keys(mapping).length;
  const failures: unknown[] = [];
  for (const [factId, order] of Object.entries(mapping)) {
    try {
      const fresh = await getEngine().repos.fact.get(auPath, factId);
      if (!fresh) continue;
      if (fresh.thread_order?.[threadId] === order) continue; // 已是目标值 → 不重写，不涨 revision
      await editFact(auPath, factId, { thread_order: { ...(fresh.thread_order ?? {}), [threadId]: order } });
    } catch (err) {
      failures.push(err);
    }
  }
  if (failures.length > 0) {
    throw new Error(`剧情线序号归一化部分失败：${total} 条中 ${failures.length} 条未写入（重试可自愈）`);
  }
}

/**
 * 线上换位（REQ-140）：把 factId 与上/下邻居交换位置。实现 = 交换后按新顺序全线归一化
 * （gap 序号重写为 10/20/30…），比在飞交换两个序号更不容易留脏状态。到端点 no-op。
 */
export async function moveFactInThread(
  auPath: string,
  threadId: string,
  factId: string,
  direction: "up" | "down",
): Promise<void> {
  const e = getEngine();
  const facts = await e.repos.fact.listAll(auPath);
  const members = sortThreadFacts(facts, threadId);
  const idx = members.findIndex((f) => f.id === factId);
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapWith < 0 || swapWith >= members.length) return;
  const next = [...members];
  [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
  await writeNormalizedOrders(auPath, threadId, next);
}

/** 把一条 Fact 从某剧情线摘除：同时清 thread_ids 与 thread_roles/thread_order 的本线条目，不留孤儿。 */
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
  if (fresh.thread_order && threadId in fresh.thread_order) {
    const { [threadId]: _dropO, ...restO } = fresh.thread_order;
    patch.thread_order = restO;
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
