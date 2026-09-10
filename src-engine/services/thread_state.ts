// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 剧情线「当前进展」(Thread.state) 维护（最后一公里 B2）。
 *
 * 背景：Thread.state 每次续写都注入 prompt（buildThreadsLayer），但引擎里**没有任何自动
 * 写 state 的路径**——只有 UI 手动编辑能改。M9 只往 fact 上挂 thread_ids、从不碰 thread.state。
 * 于是用户写着写着，那句「当前进展」就旧了，旧话一直污染每次 prompt。
 *
 * 本模块给两件**便宜**的东西（不默认烧 token）：
 *   1. computeThreadStaleness —— 纯确定性，零 LLM：某条线挂了「晚于 state 上次更新」的新事实
 *      就算陈旧。UI 据此提示「进展待更新」，让隐性陈旧变显性。
 *   2. regenerateThreadState —— 按需（用户点「刷新进展」）用 LLM 从成员事实重算一句话。
 *      失败降级返回 null（不抛）。是否在 confirm 后自动重算属产品×成本取舍，不在此默认触发。
 *
 * REQ-140 编排板新增三件纯函数（零 LLM）：sortThreadFacts（显式序+派生序兜底）/
 * allocateThreadOrder（gap 序号分配）/ normalizeThreadOrders（归一化重排）。
 */

import type { Fact } from "../domain/fact.js";
import { isColdFact } from "../domain/fact.js";
import type { Thread } from "../domain/thread.js";
import { ThreadStatus } from "../domain/enums.js";
import type { LLMProvider } from "../llm/provider.js";
import { getPrompts } from "../prompts/index.js";
import { logCatch } from "../logger/index.js";

/** 一条陈旧剧情线：id + 自 state 上次更新以来新挂的事实数。 */
export interface ThreadStaleness {
  thread_id: string;
  new_fact_count: number;
}

/**
 * 确定性地找出「进展可能已过时」的剧情线（零 LLM）。
 *
 * 判据：某条 active 线挂着 `created_at > thread.updated_at`（即在 state 上次更新之后
 * 才落库）的非冷成员事实。resolved 线已收束、dormant 线在休眠（REQ-140：休眠期间不烦用户），
 * 都跳过。ISO-8601 时间戳按字符串比较即时序比较（合法）。thread.updated_at 在 state 被
 * 编辑 / 重算时刷新，刷新后陈旧自动清零。
 */
export function computeThreadStaleness(threads: Thread[], facts: Fact[]): ThreadStaleness[] {
  const out: ThreadStaleness[] = [];
  for (const t of threads) {
    if (t.status !== ThreadStatus.ACTIVE) continue;
    const cutoff = t.updated_at || "";
    let n = 0;
    for (const f of facts) {
      if (!(f.thread_ids ?? []).includes(t.id)) continue;
      if (isColdFact(f)) continue;
      if ((f.created_at || "") > cutoff) n++;
    }
    if (n > 0) out.push({ thread_id: t.id, new_fact_count: n });
  }
  return out;
}

/** 一条剧情线的非冷成员事实，按时序（chapter 再 created_at）正序。 */
export function threadMemberFacts(thread: Thread, facts: Fact[]): Fact[] {
  return facts
    .filter((f) => (f.thread_ids ?? []).includes(thread.id) && !isColdFact(f))
    .sort((a, b) => a.chapter - b.chapter || (a.created_at || "").localeCompare(b.created_at || ""));
}

/** regenerateThreadState 单章最多喂给 LLM 的成员事实数（控 token；取最近的）。 */
export const THREAD_STATE_MAX_FACTS = 12;

/**
 * 按需用 LLM 从成员事实重算一句「当前进展」。成功返回新 state 文本；无成员事实 / LLM 失败
 * 返回 null（降级不抛，调用方静默跳过或保留旧 state）。**本函数只生成、不落盘**——调用方拿到
 * 文本后自行 thread.update（并刷新 updated_at，使陈旧判定清零）。
 */
