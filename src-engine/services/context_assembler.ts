// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 上下文组装器。参见 PRD §4.1。
 *
 * 六层结构 P0-P5，按优先级截断，reversed 后注入。
 * 收集顺序 P1→P3→thread→P2→P4→P5，reversed 后 P5→P4→P2→thread→P3→P1。
 * （thread = 剧情线摘要层，M8-B；空线时为 ""，filter 后逐字节回退到无该层。）
 */

import type { BudgetReport } from "../domain/budget_report.js";
import { createBudgetReport } from "../domain/budget_report.js";
import type { ContextSummary } from "../domain/context_summary.js";
import { createContextSummary } from "../domain/context_summary.js";
import { FactStatus, NarrativeWeight, ThreadStatus } from "../domain/enums.js";
import type { Fact, ConfidenceLevel } from "../domain/fact.js";
import type { Thread } from "../domain/thread.js";
import { get_context_window, get_model_max_output } from "../domain/model_context_map.js";
import type { Project } from "../domain/project.js";
import type { State } from "../domain/state.js";
import { count_tokens, ensureTokenizer } from "../tokenizer/index.js";
import { getPrompts } from "../prompts/index.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import type { VectorRepository } from "../repositories/interfaces/vector.js";
import type { EmbeddingProvider } from "../llm/embedding_provider.js";
import type { Message } from "../llm/provider.js";
import { retrieveRagForContext } from "./rag_retrieval.js";

// ---------------------------------------------------------------------------
// 辅助：token 计数
// ---------------------------------------------------------------------------

function _count(text: string, llm_config: unknown): { count: number; is_estimate: boolean } {
  return count_tokens(text, llm_config as { mode?: string } | undefined);
}

// ===========================================================================
// build_system_prompt（P0 + 规则）
// ===========================================================================

export function build_system_prompt(
  project: Project,
  trim_custom = false,
  language = "zh",
): string {
  const P = getPrompts(language as "zh" | "en");
  const parts: string[] = [P.SYSTEM_NOVELIST];

  // --- P0 Pinned Context ---
  const pinned = project.pinned_context ?? [];
  if (pinned.length > 0) {
    const lines = pinned.map((p) => `- ${p}`).join("\n");
    parts.push(P.PINNED_CONTEXT_HEADER.replace("{lines}", lines));
  }

  // --- 冲突解决规则 ---
  parts.push(P.CONFLICT_RESOLUTION_RULES);

  // --- 叙事视角 ---
  const ws = project.writing_style;
  const pVal = ws?.perspective ?? "third_person";

  if (pVal === "first_person") {
    const pov = ws?.pov_character || (language === "zh" ? "主角" : "protagonist");
    parts.push(P.PERSPECTIVE_FIRST_PERSON.split("{pov}").join(pov));
  } else {
    parts.push(P.PERSPECTIVE_THIRD_PERSON);
  }

  // --- 情感风格 ---
  const eVal = ws?.emotion_style ?? "implicit";
  if (eVal === "explicit") {
    parts.push(P.EMOTION_EXPLICIT);
  } else {
    parts.push(P.EMOTION_IMPLICIT);
  }

  // --- 伏笔规约 ---
  parts.push(P.FORESHADOWING_RULES);

  // --- 通用规则 ---
  const chapterLength = project.chapter_length ?? 1500;
  const chapterLengthMax = Math.trunc(chapterLength * 1.3);
  parts.push(
    P.GENERIC_RULES
      .replace("{chapter_length}", String(chapterLength))
      .replace("{chapter_length_max}", String(chapterLengthMax)),
  );

  // --- custom_instructions ---
  if (!trim_custom) {
    const custom = ws?.custom_instructions ?? "";
    if (custom) {
      parts.push(P.CUSTOM_INSTRUCTIONS_HEADER.replace("{custom}", custom));
    }
  }

  return parts.join("\n\n");
}

// ===========================================================================
// build_instruction（P1 当前指令）
// ===========================================================================

export function build_instruction(
  state: State,
  user_input: string,
  facts: Fact[],
  language = "zh",
  chapter_length = 0,
): string {
  const P = getPrompts(language as "zh" | "en");
  const parts: string[] = [];

  // 当前状态行
  const currentCh = state.current_chapter ?? 1;
  const lastEnding = state.last_scene_ending ?? "";
  parts.push(P.CURRENT_STATUS.replace("{current_ch}", String(currentCh)));
  if (lastEnding) {
    parts.push(P.LAST_ENDING_INLINE.replace("{last_ending}", lastEnding));
  }

  // chapter_focus 分支
  const focusIds = state.chapter_focus ?? [];
  const focusFacts = focusIds.length > 0 ? facts.filter((f) => focusIds.includes(f.id)) : [];

  if (focusFacts.length > 0) {
    // 推进目标块
    const focusLines = focusFacts.map((f) => `- ${f.content_clean}`).join("\n");
    parts.push(P.FOCUS_GOAL_HEADER);
    parts.push(P.FOCUS_GOAL_DEFINITION.replace("{focus_lines}", focusLines));

    // 本章特别注意（非 focus 的高权重 unresolved，最多 2 条）
    const nonFocusUnresolved = facts.filter(
      (f) =>
        !focusIds.includes(f.id) &&
        f.status === FactStatus.UNRESOLVED &&
        f.narrative_weight === NarrativeWeight.HIGH,
    );
    if (nonFocusUnresolved.length > 0) {
      const cautionLines = nonFocusUnresolved
        .slice(0, 2)
        .map((f) => `- ${f.content_clean}`)
        .join("\n");
      parts.push(P.ATTENTION_HEADER);
      parts.push(P.ATTENTION_BODY.replace("{caution_lines}", cautionLines));
    }

    // 背景信息使用规则
    parts.push(P.BG_RULES);
  } else if (facts.some((f) => f.status === FactStatus.UNRESOLVED)) {
    // 铺陈指令
    parts.push(P.PACING_INSTRUCTION);
  }

  // 用户输入
  parts.push(P.CONTINUE_WRITING.replace("{user_input}", user_input));

  // 字数提醒
  if (chapter_length) {
    parts.push(P.WORD_COUNT_REMINDER.replace("{chapter_length}", String(chapter_length)));
  }

  return parts.join("\n\n");
}

