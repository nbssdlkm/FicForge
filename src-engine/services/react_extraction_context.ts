// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * M9 ReAct 提取上下文组装。不复用 assemble_context_simple（那是续写用，语义不符）。
 *
 * 与单次调用提取（facts_extraction.buildUserMessage）的差异：
 *  - 「怎么输出」从 user 命令移到 system prompt（ReAct 走工具调用，不是 JSON 文本）；
 *    因为 runAgentLoop 里「纯文本无工具」=立即终止，输出指令必须让 LLM 走 tool 路径。
 *  - system prompt 末尾动态附「可用剧情线」列表，供 annotate_fact 填 thread_ids。
 *  - user message 复用 chapter intro + existing facts 摘要 + 角色块（buildCharacterInfoBlock）。
 */

import type { Message } from "../llm/provider.js";
import type { Thread } from "../domain/thread.js";
import { ThreadStatus } from "../domain/enums.js";
import { getPrompts } from "../prompts/index.js";
import { buildCharacterInfoBlock } from "./facts_extraction.js";

// ---------------------------------------------------------------------------
// ReAct 提取系统 prompt（zh / en）—— 工具调用协议，非 JSON 输出
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT_ZH = `你是一个事实提取助手。从给定章节中提取结构化「事实」（事件 / 关系 / 状态 / 设定），并尽量建立跨章因果与剧情线归属。你通过调用工具完成，**不要直接输出 JSON 文本**。

严格按这个顺序，每步只做一次：
1. **只调用一次 propose_facts**，把本章发现的全部重要事实一次性提议出来。**在 propose 的每条事实里直接填好**（这是关键，不要拖到后面）：
   - content_clean、characters、fact_type、narrative_weight，以及力所能及的富化字段 location / time_kind / known_to / action_verb；
   - **thread_ids**：这条事实属于下方「可用剧情线」里的哪条，就填它的 id（可多条）；
   - **caused_by_fact_ids**：这条事实由上方「已有事实」列表里的哪条（更早章节）导致，就填它的 [fact_id]（要生效必须同时给 evidence——本章原文逐字摘录）。
   **之后不要再调用 propose_facts。**
2. 仅当某条事实的成因不在上方「已有事实」列表里时，才用 search_existing_facts 检索更多，再用 annotate_fact 给对应事实（fact_index）补 caused_by_fact_ids。
3. **最后必须调用 finalize_extraction 结束**（不要用纯文本结束，也不要反复 propose）。

铁律：
- 全过程只 propose 一次。
- caused_by_fact_ids 只能用真实 fact_id（上方列表的 [id] 或 search 返回的），绝不凭空编造。
- thread_ids 只能用下方「可用剧情线」列表里的 id；没有列出就不要填。
- 没有可填的因果 / 剧情线就留空，直接 finalize_extraction 结束。`;

const SYSTEM_PROMPT_EN = `You are a fact-extraction assistant. Extract structured "facts" (events / relationships / states / settings) from the given chapter, and establish cross-chapter causality and storyline membership where possible. You do this by calling tools — **do not output raw JSON text**.

Follow this order strictly, each step once:
1. **Call propose_facts exactly once**, proposing ALL important facts from this chapter. **Fill these directly on each fact inside propose** (this is the key step, do not defer it):
   - content_clean, characters, fact_type, narrative_weight, plus enrichment like location / time_kind / known_to / action_verb where you can;
   - **thread_ids**: which of the "Available storylines" below this fact belongs to, by id (may be several);
   - **caused_by_fact_ids**: which earlier fact in the "Existing facts" list above caused this one, by its [fact_id] (to take effect you must also include a verbatim evidence excerpt from this chapter).
   **Do not call propose_facts again afterwards.**
2. Only if a fact's cause is NOT in the "Existing facts" list above, call search_existing_facts to find more, then annotate_fact to set caused_by_fact_ids on the matching fact (by fact_index).
3. **You MUST end by calling finalize_extraction** (do not finish with plain text, and do not keep proposing).

Hard rules:
- Call propose only once.
- caused_by_fact_ids may only use real fact_ids (the [id]s above or ones returned by search). Never fabricate them.
- thread_ids may only use ids from the "Available storylines" list below; if none are listed, leave it empty.
- If there is nothing to fill for causality / storylines, leave them empty and just call finalize_extraction.`;

const AVAIL_THREADS_HEADER_ZH = "\n\n可用剧情线（thread_ids 只能从这里选）：";
const AVAIL_THREADS_HEADER_EN = "\n\nAvailable storylines (thread_ids may only be chosen from here):";

/** 把可用剧情线格式化进 system prompt。只列 active / dormant（resolved 已收束，不再挂新事实）。 */
export function buildThreadListBlock(threads: Thread[], language: "zh" | "en"): string {
  const live = threads.filter((t) => t.status === ThreadStatus.ACTIVE || t.status === ThreadStatus.DORMANT);
  if (live.length === 0) return "";
  const header = language === "en" ? AVAIL_THREADS_HEADER_EN : AVAIL_THREADS_HEADER_ZH;
  const lines = live.map((t) => {
    const state = t.state ? ` — ${t.state}` : "";
    return `- ${t.id}：${t.title}（${t.status}）${state}`;
  });
  return `${header}\n${lines.join("\n")}`;
}

/** 上下文里展示的「已有事实」。带 fact_id 时 LLM 可直接在 propose 里填 caused_by_fact_ids。 */
export interface ExistingFactForContext {
  fact_id?: string;
  content_clean: string;
  chapter?: number;
}

export interface BuildExtractionMessagesParams {
  chapter_text: string;
  chapter_num: number;
  existing_facts: ExistingFactForContext[];
  cast_registry: { characters?: string[] };
  character_aliases: Record<string, string[]> | null;
  threads: Thread[];
  language: "zh" | "en";
}

export function buildExtractionMessages(params: BuildExtractionMessagesParams): {
  systemMessage: Message;
  userMessage: Message;
} {
  const { chapter_text, chapter_num, existing_facts, cast_registry, character_aliases, threads, language } = params;
  const P = getPrompts(language);

  const systemBase = language === "en" ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_ZH;
  const systemContent = systemBase + buildThreadListBlock(threads, language);

  // user message：chapter intro + existing facts 摘要 + 角色块（复用 facts_extraction 逻辑）
  const parts: string[] = [
    P.FACTS_USER_CHAPTER_INTRO
      .replace("{chapter_num}", String(chapter_num))
      .replace("{chapter_text}", chapter_text),
  ];

  if (existing_facts.length > 0) {
    // 带 [fact_id] 渲染（如有）：LLM 据此在 propose 里内联填 caused_by_fact_ids。
    const items = existing_facts.slice(0, 20).map((f) => {
      const tag = f.fact_id ? `[${f.fact_id}] ` : "";
      const ch = typeof f.chapter === "number" ? `（第${f.chapter}章）` : "";
      return `- ${tag}${f.content_clean}${ch}`;
    });
    const summary = items.map((item) => item).join("\n");
    parts.push(P.FACTS_USER_EXISTING_HINT.replace("{existing_summary}", summary));
  }

  const charBlock = buildCharacterInfoBlock(cast_registry, character_aliases, language);
  if (charBlock) parts.push(charBlock);

  return {
    systemMessage: { role: "system", content: systemContent },
    userMessage: { role: "user", content: parts.join("") },
  };
}
