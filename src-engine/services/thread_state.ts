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
 * 判据：某条 active/dormant 线挂着 `created_at > thread.updated_at`（即在 state 上次更新之后
 * 才落库）的非冷成员事实。resolved 线已收束、不再挂新事实，跳过。ISO-8601 时间戳按字符串比较
 * 即时序比较（合法）。thread.updated_at 在 state 被编辑 / 重算时刷新，刷新后陈旧自动清零。
 */
export function computeThreadStaleness(threads: Thread[], facts: Fact[]): ThreadStaleness[] {
  const out: ThreadStaleness[] = [];
  for (const t of threads) {
    if (t.status === ThreadStatus.RESOLVED) continue;
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