// ===========================================================================
// buildFactEnrichmentSuffix（M8-A P3 注入辅助，纯函数）
// ===========================================================================

/**
 * 根据 _confidence 构建 fact 行的括号内补充字符串。
 * 规则（spec §七）：
 *   - 无 _confidence → 返回 ""（不注入任何新字段）
 *   - confidence >= medium 才注入对应字段
 *   - 高价值：known_to（非 null）、time_kind（非 normal）、action_verb
 *   - 中价值：location、suspense_type
 *   - 低价值（不注入）：story_time_tag、story_time_order、caused_by、hidden_from
 */
export function buildFactEnrichmentSuffix(fact: Fact): string {
  const c = fact._confidence;
  if (!c) return "";

  const INJECT_LEVELS = new Set<ConfidenceLevel>(["high", "medium"]);
  const parts: string[] = [];

  // known_to（高价值）：[] 空数组不注入（无信息量，避免渲染 "known_to: "）
  if (fact.known_to != null && INJECT_LEVELS.has(c.known_to!)) {
    const isNonEmptyArray = Array.isArray(fact.known_to) && fact.known_to.length > 0;
    const isString = typeof fact.known_to === "string";
    if (isString || isNonEmptyArray) {
      const v = Array.isArray(fact.known_to) ? fact.known_to.join(", ") : fact.known_to;
      parts.push(`known_to: ${v}`);
    }
  }

  // time_kind（高价值；normal 无信息量，跳过）
  if (
    fact.time_kind != null &&
    fact.time_kind !== "normal" &&
    INJECT_LEVELS.has(c.time_kind!)
  ) {
    parts.push(`time_kind: ${fact.time_kind}`);
  }

  // action_verb（高价值）
  if (fact.action_verb != null && INJECT_LEVELS.has(c.action_verb!)) {
    parts.push(`action_verb: ${fact.action_verb}`);
  }

  // location（中价值）
  if (fact.location != null && INJECT_LEVELS.has(c.location!)) {
    parts.push(`location: ${fact.location}`);
  }

  // suspense_type（中价值）
  if (fact.suspense_type != null && INJECT_LEVELS.has(c.suspense_type!)) {
    parts.push(`suspense_type: ${fact.suspense_type}`);
  }

  if (parts.length === 0) return "";
  return ` (${parts.join("; ")})`;
}

// ===========================================================================
// build_facts_layer（P3 事实表）
// ===========================================================================

export function build_facts_layer(
  facts: Fact[],
  focus_ids: string[],
  budget_tokens: number,
  llm_config: unknown,
  language = "zh",
): [string, boolean] {
  const eligible = facts.filter(
    (f) =>
      (f.status === FactStatus.ACTIVE || f.status === FactStatus.UNRESOLVED) &&
      !focus_ids.includes(f.id) &&
      // M10-B: 冷 fact 不进 P3。旧 fact 无 archived 字段时 undefined !== true → 保留注入（向后兼容）
      f.archived !== true,
  );

  if (eligible.length === 0) return ["", false];

  const unresolved = eligible.filter((f) => f.status === FactStatus.UNRESOLVED);
  const active = eligible.filter((f) => f.status === FactStatus.ACTIVE);

  let softDegraded = false;

  // --- unresolved 软降级 ---
  const sortedUnresolved = sortByWeightAndRecency(unresolved);
  let unresolvedKept: Fact[] = [];
  let unresolvedDropped = 0;

  if (sortedUnresolved.length > 0) {
    // Budget includes both content_clean and the enrichment suffix that will be appended.
    const totalUrTokens = sortedUnresolved.reduce(
      (sum, f) => sum + _count(f.content_clean + buildFactEnrichmentSuffix(f), llm_config).count,
      0,
    );

    if (totalUrTokens <= budget_tokens) {
      unresolvedKept = sortedUnresolved;
    } else {
      softDegraded = true;
      let used = 0;
      for (const f of sortedUnresolved) {
        const t = _count(f.content_clean + buildFactEnrichmentSuffix(f), llm_config).count;
        if (used + t > budget_tokens) {
          unresolvedDropped++;
        } else {
          unresolvedKept.push(f);
          used += t;
        }
      }
    }
  }

  const remainingBudget =
    budget_tokens - unresolvedKept.reduce(
      (sum, f) => sum + _count(f.content_clean + buildFactEnrichmentSuffix(f), llm_config).count,
      0,
    );

  // --- active 截断 ---
  const activeKept: Fact[] = [];
  if (active.length > 0 && remainingBudget > 0) {
    const sortedActive = sortByWeightAndRecency(active);
    let used = 0;
    for (const f of sortedActive) {
      const t = _count(f.content_clean + buildFactEnrichmentSuffix(f), llm_config).count;
      if (used + t > remainingBudget) break;
      activeKept.push(f);
      used += t;
    }
  }

  // --- 合并并按 chapter 正序 ---
  const allKept = [...unresolvedKept, ...activeKept];
  allKept.sort((a, b) => a.chapter - b.chapter);

  const lines = allKept.map((f) => `- [${f.status}] ${f.content_clean}${buildFactEnrichmentSuffix(f)}`);

  if (unresolvedDropped > 0) {
    const P = getPrompts(language as "zh" | "en");
    lines.push(P.UNRESOLVED_DROPPED_HINT.replace("{count}", String(unresolvedDropped)));
  }

  if (lines.length === 0) return ["", softDegraded];

  const P = getPrompts(language as "zh" | "en");
  return [P.SECTION_PLOT_STATE + "\n" + lines.join("\n"), softDegraded];
}

