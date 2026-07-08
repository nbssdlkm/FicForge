// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * M9 ReAct 事实提取 dispatch。复用 runAgentLoop（spec §9：harness「复用 + stub」——
 * 6 个 AgentLoopConfig 字段 harness 本体不读，给 stub 即可；M9 全部工具执行写在自己的
 * onForceToolPath 里）。
 *
 * 循环（reason→act→observe）：
 *   propose_facts        → rawToExtracted 转 ExtractedFact 暂存（复用单次调用的成熟转换）
 *   search_existing_facts → 本地过滤已加载事实，返回真实 fact_id
 *   annotate_fact        → 给暂存事实填 caused_by（跨章）+ thread_ids（挂线）
 *   finalize_extraction  → 显式终止（codex 二审 BLOCKER-1：不靠纯文本当完成信号）
 *
 * 防幻觉（替代 spec verify_fact 状态机；codex 二审 MAJOR-4）：
 *   - annotate 的 caused_by_fact_ids 过滤到真实存在的 fact_id、thread_ids 过滤到真实
 *     剧情线 id —— 凭空编造的直接丢，不进 LLM 循环。
 *   - annotate 只接受「已 grounded」的事实：propose 时必须给一段能在本章原文逐字匹配
 *     的 evidence，否则拒绝挂 caused_by/thread_ids（不把因果/剧情线挂到幻觉事实上）。
 *
 * 返回 { facts, status }（codex 二审 MAJOR-3）：status="ok" 表示 LLM 干净收尾（哪怕
 * 0 事实也是合法空结果，不该回退单次调用）；status="degraded" 表示 abort / 错误 /
 * maxIter 未收尾。wrapper 只在 degraded 且空时 fallback 单次调用。
 */

import type { LLMProvider, Message, ToolCall } from "../llm/provider.js";
import type { Fact, FactFieldConfidence } from "../domain/fact.js";
import type { Thread } from "../domain/thread.js";
import type { FactRepository } from "../repositories/interfaces/fact.js";
import type { ThreadRepository } from "../repositories/interfaces/thread.js";
import { runAgentLoop, type AgentLoopConfig, type IterContext } from "./agent_loop.js";
import { repairAndValidateToolArgs } from "./tool_args_repair.js";
import { createTelemetry, type TelemetrySink } from "./agent_telemetry.js";
import { rawToExtracted, type ExtractedFact } from "./facts_extraction.js";
import { buildExtractionMessages, REACT_MAX_FACTS_PER_CHAPTER, type ExistingFactForContext } from "./react_extraction_context.js";
import {
  EXTRACTION_TOOLS,
  EXTRACTION_TOOL_SCHEMAS,
  EXTRACTION_TOOL_PATH_FIELDS,
  REACT_TOOL_SEARCH,
  REACT_TOOL_PROPOSE,
  REACT_TOOL_ANNOTATE,
  REACT_TOOL_FINALIZE,
} from "./react_extraction_tools.js";
import { executeSearchExistingFacts } from "./react_extraction_search.js";

const REACT_AGENT_NAME = "react_extraction";

/**
 * ReAct 提取最大迭代轮数（PD-2）。仿 SIMPLE_AGENT_MAX_ITER=5 的既有常量模式。
 * 8 轮：propose×1 + search×1~2 + annotate×1~3（多事实分别挂边）+ finalize×1，留余量。
 * 真 LLM 实测会偶尔多走一两轮（重复 propose 被 steer 回正轨），8 给足空间。
 */
export const REACT_EXTRACTION_MAX_ITER = 8;

export type ReactExtractStatus = "ok" | "degraded";

export interface ReactExtractResult {
  facts: ExtractedFact[];
  /** ok=LLM 干净收尾（finalize / 纯文本终止）；degraded=abort / 错误 / maxIter 未收尾。 */
  status: ReactExtractStatus;
  /**
   * L16（审计第二轮）：本章因 REACT_MAX_FACTS_PER_CHAPTER 软上限被丢弃的提议条数（跨所有
   * propose 调用累计）。backfill 自动落库路径据此告知用户「某章命中上限、部分笔记未收」，
   * 否则截断在结果计数里完全隐形。0 = 未触发上限。
   */
  cappedCount: number;
}