export async function regenerateThreadState(
  thread: Thread,
  member_facts: Fact[],
  llm_provider: LLMProvider,
  opts?: { language?: "zh" | "en"; signal?: AbortSignal },
): Promise<string | null> {
  const recent = member_facts.slice(-THREAD_STATE_MAX_FACTS);
  if (recent.length === 0) return null;
  const language = opts?.language ?? "zh";
  const P = getPrompts(language as "zh" | "en");

  const factLines = recent.map((f) => `- ${f.content_clean}`).join("\n");
  const messages = [
    { role: "system" as const, content: P.THREAD_STATE_SYSTEM },
    {
      role: "user" as const,
      content: P.THREAD_STATE_USER.replace("{title}", thread.title)
        .replace("{description}", thread.description || (language === "en" ? "(none)" : "（无）"))
        .replace("{facts}", factLines),
    },
  ];

  try {
    const response = await llm_provider.generate({
      messages,
      max_tokens: 120,
      temperature: 0.4,
      top_p: 0.95,
      signal: opts?.signal,
    });
    const text = (response.content ?? "").trim();
    return text.length > 0 ? text : null;
  } catch (err) {
    logCatch("thread", `regenerate thread state failed for ${thread.id}`, err);
    return null;
  }
}

// ===========================================================================
// REQ-140 编排板：线内显式序号（thread_order）
// ===========================================================================

/** 相邻节点的序号间隔。gap 制（10/20/30…）让插入多数时候只需写中点、不必整线归一化。 */
export const THREAD_ORDER_GAP = 10;

/** 派生序比较器（旧数据兜底）：章号升序，再 created_at 升序。与 threadMemberFacts 同据。 */
function derivedCompare(a: Fact, b: Fact): number {
  return a.chapter - b.chapter || (a.created_at || "").localeCompare(b.created_at || "");
}

/**
 * 一条线的成员节点按「用户编排序」排序：
 * - 有 `thread_order[threadId]` 的按序号升序在前；
 * - 没序号的排尾部、按派生序（章号+created_at）——**全部无序号时输出与旧派生序完全一致**
 *   （旧线打开顺序不变的兼容承诺）；
 * - 不过滤冷 fact（调用方按需自行 isColdFact 过滤：UI 展示全量、注入层滤冷）。
 */
export function sortThreadFacts(facts: Fact[], threadId: string): Fact[] {
  const members = facts.filter((f) => (f.thread_ids ?? []).includes(threadId));
  const withOrder = members
    .filter((f) => typeof f.thread_order?.[threadId] === "number")
    .sort((a, b) => (a.thread_order?.[threadId] ?? 0) - (b.thread_order?.[threadId] ?? 0));
  const withoutOrder = members.filter((f) => typeof f.thread_order?.[threadId] !== "number").sort(derivedCompare);
  return [...withOrder, ...withoutOrder];
}

/**
 * 为「插到 before/after 之间」分配一个序号（gap 中点）。before/after 传邻居的现有序号；
 * 头部插入 before=undefined，尾部 after=undefined。返回 null = 间隙耗尽或撞号，调用方应
 * 先 normalizeThreadOrders 归一化再重试。
 */
export function allocateThreadOrder(before: number | undefined, after: number | undefined): number | null {
  if (before === undefined && after === undefined) return THREAD_ORDER_GAP; // 空线首节点
  if (before === undefined) {
    const v = (after as number) - THREAD_ORDER_GAP;
    return v; // 头部：可负，排序只认相对大小
  }
  if (after === undefined) return before + THREAD_ORDER_GAP;
  if (after - before < 2) return null; // 间隙 <2 放不下整数中点
  return Math.floor((before + after) / 2);
}

/**
 * 把一串成员按给定顺序归一化为 10/20/30…。orderedFacts 应已是目标顺序（通常来自
 * sortThreadFacts 或换位后的数组）。返回 { factId: order } 映射，调用方逐条写回对应线键。
 */
export function normalizeThreadOrders(orderedFacts: Fact[]): Record<string, number> {
  const out: Record<string, number> = {};
  orderedFacts.forEach((f, i) => {
    out[f.id] = (i + 1) * THREAD_ORDER_GAP;
  });
  return out;
}