function sortByWeightAndRecency(facts: Fact[]): Fact[] {
  const weightOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return [...facts].sort((a, b) => {
    const wa = weightOrder[a.narrative_weight] ?? 1;
    const wb = weightOrder[b.narrative_weight] ?? 1;
    if (wa !== wb) return wa - wb;
    return b.chapter - a.chapter;
  });
}

// ===========================================================================
// build_threads_layer（剧情线摘要层，M8-B）
// ===========================================================================

/**
 * 把活跃剧情线（status=active）的「当前进展」拼成一段注入文本。
 *
 * - 仅 active 线注入（resolved/dormant 不需要模型注意力）。
 * - 按 updated_at 倒序（最近推进的在前）。
 * - 预算截断：超预算丢尾部线（mirror build_facts_layer 截断语义）。
 * - 空 / 全非 active ⇒ 返回 ""（调用方 filter(Boolean) 后逐字节回退，golden 零回归）。
 *
 * 成员关系（哪些 Fact 属于线）的真相源是 fact.thread_ids，本函数不反查 fact，
 * 只读 thread.title + thread.state，避免双向状态（spec D1）。
 */
export function build_threads_layer(
  threads: Thread[],
  budget_tokens: number,
  llm_config: unknown,
  language = "zh",
): string {
  const active = threads
    .filter((t) => t.status === ThreadStatus.ACTIVE)
    // ?? "" 兜底：手编/损坏的 threads.jsonl 行可能缺 updated_at，localeCompare(undefined) 会抛
    .sort((a, b) => (b.updated_at ?? "").localeCompare(a.updated_at ?? ""));
  if (active.length === 0) return "";

  const lines: string[] = [];
  let used = 0;
  for (const t of active) {
    const stateText = (t.state?.trim() || t.description?.trim() || "");
    const line = stateText ? `- 【${t.title}】${stateText}` : `- 【${t.title}】`;
    const tk = _count(line, llm_config).count;
    if (used + tk > budget_tokens) break;   // 预算截断，丢尾部
    lines.push(line);
    used += tk;
  }
  if (lines.length === 0) return "";

  const P = getPrompts(language as "zh" | "en");
  return P.SECTION_PLOT_THREADS + "\n" + lines.join("\n");
}

// ===========================================================================
// build_recent_chapter_layer（P2 最近章节）
// ===========================================================================

export async function build_recent_chapter_layer(
  state: State,
  chapter_repo: ChapterRepository,
  au_id: string,
  budget_tokens: number,
  llm_config: unknown,
  language = "zh",
): Promise<string> {
  const P = getPrompts(language as "zh" | "en");
  const current = state.current_chapter ?? 1;
  if (current <= 1) return "";

  let content: string;
  try {
    content = await chapter_repo.get_content_only(au_id, current - 1);
  } catch {
    return "";
  }

  if (!content) return "";

  // 截断：保留末尾
  const tokens = _count(content, llm_config).count;
  if (tokens <= budget_tokens) {
    return P.SECTION_LAST_ENDING.replace("{content}", content);
  }

  // 从末尾截取，最少 500 字
  const minChars = 500;
  if (content.length <= minChars) {
    return P.SECTION_LAST_ENDING.replace("{content}", content);
  }

  let endText = content.slice(-minChars);
  while (_count(endText, llm_config).count < budget_tokens && endText.length < content.length) {
    endText = content.slice(-(endText.length + 200));
  }
  while (_count(endText, llm_config).count > budget_tokens && endText.length > minChars) {
    endText = endText.slice(200);
  }

  return P.SECTION_LAST_ENDING_TRUNCATED.replace("{end_text}", endText);
}

// ===========================================================================
// build_core_settings_layer（P5 核心设定）
// ===========================================================================