export interface ReactExtractOptions {
  language?: "zh" | "en";
  signal?: AbortSignal;
  /** 提供则 search_existing_facts 可检索；不提供则 search 恒返回空，loop 自然跳过 annotate caused_by。 */
  factRepo?: FactRepository;
  /** 提供则把可用剧情线列进 system prompt，annotate 可挂线；不提供则无 thread 分配。 */
  threadRepo?: ThreadRepository;
  /** factRepo / threadRepo 的 AU 路径键。 */
  auPath?: string;
  /** 覆盖最大迭代轮数（默认 REACT_EXTRACTION_MAX_ITER）。 */
  maxIter?: number;
  /** 测试注入 telemetry。 */
  _telemetry_override?: TelemetrySink;
}

// 提取专用固定生成参数（低温聚焦任务）。max_tokens 给 8000 而非单次调用的 2000：
// reasoning 模型（如 deepseek-v4-pro）会先花大量 token 在 reasoning_content 上，2000 会把
// 后面的 tool-call JSON 截断（实测 v4-pro 在 598 字符处被切、propose args 不完整 → 0 事实）。
// 8000 给推理 + 工具输出留足空间；非 reasoning 模型（v4-flash）正常 finalize，不会用满。
const EXTRACT_GEN_PARAMS = { max_tokens: 8000, temperature: 0.3, top_p: 0.95 } as const;

/** grounding 用：去空白 + 小写，让 evidence 跨换行 / 大小写仍能逐字匹配。 */
function normalizeForMatch(s: string): string {
  return s.replace(/\s+/g, "").toLowerCase();
}

/**
 * H10（审计第二轮）：为 ReAct propose 的 M8-A 富化字段合成 per-field _confidence=medium。
 *
 * 为什么需要：P3 注入门控 buildFactEnrichmentSuffix 要求 fact._confidence 存在且对应
 * 字段 ≥ medium 才注入。单次调用路径的 prompt 要求 LLM 自评 _confidence；而 ReAct 的
 * proposeFactItemSchema 不含 _confidence（zod 剥离未知键）、system prompt 也不要求——
 * 结果 known_to / time_kind / action_verb / location / suspense_type 落库后全部被门控
 * 静默丢弃，M8-A 富化在默认（ReAct）路径下永不生效。
 *
 * 为什么是 medium：ReAct 是结构化工具输出，这些字段全部 optional、模型显式填写才出现
 * （不填无惩罚），不是自由文本里顺嘴猜的——可信度语义与单次调用路径 LLM 自评 medium 对齐。
 *
 * 语义约定：
 * - 只给「实际出现」的字段合成（null / undefined / 空数组不算，与门控的非空判定对齐）；
 * - merge 不 replace：已有的 per-field 置信度一律保留（grounding 逻辑标的 caused_by=low、
 *   宽松解析 fallback 路径 LLM 自带的 _confidence 都不被覆盖）；
 * - 富化字段全空 → 不凭空造 _confidence（保持 undefined：门控 `!c` 短路语义等价，
 *   且不给 facts.jsonl 添冗余空对象）；
 * - caused_by 不在合成范围：其置信度由 grounding 逻辑专管（未 grounded 标 low；grounded
 *   不标——门控把 caused_by 列为低价值不注入，合成 medium 只会误导 UI 高亮）；
 * - hidden_from / story_time_tag / story_time_order 门控目前不读，但一并合成，保持
 *   「字段出现即有置信度」的不变量，未来门控扩展时不再漏。
 */
/** 字符串字段「实际出现」= 非空白文本。`""`/纯空格若拿到 medium，门控对
 * location/action_verb 无非空检查，会把 `location: `（空值）注进 prompt（对抗审 C-1）。 */
