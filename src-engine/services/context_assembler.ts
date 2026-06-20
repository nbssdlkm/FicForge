// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 上下文组装器。参见 PRD §4.1。
 *
 * 六层结构 P0-P5，按优先级截断，reversed 后注入。
 * 收集顺序 P1→P3→P2→P4→P5，reversed 后 P5→P4→P2→P3→P1。
 */

import { getSimpleFeatures, type WritingMode } from "../config/simple_features.js";
import type { BudgetReport } from "../domain/budget_report.js";
import { createBudgetReport } from "../domain/budget_report.js";
import type { ContextSummary } from "../domain/context_summary.js";
import { createContextSummary } from "../domain/context_summary.js";
import { FactStatus, NarrativeWeight } from "../domain/enums.js";
import type { Fact, ConfidenceLevel } from "../domain/fact.js";
import { get_context_window, get_model_max_output } from "../domain/model_context_map.js";
import type { Project } from "../domain/project.js";
import type { State } from "../domain/state.js";
import { count_tokens, ensureTokenizer } from "../tokenizer/index.js";
import { getPrompts } from "../prompts/index.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import type { Message } from "../llm/provider.js";

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

  // known_to（高价值）
  if (fact.known_to != null && INJECT_LEVELS.has(c.known_to!)) {
    const v = Array.isArray(fact.known_to) ? fact.known_to.join(", ") : fact.known_to;
    parts.push(`known_to: ${v}`);
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
    const totalUrTokens = sortedUnresolved.reduce(
      (sum, f) => sum + _count(f.content_clean, llm_config).count,
      0,
    );

    if (totalUrTokens <= budget_tokens) {
      unresolvedKept = sortedUnresolved;
    } else {
      softDegraded = true;
      let used = 0;
      for (const f of sortedUnresolved) {
        const t = _count(f.content_clean, llm_config).count;
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
    budget_tokens - unresolvedKept.reduce((sum, f) => sum + _count(f.content_clean, llm_config).count, 0);

  // --- active 截断 ---
  const activeKept: Fact[] = [];
  if (active.length > 0 && remainingBudget > 0) {
    const sortedActive = sortByWeightAndRecency(active);
    let used = 0;
    for (const f of sortedActive) {
      const t = _count(f.content_clean, llm_config).count;
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
  /** Only populated by assemble_context_simple; the full path omits this key entirely. */
  systemMessage?: Message;
  /** Only populated by assemble_context_simple; the full path omits this key entirely. */
  userMessage?: Message;
  max_tokens: number;
  budget_report: BudgetReport;
  context_summary: ContextSummary;
}

/**
 * D-0039 输出预算单一真相源：maxTokens = min(模型输出上限, contextWindow×40%, 章节长×2, 15k 硬顶)。
 * 超长章节被 CEIL 夹断时打 warn。full 与 simple 两个 assembler 共用，避免 15_000 字面量与
 * Math.min 公式两处手工维护漂移（D-0039 曾 rebalance 过一次，retune 时只需改这一处）。
 * @param logTag 日志前缀（"context_assembler" / "assemble_context_simple"）
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
  writingMode: WritingMode = "full",
): Promise<AssembleContextResult> {
  // simple-mode safety belt: simple_chat_dispatch calls assemble_context_simple directly; this branch
  // only covers a future generate_chapter-under-simple call. Optional param defaults to "full" so every
  // existing caller and golden test stays byte-identical (they never pass this arg).
  if (getSimpleFeatures(writingMode).simpleAssembler) {
    return assemble_context_simple(
      project, state, user_input,
      chapter_repo, au_id,
      character_files, worldbuilding_files,
      language,
    );
  }

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
  const OUTPUT_RESERVE_FLOOR = 10_000;
  const SAFETY_BUFFER = 500;

  const chapterLength = project.chapter_length ?? 1500;
  const maxTokens = computeMaxOutputTokens(project, contextWindow, "context_assembler");
  report.max_output_tokens = maxTokens;

  // --- input budget ---
  // 新公式：context_window 减掉"为输出实际预留"的空间和系统提示
  // 旧公式 (contextWindow × 0.6) 作下限兜底，保证小模型不退步
  const reservedForOutput = Math.max(maxTokens, OUTPUT_RESERVE_FLOOR);
  let budget = Math.max(
    contextWindow - reservedForOutput - systemTokens - SAFETY_BUFFER,
    Math.trunc(contextWindow * 0.60) - systemTokens,
  );

  // fail-safe：budget 不够 → 裁剪 custom_instructions 重算
  if (budget <= 0) {
    systemPrompt = build_system_prompt(project, true, language);
    sysTc = _count(systemPrompt, llm);
    systemTokens = sysTc.count;
    budget = Math.max(
      contextWindow - reservedForOutput - systemTokens - SAFETY_BUFFER,
      Math.trunc(contextWindow * 0.60) - systemTokens,
    );
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
  // 收集顺序 P1→P3→P2→P4→P5
  // reversed 后 P5→P4→P2→P3→P1
  const layers = [p1Text, p3Text, p2Text, p4Text, p5Text];
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
// FicForge Lite: assemble_context_simple — 全塞模式
// ===========================================================================

/**
 * 简版组装：不做 P0-P5 预算切分，把全部 worldbuilding / characters / 已确认章节
 * 直接拼成单个 user message。facts / RAG 在简版被禁用，调用方传入也会被忽略。
 *
 * 适用前提：模型 context window ≥ 几百 k（DeepSeek 1M / GPT-4o 128k 等）。
 * 章节数 / 设定文件多到塞不下时，第一版让 LLM 自己报错（plan §九风险表"全塞 prompt 成本"）。
 */
export async function assemble_context_simple(
  project: Project,
  state: State,
  user_input: string,
  chapter_repo: ChapterRepository,
  au_id: string,
  character_files: Record<string, string> | null = null,
  worldbuilding_files: Record<string, string> | null = null,
  language = "zh",
): Promise<AssembleContextResult> {
  await ensureTokenizer();
  const llm = project.llm;
  const P = getPrompts(language as "zh" | "en");
  const report = createBudgetReport();

  const contextWindow = get_context_window(project);
  report.context_window = contextWindow;

  // build_system_prompt_simple 返回简版人设；下面再拼"项目参考资料"段（世界观 +
  // 角色 + 已确认章节）一起进 system message。这样 chat history 里 user/assistant
  // 消息可以全塞不重复正文（D-0044 follow-up：多轮对话设计）。
  const baseSystemPrompt = build_system_prompt_simple(project, language);

  // max_tokens — 跟完整模式共用 computeMaxOutputTokens（D-0039 单一真相源）。
  const maxTokens = computeMaxOutputTokens(project, contextWindow, "assemble_context_simple");
  report.max_output_tokens = maxTokens;

  // === 项目参考资料段：世界观 + 角色 + 已确认章节，拼到 system prompt 后面 ===
  // 这部分每轮重新生成（最新版），保证 LLM 看到的是当前真实状态。chat history 里
  // 的 assistant 消息（章节正文 / tool args）虽然也带原文（"全塞"哲学），但 system
  // 这份是 source of truth，LLM 优先用最新版。
  const referenceParts: string[] = [];
  const wbInjected: string[] = [];
  const charInjected: string[] = [];

  // 世界观（按 key 字典序）
  if (worldbuilding_files) {
    const wbEntries = Object.entries(worldbuilding_files).sort(([a], [b]) => a.localeCompare(b));
    if (wbEntries.length > 0) {
      const blocks = wbEntries.map(([name, content]) => {
        wbInjected.push(name);
        return `### ${name}\n${content}`;
      });
      referenceParts.push(P.SECTION_WORLDBUILDING + "\n" + blocks.join("\n\n"));
    }
  }

  // 角色
  if (character_files) {
    const charEntries = Object.entries(character_files).sort(([a], [b]) => a.localeCompare(b));
    if (charEntries.length > 0) {
      const blocks = charEntries.map(([name, content]) => {
        charInjected.push(name);
        return `### ${name}\n${content}`;
      });
      referenceParts.push(P.SECTION_CHARACTERS + "\n" + blocks.join("\n\n"));
    }
  }

  // 全部已确认章节
  const chapters = await chapter_repo.list_main(au_id);
  const chaptersInjected = chapters.length;
  if (chapters.length > 0) {
    const titlesMap = state.chapter_titles ?? {};
    const sorted = [...chapters].sort((a, b) => a.chapter_num - b.chapter_num);
    const blocks = sorted.map((ch) => {
      const title = titlesMap[ch.chapter_num];
      const titleSuffix = title ? ` ${title}` : "";
      const header = P.SIMPLE_CHAPTER_HEADER
        .replace("{num}", String(ch.chapter_num))
        .replace("{title_suffix}", titleSuffix);
      return `${header}\n${ch.content}`;
    });
    referenceParts.push(P.SIMPLE_SECTION_CONFIRMED_CHAPTERS + "\n" + blocks.join("\n\n"));
  }

  // 完整 system prompt = 简版人设 + 项目参考资料
  const systemPrompt = referenceParts.length > 0
    ? `${baseSystemPrompt}\n\n---\n\n${referenceParts.join("\n\n")}`
    : baseSystemPrompt;
  const sysTc = _count(systemPrompt, llm);
  const systemTokens = sysTc.count;
  report.is_fallback_estimate = sysTc.is_estimate;
  report.system_tokens = systemTokens;

  // === user message：当前用户输入 + 当前章节状态指引 ===
  // CURRENT_STATUS 告诉 LLM 现在是第几章，方便它选 chapter_num（show_chapter 等）。
  // user_input 不再包"## 请续写"模板（SIMPLE_CHAT_SYSTEM 已教 LLM 自己判断意图）。
  const currentCh = state.current_chapter ?? 1;
  const userContent = `${P.CURRENT_STATUS.replace("{current_ch}", String(currentCh))}\n\n${user_input}`;

  const userTokens = _count(userContent, llm).count;

  // 简版用 p1_tokens 记整段 user 内容（语义上是"当前指令 + 全部上下文"），其他 p* 留 0。
  // truncated_layers 永远空 —— 简版不主动截断；超 ctx 让 LLM 自己报错。
  // budget_remaining 在简版下含义模糊（"剩多少"在不切分时无意义），
  // 钳到 ≥ 0 给消费方一个稳定语义；溢出靠 LLM 报错而非这里负数预警。
  report.p1_tokens = userTokens;
  report.total_input_tokens = systemTokens + userTokens;
  report.budget_remaining = Math.max(0, contextWindow - report.total_input_tokens - maxTokens);
  report.truncated_layers = [];

  const summary = createContextSummary();
  try {
    summary.pinned_count = (project.pinned_context ?? []).length;
    summary.characters_used = charInjected;
    summary.worldbuilding_used = wbInjected;
    summary.chapters_injected = chaptersInjected;
    summary.total_input_tokens = systemTokens + userTokens;
    summary.truncated_layers = [];
  } catch {
    // collection failure 不影响生成（沿用 D-0031 容错）
  }

  const systemMessage: Message = { role: "system", content: systemPrompt };
  const userMessage: Message = { role: "user", content: userContent };
  const messages: Message[] = [systemMessage, userMessage];

  return {
    messages,
    systemMessage,
    userMessage,
    max_tokens: maxTokens,
    budget_report: report,
    context_summary: summary,
  };
}