export function build_core_settings_layer(
  project: Project,
  character_files: Record<string, string> | null,
  budget_tokens: number,
  llm_config: unknown,
  language = "zh",
  worldbuilding_files: Record<string, string> | null = null,
): [string, string[], string[], string[]] {
  if (!character_files && !worldbuilding_files) return ["", [], [], []];

  const coreNames = new Set(project.core_always_include ?? []);
  const guarantee = project.core_guarantee_budget ?? 400;

  const charParts: string[] = [];
  const injected: string[] = [];
  const truncated: string[] = [];
  let used = 0;

  if (character_files) {
    // 先注入 core_always_include 角色（低保保护）
    for (const name of [...coreNames].sort()) {
      if (name in character_files) {
        const text = character_files[name];
        const t = _count(text, llm_config).count;
        if (used + t <= Math.max(budget_tokens, guarantee)) {
          charParts.push(`### ${name}\n${text}`);
          used += t;
          injected.push(name);
        } else {
          truncated.push(name);
        }
      }
    }

    // 再注入其他角色
    for (const [name, text] of Object.entries(character_files)) {
      if (coreNames.has(name)) continue;
      const t = _count(text, llm_config).count;
      if (used + t <= budget_tokens) {
        charParts.push(`### ${name}\n${text}`);
        used += t;
        injected.push(name);
      } else {
        truncated.push(name);
      }
    }
  }

  // 世界观注入
  const wbParts: string[] = [];
  const wbInjected: string[] = [];
  if (worldbuilding_files) {
    for (const [name, text] of Object.entries(worldbuilding_files)) {
      const t = _count(text, llm_config).count;
      if (used + t <= budget_tokens) {
        wbParts.push(`### ${name}\n${text}`);
        used += t;
        wbInjected.push(name);
      }
      // 世界观超预算静默跳过
    }
  }

  const allParts: string[] = [];
  const P = getPrompts(language as "zh" | "en");
  if (charParts.length > 0) {
    allParts.push(P.SECTION_CHARACTERS + "\n" + charParts.join("\n\n"));
  }
  if (wbParts.length > 0) {
    allParts.push(P.SECTION_WORLDBUILDING + "\n" + wbParts.join("\n\n"));
  }

  if (allParts.length === 0) return ["", injected, truncated, wbInjected];

  return [allParts.join("\n\n"), injected, truncated, wbInjected];
}

// ===========================================================================
// assemble_context 主函数
// ===========================================================================

export interface AssembleContextResult {
  messages: Message[];
  max_tokens: number;
  budget_report: BudgetReport;
  context_summary: ContextSummary;
}

/**
 * D-0039 输出预算单一真相源：maxTokens = min(模型输出上限, contextWindow×40%, 章节长×2, 15k 硬顶)。
 * 超长章节被 CEIL 夹断时打 warn。写文 assemble_context 与对话 assemble_chat_context 共用，避免
 * 15_000 字面量与 Math.min 公式两处手工维护漂移（D-0039 曾 rebalance 过一次，retune 时只需改这一处）。
 * @param logTag 日志前缀（"context_assembler" / "assemble_chat_context"）
 */
function computeMaxOutputTokens(project: Project, contextWindow: number, logTag: string): number {
  const OUTPUT_RESERVE_CEIL = 15_000;
  const modelName = project.llm?.model ?? "";
  const chapterLength = project.chapter_length ?? 1500;
  const chapterTokenCap = chapterLength ? chapterLength * 2 : Infinity;
  const maxTokens = Math.min(
    get_model_max_output(modelName),
    Math.trunc(contextWindow * 0.40),
    chapterTokenCap,
    OUTPUT_RESERVE_CEIL,
  );
  // 警告：超长章节被 CEIL 截断时打 warn，让用户感知
  if (chapterTokenCap !== Infinity && chapterTokenCap > OUTPUT_RESERVE_CEIL) {
    console.warn(
      `[${logTag}] chapter_length=${chapterLength} 对应 ${chapterTokenCap} tokens 超过 OUTPUT_RESERVE_CEIL=${OUTPUT_RESERVE_CEIL}，maxTokens 被夹至 ${maxTokens}，章节可能被 LLM 截断`,
    );
  }
  return maxTokens;
}

// D-0039 input budget 公式的两个余量常量（写文 / 对话两 assembler 共用，单一真相源）。
const OUTPUT_RESERVE_FLOOR = 10_000;
const SAFETY_BUFFER = 500;

/**
 * D-0039 input budget 单一真相源（写文 assemble_context 与对话 assemble_chat_context 共用）。
 *
 * 新公式 = contextWindow − 实际输出预留(max(maxTokens, FLOOR)) − systemTokens − SAFETY_BUFFER；
 * 旧 60% 公式（ctx×0.6 − system）作**下限兜底**，保证小模型不退步（D-0039 rebalance 记录）。
 *
 * 不在此钳零：写文路径靠返回值 ≤0 触发裁剪 custom_instructions 的 fail-safe 再重算；对话路径在
 * 外层自己套 Math.max(0, …)。把公式抽到这一处后，retune 只改这里，杜绝两 assembler 手抄漂移。
 */
export function computeInputBudget(
  contextWindow: number,
  systemTokens: number,
  maxOutputTokens: number,
): number {
  const reservedForOutput = Math.max(maxOutputTokens, OUTPUT_RESERVE_FLOOR);
  return Math.max(
    contextWindow - reservedForOutput - systemTokens - SAFETY_BUFFER,
    Math.trunc(contextWindow * 0.60) - systemTokens,
  );
}