function hasText(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

function synthesizeEnrichmentConfidence(fact: ExtractedFact): void {
  const synth: FactFieldConfidence = {};
  if (hasText(fact.location)) synth.location = "medium";
  if (hasText(fact.story_time_tag)) synth.story_time_tag = "medium";
  if (typeof fact.story_time_order === "number") synth.story_time_order = "medium";
  if (fact.time_kind != null) synth.time_kind = "medium";
  if (hasText(fact.action_verb)) synth.action_verb = "medium";
  if (hasText(fact.known_to) || (Array.isArray(fact.known_to) && fact.known_to.length > 0)) {
    synth.known_to = "medium";
  }
  if (Array.isArray(fact.hidden_from) && fact.hidden_from.length > 0) synth.hidden_from = "medium";
  if (fact.suspense_type != null) synth.suspense_type = "medium";
  if (Object.keys(synth).length === 0) return;
  // 后展开已有值 → 已有键赢（merge 不 replace）
  fact._confidence = { ...synth, ...(fact._confidence ?? {}) };
}

function repairExtractionArgs(toolName: string, rawArgs: string): {
  args: Record<string, unknown>;
  success: boolean;
  retryHint?: string;
  repairs: { field: (string | number)[]; kind: string }[];
} {
  const schema = EXTRACTION_TOOL_SCHEMAS[toolName];
  const pathFields = EXTRACTION_TOOL_PATH_FIELDS[toolName];
  if (!schema) {
    return { args: {}, success: false, repairs: [], retryHint: `注意：未知工具 ${toolName}。` };
  }
  const r = repairAndValidateToolArgs(toolName, rawArgs, schema, { pathFields });
  return {
    args: r.success ? (r.data as Record<string, unknown>) : {},
    success: r.success,
    retryHint: r.retryHint,
    repairs: r.repairs.map((x) => ({ field: x.field, kind: x.kind })),
  };
}

/**
 * 跑 ReAct 提取循环，返回带 caused_by / thread_ids 的 ExtractedFact[] + status。
 * 永不抛异常（abort / 错误返回已提议的部分结果，status=degraded）。
 */
export async function reactExtractFromChapter(
  chapter_text: string,
  chapter_num: number,
  existing_facts: { content_clean?: string }[],
  cast_registry: { characters?: string[] },
  character_aliases: Record<string, string[]> | null,
  llm_provider: LLMProvider,
  opts: ReactExtractOptions = {},
): Promise<ReactExtractResult> {
  const language = opts.language ?? "zh";
  const telemetry = opts._telemetry_override ?? createTelemetry();
  const maxIter = opts.maxIter ?? REACT_EXTRACTION_MAX_ITER;

  if (!chapter_text.trim()) return { facts: [], status: "ok", cappedCount: 0 };

  // --- 一次性加载 search / thread 数据（spec R5：不在每次 search 打 repo）---
  let allFacts: Fact[] = [];
  let threads: Thread[] = [];
  if (opts.factRepo && opts.auPath) {
    try { allFacts = await opts.factRepo.list_all(opts.auPath); } catch { allFacts = []; }
  }
  if (opts.threadRepo && opts.auPath) {
    try { threads = await opts.threadRepo.list(opts.auPath); } catch { threads = []; }
  }
  const knownFactIds = new Set(allFacts.map((f) => f.id));
  const knownThreadIds = new Set(threads.map((t) => t.id));
  const normChapter = normalizeForMatch(chapter_text);

  // 上下文展示的已有事实：有 repo 时用更早章节的近 20 条（带 fact_id，供 propose 内联 caused_by）；
  // 无 repo 时退回调用方传的 content_clean 摘要（无 id）。
  const existingForContext: ExistingFactForContext[] = allFacts.length > 0
    ? [...allFacts]
        .filter((f) => typeof f.chapter !== "number" || f.chapter < chapter_num)
        .sort((a, b) => (b.chapter ?? 0) - (a.chapter ?? 0))
        .slice(0, 20)
        .map((f) => ({ fact_id: f.id, content_clean: f.content_clean, chapter: f.chapter }))
    : existing_facts.map((f) => ({ content_clean: f.content_clean ?? "" }));

  // --- 暂存：proposedFacts 是闭包累加器；fact_index 即此数组下标。grounded 平行记录
  //     每条是否通过 evidence 子串校验（决定能否挂 caused_by/thread_ids）---
  const proposedFacts: ExtractedFact[] = [];
  const grounded: boolean[] = [];
  const seenContent = new Set<string>(); // dedupe：normalized content_clean，防真 LLM 反复 re-propose 同一事实
  let proposeCallCount = 0;              // 真 LLM 实测会反复 propose 不前进；据此 steer 向 search/finalize
  let status: ReactExtractStatus = "degraded"; // 悲观默认；干净收尾才升 ok
  let totalCappedCount = 0;              // L16：跨所有 propose 调用累计的软上限丢弃条数（透传给 backfill）

  const emitRepairs = (toolName: string, repaired: ReturnType<typeof repairExtractionArgs>) => {
    for (const r of repaired.repairs) {
      telemetry.emit({
        kind: "tool_input_repaired",
        agentName: REACT_AGENT_NAME,
        toolName,
        repairKind: r.kind as never,
        field: r.field,
      });
    }
    if (!repaired.success) {
      telemetry.emit({ kind: "tool_input_invalid", agentName: REACT_AGENT_NAME, toolName, remainingIssueCount: 0 });
    }
  };

  // --- 单个工具执行（返回给 LLM 的 tool result content 字符串）。finalize 不在此处理。---
  function executeTool(call: ToolCall): string {
    const name = call.function.name;
    const repaired = repairExtractionArgs(name, call.function.arguments);
    emitRepairs(name, repaired);
    // propose 走宽松解析（见下），repair 失败不在此 bail；其余工具参数无效就让 LLM 重试。
    if (name !== REACT_TOOL_PROPOSE && !repaired.success) {
      return repaired.retryHint ?? `注意：工具 ${name} 参数无效，请重试。`;
    }
    const args = repaired.args;

    if (name === REACT_TOOL_SEARCH) {
      const hits = executeSearchExistingFacts(
        allFacts,
        { query: String(args.query ?? ""), characters: args.characters as string[] | undefined, limit: args.limit as number | undefined },
        chapter_num,
      );
      return JSON.stringify({
        results: hits,
        next_step: language === "en"
          ? "If a result is the cause of a proposed fact, call annotate_fact with that fact_id in caused_by_fact_ids. When all causality/storylines are set, call finalize_extraction."
          : "若某条结果是某提议事实的成因，调用 annotate_fact 把它的 fact_id 填进 caused_by_fact_ids。因果/剧情线都标完后调用 finalize_extraction 结束。",
      });
    }

    if (name === REACT_TOOL_PROPOSE) {
      proposeCallCount++;
      // 宽松取 facts：repair 成功用其结果；失败（某条 enrichment 形状 union/nested-null 不符）退回裸
      // JSON.parse，逐条交 rawToExtracted 归一化——一条坏字段不该拖死整批（codex 二审 MAJOR）。
      let items: Record<string, unknown>[] = [];
      if (repaired.success && Array.isArray((repaired.args as { facts?: unknown }).facts)) {
        items = (repaired.args as { facts: Record<string, unknown>[] }).facts;
      } else {
        try {
          const parsed = JSON.parse(call.function.arguments || "{}") as { facts?: unknown };
          if (parsed && typeof parsed === "object" && Array.isArray(parsed.facts)) {
            items = parsed.facts as Record<string, unknown>[];
          }
        } catch { /* leave empty */ }
      }
      const acceptedIndices: number[] = [];
      let dupCount = 0;
      let cappedCount = 0;
      for (const raw of items) {
        const fact = rawToExtracted(raw, chapter_num, character_aliases);
        if (!fact) continue;
        // 软上限兜底：一章最多 REACT_MAX_FACTS_PER_CHAPTER 条（prompt 已引导少而精，cap 防失控）。
        if (proposedFacts.length >= REACT_MAX_FACTS_PER_CHAPTER) { cappedCount++; totalCappedCount++; continue; }
        // dedupe：同一 normalized content_clean 只收一次（真 LLM 会跨轮 re-propose）。
        const key = normalizeForMatch(fact.content_clean);
        if (seenContent.has(key)) { dupCount++; continue; }
        seenContent.add(key);
        // grounding：evidence 标准化后须 >=4 字符且在本章原文出现（防单字/标点绕过——codex 二审 MAJOR）。
        const evNorm = typeof raw.evidence === "string" ? normalizeForMatch(raw.evidence) : "";
        const isGrounded = evNorm.length >= 4 && normChapter.includes(evNorm);
        // 内联 thread_ids（归属/分类，不需 grounding——真 LLM 不肯走单独 annotate 步，故在 propose 收）。
        if (Array.isArray(raw.thread_ids)) {
          const kept = (raw.thread_ids as unknown[]).filter((t): t is string => typeof t === "string" && knownThreadIds.has(t));
          if (kept.length) fact.thread_ids = kept;
        }
        // 内联 caused_by（因果断言）：target fact_id 必须真实存在（knownFactIds 过滤防编造）。
        // grounding 不再「门控丢弃」（实测真 LLM 不肯写 evidence，会把功能压没）——改「flag」：
        // 未 grounded 的因果边仍挂上，但标 _confidence.caused_by=low 供人工确认时重点核（PD-5 人审兜底）。
        if (Array.isArray(raw.caused_by_fact_ids)) {
          const kept = (raw.caused_by_fact_ids as unknown[]).filter((id): id is string => typeof id === "string" && knownFactIds.has(id));
          if (kept.length) {
            fact.caused_by = kept;
            if (!isGrounded) fact._confidence = { ...(fact._confidence ?? {}), caused_by: "low" };
          }
        }
        // H10：出现的富化字段合成 _confidence=medium（不覆盖上面 grounding 标的 caused_by=low），
        // 否则 P3 注入门控 buildFactEnrichmentSuffix 会把 ReAct 提取的富化字段全部静默丢弃。
        synthesizeEnrichmentConfidence(fact);
        proposedFacts.push(fact);
        grounded.push(isGrounded);
        acceptedIndices.push(proposedFacts.length - 1);
      }
      // steer：真 LLM 实测会反复 propose 不前进。propose 后强引导去 search/annotate/finalize；
      // 重复 propose（proposeCallCount≥2）措辞更硬。
      const firm = proposeCallCount >= 2
        ? (language === "en" ? "STOP proposing — you have already proposed facts. " : "停止 propose——你已经提议过事实了。")
        : "";
      const nextStep = firm + (language === "en"
        ? "DO NOT call propose_facts again. If you already filled caused_by_fact_ids / thread_ids inline, just call finalize_extraction. Only if a fact's cause was NOT in the existing-facts list, use search_existing_facts then annotate_fact, then finalize_extraction."
        : "不要再调用 propose_facts。若 caused_by_fact_ids / thread_ids 已在 propose 里填好，直接调用 finalize_extraction。只有某条事实的成因不在上方已有事实列表时，才用 search_existing_facts 再 annotate_fact，然后 finalize_extraction。");
      return JSON.stringify({
        accepted_indices: acceptedIndices,
        count: acceptedIndices.length,
        ...(dupCount > 0 ? { ignored_duplicates: dupCount } : {}),
        ...(cappedCount > 0 ? { ignored_over_cap: cappedCount, cap: REACT_MAX_FACTS_PER_CHAPTER } : {}),
        next_step: nextStep,
      });
    }

    if (name === REACT_TOOL_ANNOTATE) {
      const idx = typeof args.fact_index === "number" ? args.fact_index : -1;
      if (idx < 0 || idx >= proposedFacts.length) {
        return JSON.stringify({ error: "fact_index out of range", valid_range: `0..${proposedFacts.length - 1}` });
      }
      const target = proposedFacts[idx];
      const applied: { caused_by?: string[]; thread_ids?: string[]; dropped_caused_by?: string[]; dropped_thread_ids?: string[] } = {};

      if (Array.isArray(args.caused_by_fact_ids)) {
        const requested = (args.caused_by_fact_ids as unknown[]).filter((x): x is string => typeof x === "string");
        const kept = requested.filter((id) => knownFactIds.has(id));
        const dropped = requested.filter((id) => !knownFactIds.has(id));
        // merge 而非覆盖：分多次 annotate 同一 fact 不丢前值（codex 二审 MAJOR）。
        const merged = [...new Set([...(target.caused_by ?? []), ...kept])];
        target.caused_by = merged;
        applied.caused_by = merged;
        if (dropped.length) applied.dropped_caused_by = dropped;
        // 同 inline：未 grounded 的因果边标 low confidence（不丢，人审兜底）。
        if (kept.length && !grounded[idx]) target._confidence = { ...(target._confidence ?? {}), caused_by: "low" };
      }
      if (Array.isArray(args.thread_ids)) {
        const requested = (args.thread_ids as unknown[]).filter((x): x is string => typeof x === "string");
        const kept = requested.filter((id) => knownThreadIds.has(id));
        const dropped = requested.filter((id) => !knownThreadIds.has(id));
        const merged = [...new Set([...(target.thread_ids ?? []), ...kept])];
        target.thread_ids = merged;
        applied.thread_ids = merged;
        if (dropped.length) applied.dropped_thread_ids = dropped;
      }
      return JSON.stringify({ ok: true, ...applied });
    }

    return JSON.stringify({ error: `unknown tool ${name}` });
  }

  // --- 一批 tool call 执行 + 注 internalHistory（harness 不代劳；含 thinking reasoning_content）。
  //     finalize 不执行业务、不需 tool result，但仍需进 assistant.tool_calls 保协议完整。---
  function runToolBatch(calls: ToolCall[], ctx: IterContext): void {
    ctx.internalHistory.push({
      role: "assistant",
      content: ctx.fullText,
      tool_calls: calls,
      ...(ctx.reasoningContent ? { reasoning_content: ctx.reasoningContent } : {}),
    });
    for (const c of calls) {
      if (opts.signal?.aborted) throw new DOMException("aborted", "AbortError");
      if (c.function.name === REACT_TOOL_FINALIZE) {
        // 终止信号：给个空 ack（协议要求每个 tool_call 有 result），不跑业务。
        ctx.internalHistory.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify({ ok: true }) });
        continue;
      }
      const content = executeTool(c);
      ctx.internalHistory.push({ role: "tool", tool_call_id: c.id, content });
    }
  }

  // 6 字段 stub：harness 本体不读（spec §9 + codex 二审实测确认）；给最小值满足结构类型。
  const config: AgentLoopConfig<never> = {
    agentName: REACT_AGENT_NAME,
    maxIter,
    tools: EXTRACTION_TOOLS,
    toolChoice: "auto",
    zodSchemas: EXTRACTION_TOOL_SCHEMAS,
    pathFields: EXTRACTION_TOOL_PATH_FIELDS,
    isReadOnlyTool: () => false,
    isMutatingTool: () => false,
    executeReadTool: async () => ({ content: "" }),

    onForceToolPath: async (calls, ctx) => {
      runToolBatch(calls, ctx);
      // 显式终止：本批含 finalize → 干净收尾。
      if (calls.some((c) => c.function.name === REACT_TOOL_FINALIZE)) {
        status = "ok";
        return { mode: "terminal", events: [] };
      }
      return { mode: "continue" };
    },

    // 纯文本 = 终止（LLM 没按约定调 finalize）。若 provider 返回 stop 时仍带 tool（罕见）先执行掉。
    onTextPathTerminal: async (ctx) => {
      if (ctx.hasTools && ctx.toolCalls.length > 0) {
        runToolBatch(ctx.toolCalls, ctx);
        if (ctx.toolCalls.some((c) => c.function.name === REACT_TOOL_FINALIZE)) {
          status = "ok";
          return [];
        }
      }
      // 没调 finalize 的纯文本收尾：有结果记 ok（inline 已挂边，事实完整）；空结果记 degraded →
      // wrapper 回退单次调用兜底（codex 二审 BLOCKER：别把空手收尾当成功吞掉）。
      status = proposedFacts.length > 0 ? "ok" : "degraded";
      return [];
    },

    // 防过早收尾：没提议任何事实前掰回 propose；已有事实但纯文本收尾时提醒先补
    // caused_by/thread_ids 再 finalize（codex 二审 BLOCKER-1）。harness 给 2 次重试。
    onGuardRetry: (_kind) => {
      if (proposedFacts.length === 0) {
        return {
          role: "user",
          content: language === "en"
            ? "[system note] You haven't proposed any facts yet. Call the propose_facts tool with the facts you found, not plain text."
            : "[系统提示] 你还没有提议任何事实。请调用 propose_facts 工具提交你发现的事实，而不是用纯文本回复。",
        };
      }
      return {
        role: "user",
        content: language === "en"
          ? "[system note] Before finishing: if any fact is caused by an earlier chapter, use search_existing_facts then annotate_fact; if any fact belongs to a listed storyline, set its thread_ids via annotate_fact. When truly done, call finalize_extraction (do not finish with plain text)."
          : "[系统提示] 结束前确认：若有事实承接前文，先 search_existing_facts 再 annotate_fact 补 caused_by；若有事实属于上方剧情线，用 annotate_fact 填 thread_ids。都补完后调用 finalize_extraction 结束（不要用纯文本结束）。",
      };
    },

    telemetry,
  };

  const { systemMessage, userMessage } = buildExtractionMessages({
    chapter_text,
    chapter_num,
    existing_facts: existingForContext,
    cast_registry,
    character_aliases,
    threads,
    language,
  });
  const startMessages: Message[] = [systemMessage, userMessage];

  try {
    // drain：结果在 proposedFacts 闭包里。观察 max_iter_reached 保持 degraded。
    for await (const ev of runAgentLoop(config, llm_provider, startMessages, EXTRACT_GEN_PARAMS, opts.signal)) {
      if (ev.type === "max_iter_reached") status = "degraded";
      // empty_response_terminal / declared_tools_but_empty_terminal：协议异常，保持 degraded。
    }
  } catch {
    // abort / LLM 错误：吞掉，返回已提议的部分结果（status 保持 degraded）。
    status = "degraded";
  }

  return { facts: proposedFacts, status, cappedCount: totalCappedCount };
}