export async function assemble_context(
  project: Project,
  state: State,
  user_input: string,
  facts: Fact[],
  chapter_repo: ChapterRepository,
  au_id: string,
  rag_results: string | null = null,
  character_files: Record<string, string> | null = null,
  worldbuilding_files: Record<string, string> | null = null,
  language = "zh",
  threads: Thread[] = [],
): Promise<AssembleContextResult> {
  // 融合（plan §1.3/§1.5）：原"simple 模式委托 assemble_context_simple"分支已删 —— 对话路径
  // 改走 assemble_chat_context（分层），写文路径恒走下面的 P0-P5 预算切分（逐字节不回归）。
  await ensureTokenizer();
  const llm = project.llm;
  const report = createBudgetReport();

  // --- context_window ---
  const contextWindow = get_context_window(project);
  report.context_window = contextWindow;

  // --- System prompt ---
  let systemPrompt = build_system_prompt(project, false, language);
  let sysTc = _count(systemPrompt, llm);
  let systemTokens = sysTc.count;
  report.is_fallback_estimate = sysTc.is_estimate;

  // --- max_tokens（D-0039；公式单一真相源见 computeMaxOutputTokens）---
  const chapterLength = project.chapter_length ?? 1500;
  const maxTokens = computeMaxOutputTokens(project, contextWindow, "context_assembler");
  report.max_output_tokens = maxTokens;

  // --- input budget（公式单一真相源见 computeInputBudget）---
  let budget = computeInputBudget(contextWindow, systemTokens, maxTokens);

  // fail-safe：budget 不够 → 裁剪 custom_instructions 重算
  if (budget <= 0) {
    systemPrompt = build_system_prompt(project, true, language);
    sysTc = _count(systemPrompt, llm);
    systemTokens = sysTc.count;
    budget = computeInputBudget(contextWindow, systemTokens, maxTokens);
  }

  if (budget <= 0) {
    throw new Error("system_prompt_exceeds_budget");
  }

  report.system_tokens = systemTokens;

  // --- core_guarantee_budget 预留 ---
  const guarantee = project.core_guarantee_budget ?? 400;

  let used = 0;
  const truncatedLayers: string[] = [];

  // === P1：当前指令（必须完整保留）===
  const focusIds = [...(state.chapter_focus ?? [])];
  const p1Text = build_instruction(state, user_input, facts, language, chapterLength);
  const p1Tokens = _count(p1Text, llm).count;
  used += p1Tokens;
  report.p1_tokens = p1Tokens;

  // === P3：事实表 ===
  const p3Budget = Math.max(0, budget - used - guarantee);
  const [p3Text, softDegraded] = build_facts_layer(facts, focusIds, p3Budget, llm, language);
  const p3Tokens = _count(p3Text, llm).count;
  used += p3Tokens;
  report.p3_tokens = p3Tokens;
  report.unresolved_soft_degraded = softDegraded;
  if (softDegraded) truncatedLayers.push("P3");

  // === 剧情线摘要层（M8-B）：P3 之后、P2 之前 ===
  // 空 threads ⇒ "" ⇒ thread_tokens=0、used 不变 ⇒ 后续 P2/P4/P5 预算逐字节不变。
  const threadBudget = Math.max(0, budget - used - guarantee);
  const threadText = build_threads_layer(threads, threadBudget, llm, language);
  const threadTokens = _count(threadText, llm).count;
  used += threadTokens;
  report.thread_tokens = threadTokens;

  // === P2：最近章节 ===
  const p2Budget = Math.max(0, budget - used - guarantee);
  const p2Text = await build_recent_chapter_layer(state, chapter_repo, au_id, p2Budget, llm, language);
  const p2Tokens = _count(p2Text, llm).count;
  if (p2Tokens > p2Budget && p2Budget > 0) truncatedLayers.push("P2");
  used += p2Tokens;
  report.p2_tokens = p2Tokens;

  // === P4：RAG ===
  let p4Text = rag_results ?? "";
  let p4Tokens = 0;
  if (p4Text) {
    p4Tokens = _count(p4Text, llm).count;
    const p4Budget = Math.max(0, budget - used - guarantee);
    if (p4Tokens > p4Budget) {
      p4Text = "";
      p4Tokens = 0;
      truncatedLayers.push("P4");
    }
    used += p4Tokens;
  }
  report.p4_tokens = p4Tokens;

  // === P5：核心设定（用剩余 budget，含低保）===
  const p5Budget = Math.max(guarantee, budget - used);
  const [p5Text, p5Injected, p5Truncated, p5WbInjected] = build_core_settings_layer(
    project,
    character_files,
    p5Budget,
    llm,
    language,
    worldbuilding_files,
  );
  const p5Tokens = _count(p5Text, llm).count;
  used += p5Tokens;
  report.p5_tokens = p5Tokens;
  if (p5Truncated.length > 0) truncatedLayers.push("P5_core_settings");

  // --- 汇总 ---
  report.total_input_tokens = systemTokens + used;
  report.budget_remaining = budget - used;
  report.truncated_layers = truncatedLayers;

  // --- ContextSummary 旁路收集（D-0031）---
  const summary = createContextSummary();
  try {
    summary.pinned_count = (project.pinned_context ?? []).length;

    for (const f of facts) {
      if (focusIds.includes(f.id)) {
        summary.facts_as_focus.push(f.content_clean.slice(0, 20));
      }
    }

    summary.facts_injected = p3Text.split("\n").filter((line) => line.startsWith("- [")).length;
    // M10-B: 统计被冷区过滤的 fact 数（旧 fact 无 archived 字段时 undefined !== true → 不计入）
    summary.facts_archived_count = facts.filter(
      (f) =>
        (f.status === FactStatus.ACTIVE || f.status === FactStatus.UNRESOLVED) &&
        f.archived === true,
    ).length;

    if (p4Text) {
      const ragContentLines = p4Text
        .split("\n")
        .filter((line) => line.trim() && !line.startsWith("### "));
      summary.rag_chunks_retrieved = ragContentLines.length;
    }

    summary.characters_used = p5Injected;
    summary.truncated_characters = p5Truncated;
    summary.worldbuilding_used = p5WbInjected;

    summary.total_input_tokens = systemTokens + used;
    summary.truncated_layers = [...truncatedLayers];
  } catch {
    // D-0031: 收集失败不影响生成流程
  }

  // --- 组装 messages ---
  // 收集顺序 P1→P3→thread→P2→P4→P5
  // reversed 后 P5→P4→P2→thread→P3→P1（threadText 空时 filter 滤掉，逐字节回退）
  const layers = [p1Text, p3Text, threadText, p2Text, p4Text, p5Text];
  const userParts = layers.reverse().filter(Boolean);
  const userContent = userParts.join("\n\n");

  const messages: Message[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ];

  return {
    messages,
    max_tokens: maxTokens,
    budget_report: report,
    context_summary: summary,
  };
}

/**
 * FicForge Lite 简版 system prompt — 对话式人设 + 意图分类 + 续写细则。
 *
 * 跟 build_system_prompt 区别：
 *  - 用 SIMPLE_CHAT_SYSTEM 替换 SYSTEM_NOVELIST + CONFLICT_RESOLUTION_RULES +
 *    FORESHADOWING_RULES + GENERIC_RULES（这些续写专属规则已融进 SIMPLE_CHAT_SYSTEM）
 *  - 保留 PINNED_CONTEXT（P0 铁律）+ 视角 / 情感 / custom_instructions（writing_style）
 *
 * 主仓库 build_system_prompt 0 改动（fork 隔离原则，D-0044）。
 */
export function build_system_prompt_simple(project: Project, language = "zh"): string {
  const P = getPrompts(language as "zh" | "en");
  const ws = project.writing_style;
  const chapterLength = project.chapter_length ?? 1500;
  const chapterLengthMax = Math.trunc(chapterLength * 1.3);

  const parts: string[] = [
    P.SIMPLE_CHAT_SYSTEM
      .replace("{chapter_length}", String(chapterLength))
      .replace("{chapter_length_max}", String(chapterLengthMax)),
  ];

  // P0 铁律（add_pinned_context 在简版仍有效，build_system_prompt:47-51 一致）
  const pinned = project.pinned_context ?? [];
  if (pinned.length > 0) {
    const lines = pinned.map((p) => `- ${p}`).join("\n");
    parts.push(P.PINNED_CONTEXT_HEADER.replace("{lines}", lines));
  }

  // 视角（update_writing_style 仍有效）
  const pVal = ws?.perspective ?? "third_person";
  if (pVal === "first_person") {
    const pov = ws?.pov_character || (language === "zh" ? "主角" : "protagonist");
    parts.push(P.PERSPECTIVE_FIRST_PERSON.split("{pov}").join(pov));
  } else {
    parts.push(P.PERSPECTIVE_THIRD_PERSON);
  }

  // 情感风格
  const eVal = ws?.emotion_style ?? "implicit";
  parts.push(eVal === "explicit" ? P.EMOTION_EXPLICIT : P.EMOTION_IMPLICIT);

  // custom_instructions
  const custom = ws?.custom_instructions ?? "";
  if (custom) {
    parts.push(P.CUSTOM_INSTRUCTIONS_HEADER.replace("{custom}", custom));
  }

  return parts.join("\n\n");
}

// ===========================================================================
// 对话式 × 记忆栈融合：assemble_chat_context — 分层对话上下文
// ===========================================================================

/**
 * 对话路径输入侧预留给「过去多轮历史」的预算系数与硬顶。
 *
 * 语义：assemble_chat_context 只组装 system（人设 + 记忆层）+ 最新一轮 user；
 * dispatch 把过去的对话历史夹在两者之间（[system, ...history, latestUser]）。历史
 * 不在此函数内做预算管控（"全塞"哲学：历史全带，超 ctx 由 LLM 报错），但记忆层若
 * 吃满整个 input budget 就没空间留给历史。于是从 budget 里先扣一份 chatHistoryReserve
 * （= budget×RATIO，封顶 CEIL），让记忆层只在 budget − reserve 内竞争。
 *
 * 最新轮硬保：最新一轮 user（latestUserContent）始终完整保留，先计入 used（类比完整
 * 模式 P1 当前指令），永不被预算裁剪；reserve 只压缩"记忆层"，不压缩最新轮。
 *
 * export 供 context_assembler.chat.test.ts 复算 memBudget 断言记忆层确实被压在 budget−reserve
 * 内（而非仅靠 core_guarantee 兜出 budget_remaining>0 —— 那是伪命题，抓不住 reserve 回归）。
 */
export const CHAT_HISTORY_RESERVE_RATIO = 0.30;
export const CHAT_HISTORY_RESERVE_CEIL = 12_000;

/** 对话路径分层组装产物契约。budget_report 必须保留（token badge 经 estimate 读它）。 */
export interface AssembleChatContextResult {
  /** system message 内容 = 对话人设 + 记忆层（facts/剧情线/上一章/RAG/核心设定）。 */
  systemContent: string;
  /** 最新一轮 user message 内容 = 当前章节状态 + 用户输入。 */
  latestUserContent: string;
  /** D-0039 输出预算（单一真相源 computeMaxOutputTokens）。 */
  max_tokens: number;
  /** 预算报告（token badge / 调试）。 */
  budget_report: BudgetReport;
  /** 旁路统计（D-0031 容错收集）。 */
  context_summary: ContextSummary;
}

export interface AssembleChatContextParams {
  project: Project;
  state: State;
  user_input: string;
  facts: Fact[];
  /** 活跃剧情线（M8-B）；省略 ⇒ 无剧情线注入。 */
  threads?: Thread[];
  chapter_repo: ChapterRepository;
  au_id: string;
  /** 预加载的角色设定文件（P5 核心设定）。 */
  character_files?: Record<string, string> | null;
  /** 预加载的世界观设定文件（P5 核心设定）。 */
  worldbuilding_files?: Record<string, string> | null;
  /**
   * 向量仓库 + embedding（RAG 检索用）。两者都给 → 内部走 retrieveRagForContext
   * 检索一次（单一真相源，与 generate_chapter 同函数）。任一缺省 ⇒ 跳过 RAG。
   * estimate token badge 路径【有意】不传，避免每次估算触发 embedding 调用。
   */
  vector_repo?: VectorRepository;
  embedding_provider?: EmbeddingProvider;
  /** 预计算 RAG 文本，传入（非 null）则跳过内部检索（与 generate_chapter 同款 gate）。 */
  rag_text?: string | null;
  language?: string;
}

/**
 * 分层对话上下文组装（融合 plan §1.2）。
 *
 * 与 assemble_context（完整写文路径）共用同一套 builder（build_facts_layer /
 * build_threads_layer / build_recent_chapter_layer / build_core_settings_layer）+
 * retrieveRagForContext，但：
 *  - system prompt 用对话人设 build_system_prompt_simple（不是续写体 build_system_prompt）。
 *  - 产物切成 systemContent（人设 + 记忆层）+ latestUserContent（最新轮），而不是单 user
 *    message —— 因为对话要 [system, ...history, latestUser]，记忆进 system 才不会随历史
 *    每轮重复。
 *  - 输入侧预留 chatHistoryReserve 给过去多轮历史。
 *
 * 记忆层降级优先级（plan §1.2）：facts > 剧情线 > 上一章 > RAG > 核心设定（低保）。
 * 与 assemble_context 的 P3→thread→P2→P4→P5 收集顺序一致；核心设定享 core_guarantee。
 *
 * 空记忆回退：无 facts/threads/章节/RAG/核心设定 ⇒ systemContent = 纯人设，不崩。
 *
 * **组装时机契约**：本函数在 runAgentLoop 之前调用一次，systemContent 进 startMessages[0]，
 * 循环内不重组（否则每轮重算 RAG）。详见 simple_chat_dispatch.ts。
 */
export async function assemble_chat_context(
  params: AssembleChatContextParams,
): Promise<AssembleChatContextResult> {
  const {
    project, state, user_input, facts,
    threads = [], chapter_repo, au_id,
    character_files = null, worldbuilding_files = null,
    vector_repo, embedding_provider,
    language = "zh",
  } = params;
  let { rag_text = null } = params;

  await ensureTokenizer();
  const llm = project.llm;
  const P = getPrompts(language as "zh" | "en");
  const report = createBudgetReport();

  const contextWindow = get_context_window(project);
  report.context_window = contextWindow;

  // --- 对话人设（system prompt 单一真相源：build_system_prompt_simple）---
  const personaPrompt = build_system_prompt_simple(project, language);
  const personaTc = _count(personaPrompt, llm);
  const systemTokens = personaTc.count;
  report.is_fallback_estimate = personaTc.is_estimate;
  report.system_tokens = systemTokens;

  // --- max_tokens（D-0039 单一真相源）---
  const maxTokens = computeMaxOutputTokens(project, contextWindow, "assemble_chat_context");
  report.max_output_tokens = maxTokens;

  // --- input budget（公式单一真相源见 computeInputBudget，与 assemble_context 同源）---
  // 对话人设较紧凑，无 custom_instructions 二次裁剪（build_system_prompt_simple 无 trim 开关）；
  // budget ≤ 0（极小 ctx）时钳到 0，记忆层拿不到预算、只剩人设 + 核心设定低保（不抛，逐字节"不崩"）。
  const budget = Math.max(0, computeInputBudget(contextWindow, systemTokens, maxTokens));

  const guarantee = project.core_guarantee_budget ?? 400;

  // --- chatHistoryReserve：给过去多轮历史留余量（上限封顶）---
  const chatHistoryReserve = Math.min(
    Math.trunc(budget * CHAT_HISTORY_RESERVE_RATIO),
    CHAT_HISTORY_RESERVE_CEIL,
  );
  // 记忆层只在 memBudget 内竞争；最新轮 user 不受 reserve 压缩（先计入 used 硬保）。
  const memBudget = Math.max(0, budget - chatHistoryReserve);

  // --- 最新轮 user：当前章节状态 + 用户输入（硬保，类比 P1 当前指令）---
  const currentCh = state.current_chapter ?? 1;
  const latestUserContent = `${P.CURRENT_STATUS.replace("{current_ch}", String(currentCh))}\n\n${user_input}`;
  const latestUserTokens = _count(latestUserContent, llm).count;
  let used = latestUserTokens;
  report.p1_tokens = latestUserTokens;

  const truncatedLayers: string[] = [];

  // --- RAG 检索（一次性，单一真相源 retrieveRagForContext）---
  // gate 与 generate_chapter 一致：rag_text 已给则跳过；否则两 repo 都在才检索。
  if (rag_text === null && vector_repo && embedding_provider) {
    const rag = await retrieveRagForContext({
      project, state, user_input, facts,
      vector_repo, embedding_provider, au_id,
      llm_config: llm, language,
    });
    rag_text = rag.ragText;
  }

  // === P3 事实表（记忆最高优先级）===
  // 对话路径无"chapter_focus 推进目标"概念（那是续写体 P1 build_instruction 的机制），
  // 故 focus_ids 传空数组：所有 active/unresolved fact 都进 P3，不会被 focus 排除后凭空丢失。
  const p3Budget = Math.max(0, memBudget - used - guarantee);
  const [p3Text, softDegraded] = build_facts_layer(facts, [], p3Budget, llm, language);
  const p3Tokens = _count(p3Text, llm).count;
  used += p3Tokens;
  report.p3_tokens = p3Tokens;
  report.unresolved_soft_degraded = softDegraded;
  if (softDegraded) truncatedLayers.push("P3");

  // === 剧情线摘要层（M8-B）===
  const threadBudget = Math.max(0, memBudget - used - guarantee);
  const threadText = build_threads_layer(threads, threadBudget, llm, language);
  const threadTokens = _count(threadText, llm).count;
  used += threadTokens;
  report.thread_tokens = threadTokens;

  // === P2 最近章节 ===
  const p2Budget = Math.max(0, memBudget - used - guarantee);
  const p2Text = await build_recent_chapter_layer(state, chapter_repo, au_id, p2Budget, llm, language);
  const p2Tokens = _count(p2Text, llm).count;
  if (p2Tokens > p2Budget && p2Budget > 0) truncatedLayers.push("P2");
  used += p2Tokens;
  report.p2_tokens = p2Tokens;

  // === P4 RAG ===
  let p4Text = rag_text ?? "";
  let p4Tokens = 0;
  if (p4Text) {
    p4Tokens = _count(p4Text, llm).count;
    const p4Budget = Math.max(0, memBudget - used - guarantee);
    if (p4Tokens > p4Budget) {
      p4Text = "";
      p4Tokens = 0;
      truncatedLayers.push("P4");
    }
    used += p4Tokens;
  }
  report.p4_tokens = p4Tokens;

  // === P5 核心设定（最低优先级，但有 core_guarantee 低保）===
  const p5Budget = Math.max(guarantee, memBudget - used);
  const [p5Text, p5Injected, p5Truncated, p5WbInjected] = build_core_settings_layer(
    project, character_files, p5Budget, llm, language, worldbuilding_files,
  );
  const p5Tokens = _count(p5Text, llm).count;
  used += p5Tokens;
  report.p5_tokens = p5Tokens;
  if (p5Truncated.length > 0) truncatedLayers.push("P5_core_settings");

  // --- 汇总（账面口径与 assemble_context 一致：total = system + used）---
  report.total_input_tokens = systemTokens + used;
  // 注意：对话路径 budget_remaining = budget − used 用的是**未扣 reserve 的全量 budget**，而记忆层
  // 被压在 memBudget(=budget−reserve) 内竞争，故此值含已预留给历史的 reserve、偏乐观（最多虚高一个
  // reserve）。它只是 debug 字段无运行时消费者；要真实"记忆层余量"看 memBudget−used。
  report.budget_remaining = budget - used;
  report.truncated_layers = truncatedLayers;

  // --- ContextSummary 旁路收集（D-0031 容错）---
  const summary = createContextSummary();
  try {
    summary.pinned_count = (project.pinned_context ?? []).length;
    summary.facts_injected = p3Text.split("\n").filter((line) => line.startsWith("- [")).length;
    summary.facts_archived_count = facts.filter(
      (f) =>
        (f.status === FactStatus.ACTIVE || f.status === FactStatus.UNRESOLVED) &&
        f.archived === true,
    ).length;
    if (p4Text) {
      summary.rag_chunks_retrieved = p4Text
        .split("\n")
        .filter((line) => line.trim() && !line.startsWith("### ")).length;
    }
    summary.characters_used = p5Injected;
    summary.truncated_characters = p5Truncated;
    summary.worldbuilding_used = p5WbInjected;
    summary.total_input_tokens = systemTokens + used;
    summary.truncated_layers = [...truncatedLayers];
  } catch {
    // D-0031: 收集失败不影响生成流程
  }

  // --- systemContent = 人设 + 记忆层 ---
  // 记忆层顺序对齐 assemble_context 反转后布局（去掉 P1）：P5→P4→P2→thread→P3。
  // facts(P3) 紧贴 latestUser 之前 = 最高显著性；空层 filter(Boolean) 滤掉。
  const memoryLayers = [p5Text, p4Text, p2Text, threadText, p3Text].filter(Boolean);
  const systemContent = memoryLayers.length > 0
    ? `${personaPrompt}\n\n---\n\n${memoryLayers.join("\n\n")}`
    : personaPrompt;

  return {
    systemContent,
    latestUserContent,
    max_tokens: maxTokens,
    budget_report: report,
    context_summary: summary,
  };
}
