// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 上下文组装 —— prompt 块构建 + token 计数辅助（从 context_assembler.ts 机械拆出，
 * P0 高风险模块三拆一，行为逐字节不变）。
 *
 * 纯 prompt / 分层文本构建：P0 system prompt、P1 指令、P3 事实表、剧情线层、P2 上一章、
 * P5 核心设定、对话版 system prompt，以及 _count token 计数 helper。
 * 预算计算见 context_budget.ts；级联与 assemble 主函数见 context_assembler.ts。
 */

import { EmotionStyle, FactStatus, NarrativeWeight, Perspective, ThreadStatus } from "../domain/enums.js";
import type { Fact, ConfidenceLevel, FactFieldConfidence } from "../domain/fact.js";
import { isColdFact } from "../domain/fact.js";
import type { Thread } from "../domain/thread.js";
import { DEFAULT_CHAPTER_LENGTH } from "../domain/project.js";
import type { Project, WritingStyle } from "../domain/project.js";
import type { State } from "../domain/state.js";
import { getPrompts } from "../prompts/index.js";
import { countTokens } from "../tokenizer/index.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";

// ---------------------------------------------------------------------------
// 辅助：token 计数
// ---------------------------------------------------------------------------

export function _count(text: string, llm_config: unknown): { count: number; is_estimate: boolean } {
  return countTokens(text, llm_config as { mode?: string } | undefined);
}

// ===========================================================================
// writing_style / pinned_context 共用块 —— 完整版与对话版 system prompt 共享。
// 此前两处各自复制维护（盲审 2026-07-09 高危重复项），改动只允许改这里。
// ===========================================================================

type PromptModule = ReturnType<typeof getPrompts>;

/** P0 铁律（pinned_context）块；无 pinned 时返回 null 不产出。 */
function pinnedContextBlock(P: PromptModule, project: Project): string | null {
  const pinned = project.pinned_context ?? [];
  if (pinned.length === 0) return null;
  const lines = pinned.map((p) => `- ${p}`).join("\n");
  return P.PINNED_CONTEXT_HEADER.replace("{lines}", lines);
}

/** 叙事视角块。 */
function perspectiveBlock(P: PromptModule, ws: WritingStyle | undefined, language: string): string {
  if ((ws?.perspective ?? Perspective.THIRD_PERSON) === Perspective.FIRST_PERSON) {
    const pov = ws?.pov_character || (language === "zh" ? "主角" : "protagonist");
    return P.PERSPECTIVE_FIRST_PERSON.split("{pov}").join(pov);
  }
  return P.PERSPECTIVE_THIRD_PERSON;
}

/** 情感风格块。 */
function emotionBlock(P: PromptModule, ws: WritingStyle | undefined): string {
  return (ws?.emotion_style ?? EmotionStyle.IMPLICIT) === EmotionStyle.EXPLICIT
    ? P.EMOTION_EXPLICIT
    : P.EMOTION_IMPLICIT;
}

/** custom_instructions 块；为空时返回 null 不产出。 */
function customInstructionsBlock(P: PromptModule, ws: WritingStyle | undefined): string | null {
  const custom = ws?.custom_instructions ?? "";
  return custom ? P.CUSTOM_INSTRUCTIONS_HEADER.replace("{custom}", custom) : null;
}

// ===========================================================================
// buildSystemPrompt（P0 + 规则）
// ===========================================================================

export function buildSystemPrompt(project: Project, trim_custom = false, language = "zh"): string {
  const P = getPrompts(language as "zh" | "en");
  const parts: string[] = [P.SYSTEM_NOVELIST];

  // --- P0 Pinned Context ---
  const pinned = pinnedContextBlock(P, project);
  if (pinned) parts.push(pinned);

  // --- 冲突解决规则 ---
  parts.push(P.CONFLICT_RESOLUTION_RULES);

  // --- 叙事视角 ---
  const ws = project.writing_style;
  parts.push(perspectiveBlock(P, ws, language));

  // --- 情感风格 ---
  parts.push(emotionBlock(P, ws));

  // --- 伏笔规约 ---
  parts.push(P.FORESHADOWING_RULES);

  // --- 通用规则 ---
  const chapterLength = project.chapter_length ?? DEFAULT_CHAPTER_LENGTH;
  const chapterLengthMax = Math.trunc(chapterLength * 1.3);
  parts.push(
    P.GENERIC_RULES.replace("{chapter_length}", String(chapterLength)).replace(
      "{chapter_length_max}",
      String(chapterLengthMax),
    ),
  );

  // --- custom_instructions ---
  if (!trim_custom) {
    const custom = customInstructionsBlock(P, ws);
    if (custom) parts.push(custom);
  }

  return parts.join("\n\n");
}

// ===========================================================================
// buildInstruction（P1 当前指令）
// ===========================================================================

export function buildInstruction(
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

  // chapter_focus 分支。审计⑥：已归档（冷）fact 即便还挂在 chapter_focus 里，也不再作为
  // 「本章推进目标」注入 prompt —— 与 buildFactsLayer / RAG query 同用 isColdFact 单一真相源。
  const focusIds = state.chapter_focus ?? [];
  const focusFacts = focusIds.length > 0 ? facts.filter((f) => focusIds.includes(f.id) && !isColdFact(f)) : [];

  if (focusFacts.length > 0) {
    // 推进目标块（知情标注同步带上——否则本章最核心的事实反而缺知情边界，M3 批一）
    const focusLines = focusFacts.map((f) => `- ${f.content_clean}${buildFactKnowledgeClause(f, language)}`).join("\n");
    parts.push(P.FOCUS_GOAL_HEADER);
    parts.push(P.FOCUS_GOAL_DEFINITION.replace("{focus_lines}", focusLines));

    // 本章特别注意（非 focus 的高权重 unresolved，最多 2 条）。审计⑥：排除已归档冷 fact。
    const nonFocusUnresolved = facts.filter(
      (f) =>
        !focusIds.includes(f.id) &&
        f.status === FactStatus.UNRESOLVED &&
        f.narrative_weight === NarrativeWeight.HIGH &&
        !isColdFact(f),
    );
    if (nonFocusUnresolved.length > 0) {
      const cautionLines = nonFocusUnresolved
        .slice(0, 2)
        .map((f) => `- ${f.content_clean}${buildFactKnowledgeClause(f, language)}`)
        .join("\n");
      parts.push(P.ATTENTION_HEADER);
      parts.push(P.ATTENTION_BODY.replace("{caution_lines}", cautionLines));
    }

    // 背景信息使用规则
    parts.push(P.BG_RULES);
  } else if (facts.some((f) => f.status === FactStatus.UNRESOLVED && !isColdFact(f))) {
    // 铺陈指令（审计⑥：只在存在「非冷」未决 fact 时才铺陈；全部已归档则无需）
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

// 门控与空值判据 —— enrichment suffix 与 knowledge clause 共用同一份（单一真相源）。
// 语义：无 _confidence（手动/导入 ground truth）→ 无条件注入；有 _confidence（ReAct/LLM 自评）→ ≥ medium 才注入。
const ENRICH_INJECT_LEVELS: ReadonlySet<ConfidenceLevel> = new Set(["high", "medium"]);
function enrichInject(c: FactFieldConfidence | undefined, level: ConfidenceLevel | undefined): boolean {
  return !c || ENRICH_INJECT_LEVELS.has(level!);
}
// 空/纯空白字符串不注入（避免渲染 "location: " 空行）——手动录入留空、或 LLM 吐 "" 时都挡掉
// （对抗审发现 2：MED-3 放开无 _confidence 路径后，空串字段会渲染无信息量空行）。
function hasText(s: string | null | undefined): boolean {
  return typeof s === "string" && s.trim() !== "";
}

/**
 * 根据 _confidence 构建 fact 行的括号内补充字符串。
 *
 * 门控语义 = 「过滤 ReAct 的低置信猜测」，不是「必须有 _confidence 才注入」（MED-3 修正）：
 *   - **有 _confidence**（ReAct 合成，见 react_extraction_dispatch H10）：对应字段 confidence
 *     ≥ medium 才注入 —— 挡掉 LLM 低置信的富化猜测污染 prompt。
 *   - **无 _confidence**（手动录入 / 导入的 ground truth：源头即确定，非 LLM 猜测）：present 即注入。
 *     否则用户/导入设定的 location/known_to 被置信度门控静默丢弃、永远进不了 P3（第三轮审计 MED）。
 *     注：ReAct 若某 fact 富化字段全空则保持 _confidence=undefined，此时也无字段可注入，语义仍一致。
 *   - 高价值：time_kind（非 normal）、action_verb
 *   - 中价值：location、suspense_type
 *   - 低价值（不注入）：story_time_tag、story_time_order
 * 注①：known_to / hidden_from（知情边界，M3 批一）不走本函数——它们改由
 * buildFactKnowledgeClause 以人话渲染（「仅X知道」「瞒着X」），配 INFO_ASYMMETRY_RULES 图例。
 * 注②：caused_by（跨章因果）也不走本函数——它需解析 fact_id → 起因短句，在 buildFactsLayer 里用
 * factById 渲染（见那里的 causedByClause / lineBody，B1 最后一公里）。
 */
export function buildFactEnrichmentSuffix(fact: Fact): string {
  const c = fact._confidence;
  const inject = (level: ConfidenceLevel | undefined): boolean => enrichInject(c, level);

  const parts: string[] = [];

  // time_kind（高价值；normal 无信息量，跳过）
  if (fact.time_kind != null && fact.time_kind !== "normal" && inject(c?.time_kind)) {
    parts.push(`time_kind: ${fact.time_kind}`);
  }

  // action_verb（高价值）
  if (hasText(fact.action_verb) && inject(c?.action_verb)) {
    parts.push(`action_verb: ${fact.action_verb}`);
  }

  // location（中价值）
  if (hasText(fact.location) && inject(c?.location)) {
    parts.push(`location: ${fact.location}`);
  }

  // suspense_type（中价值）
  if (fact.suspense_type != null && inject(c?.suspense_type)) {
    parts.push(`suspense_type: ${fact.suspense_type}`);
  }

  if (parts.length === 0) return "";
  return ` (${parts.join("; ")})`;
}

// ===========================================================================
// buildFactKnowledgeClause（M3 批一：知情边界标注，纯函数）
// ===========================================================================

/**
 * 把 fact 的知情边界（known_to / hidden_from）渲染成人话行尾标注：
 *   zh：`（仅王妃、稳婆知道；瞒着王爷）` / `（仅读者知）`
 *   en：` [known only to: A, B; hidden from: C]` / ` [reader-only]`
 *
 * 语义约定（与 UI chips 同口径）：
 * - known_to = "all" / null / [] 无信息量，不渲染（"all" 是常态默认，渲染只添噪声）；
 * - known_to 为历史脏数据裸字符串（非 all/reader_only）时按单人名单渲染——消毒 helper 上线前的
 *   存量磁盘数据仍可能有该形态，渲染端兜住而不是丢信息；
 * - hidden_from 非空数组才渲染；
 * - 置信度门控与 enrichment suffix 共用 enrichInject（低置信 LLM 猜测不指挥写作）。
 *
 * 消费点：buildFactsLayer 的 lineBody（P3 全量事实）+ buildInstruction 的 focus/attention 行
 * （P1 本章推进目标——不带则恰好本章最核心的事实没有知情标注）。图例 INFO_ASYMMETRY_RULES
 * 仅在 P3 实际出现本标注时注入，判定以本函数产出为准（单一真相源，勿在别处重算字段条件）。
 */
export function buildFactKnowledgeClause(fact: Fact, language = "zh"): string {
  const c = fact._confidence;
  const en = language === "en";
  const parts: string[] = [];

  if (fact.known_to != null && fact.known_to !== "all" && enrichInject(c, c?.known_to)) {
    if (fact.known_to === "reader_only") {
      parts.push(en ? "reader-only" : "仅读者知");
    } else if (Array.isArray(fact.known_to)) {
      const names = fact.known_to.filter((n) => hasText(n));
      if (names.length > 0) {
        parts.push(en ? `known only to: ${names.join(", ")}` : `仅${names.join("、")}知道`);
      }
    } else if (hasText(fact.known_to)) {
      parts.push(en ? `known only to: ${fact.known_to}` : `仅${fact.known_to}知道`);
    }
  }

  if (Array.isArray(fact.hidden_from) && enrichInject(c, c?.hidden_from)) {
    const names = fact.hidden_from.filter((n) => hasText(n));
    if (names.length > 0) {
      parts.push(en ? `hidden from: ${names.join(", ")}` : `瞒着${names.join("、")}`);
    }
  }

  if (parts.length === 0) return "";
  return en ? ` [${parts.join("; ")}]` : `（${parts.join("；")}）`;
}

// ===========================================================================
// buildFactsLayer（P3 事实表）
// ===========================================================================

export function buildFactsLayer(
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
      // M10-B: 冷 fact 不进 P3（单一真相源 isColdFact）
      !isColdFact(f),
  );

  if (eligible.length === 0) return ["", false];

  // B1（最后一公里）：把 caused_by 跨章因果渲进 fact 行。数据已存/已防幻觉，但此前 context_assembler
  // 明确「不注入」（低价值），导致「AI 记得跨章因果」承诺落空。这里解析 fact_id → 起因短句
  // （最多 2 条、各截 20 字控 token）；解析不到的 id（跨 AU / 已删 / 不在本次 facts 集）跳过，绝不
  // 渲染裸 id。budget 计数与行渲染统一走 lineBody，保持预算/输出一致（context_assembler 高风险不变量）。
  const factById = new Map(facts.map((f) => [f.id, f]));
  const causedByClause = (f: Fact): string => {
    const ids = f.caused_by ?? [];
    if (ids.length === 0) return "";
    const refs: string[] = [];
    for (const id of ids) {
      const ref = factById.get(id);
      if (!ref) continue;
      refs.push(ref.content_clean.length > 20 ? `${ref.content_clean.slice(0, 20)}…` : ref.content_clean);
      if (refs.length >= 2) break;
    }
    if (refs.length === 0) return "";
    return language === "en" ? ` [caused by: ${refs.join("; ")}]` : `（起因：${refs.join("；")}）`;
  };
  const lineBody = (f: Fact): string =>
    f.content_clean + buildFactEnrichmentSuffix(f) + buildFactKnowledgeClause(f, language) + causedByClause(f);

  const unresolved = eligible.filter((f) => f.status === FactStatus.UNRESOLVED);
  const active = eligible.filter((f) => f.status === FactStatus.ACTIVE);

  let softDegraded = false;

  // --- unresolved 软降级 ---
  const sortedUnresolved = sortByWeightAndRecency(unresolved);
  let unresolvedKept: Fact[] = [];
  let unresolvedDropped = 0;

  if (sortedUnresolved.length > 0) {
    // Budget includes both content_clean and the enrichment suffix that will be appended.
    const totalUrTokens = sortedUnresolved.reduce((sum, f) => sum + _count(lineBody(f), llm_config).count, 0);

    if (totalUrTokens <= budget_tokens) {
      unresolvedKept = sortedUnresolved;
    } else {
      softDegraded = true;
      let used = 0;
      for (const f of sortedUnresolved) {
        const t = _count(lineBody(f), llm_config).count;
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
    budget_tokens - unresolvedKept.reduce((sum, f) => sum + _count(lineBody(f), llm_config).count, 0);

  // --- active 截断 ---
  const activeKept: Fact[] = [];
  if (active.length > 0 && remainingBudget > 0) {
    const sortedActive = sortByWeightAndRecency(active);
    let used = 0;
    for (const f of sortedActive) {
      const t = _count(lineBody(f), llm_config).count;
      if (used + t > remainingBudget) break;
      activeKept.push(f);
      used += t;
    }
  }

  // --- 合并并按 chapter 正序；同章内再按剧情内时间序号（M3 批二）---
  // story_time_order 是提取时以「本章」为基准打的相对整数，同章内可靠、跨章不可比 ——
  // 主序恒为章节号，序号只做同章 tiebreak（闪回/插叙事实在本章块内提前，AI 读到的时间线是顺的），
  // **禁止**据此做全局排序（数据只有这个精度）。低置信序号不参与（与富化注入同一门控）；
  // 无序号/被门控的排同章有序号之后，等值保持稳定序 —— 全部无序号时排序键恒等，
  // 与旧「仅按 chapter」逐字节一致（golden 回归安全绳）。
  // isFinite 门（对抗审 R2 HIGH）：NaN 会让三态比较对任何值都返回 0，破坏 comparator 全序契约；
  // ±Infinity 输入同折「无序号」。有限数不做正整数强校验——提取契约是「从 1 起的正整数」，但
  // LLM 垃圾给出 0/-1/1.5 时按相对序参与排序是无害且确定的，比丢弃信号更稳。
  const storyOrderOf = (f: Fact): number => {
    const v = f.story_time_order;
    if (typeof v !== "number" || !Number.isFinite(v) || !enrichInject(f._confidence, f._confidence?.story_time_order)) {
      return Number.POSITIVE_INFINITY;
    }
    return v;
  };
  const allKept = [...unresolvedKept, ...activeKept];
  allKept.sort((a, b) => {
    if (a.chapter !== b.chapter) return a.chapter - b.chapter;
    const oa = storyOrderOf(a);
    const ob = storyOrderOf(b);
    // 显式三态比较：oa/ob 可为 Infinity，Infinity-Infinity=NaN 会破坏 comparator 契约。
    // 有意语义（对抗审 R2 MED-1 锁定）：同章内按剧情时间互排**跨越 unresolved/active 状态分组**
    // ——时间线连贯压过状态分组（状态在行首 [status] 可见；预算挑选的 unresolved 优先不受影响，
    // 此处只是呈现顺序）。等值走稳定序（项目底线 Safari 16.4+/Chrome 111+，ES2019 稳定排序保证）。
    return oa < ob ? -1 : oa > ob ? 1 : 0;
  });

  const lines = allKept.map((f) => `- [${f.status}] ${lineBody(f)}`);

  // 知情范围图例（M3 批一）：仅当本次实际注入的行带知情标注时才出现——无标注 AU 逐字节不变
  // （golden 回归安全绳）。判定直接以 clause 渲染产出为准（单一真相源），不在此重算字段条件。
  // 与 SECTION 头/UNRESOLVED_DROPPED_HINT 同模式：不计入 P3 内部预算，级联层对 p3Text 整体
  // 二次计数兜底（runMemoryLayerCascade）。
  if (allKept.some((f) => buildFactKnowledgeClause(f, language) !== "")) {
    const P = getPrompts(language as "zh" | "en");
    lines.unshift(P.INFO_ASYMMETRY_RULES);
  }

  if (unresolvedDropped > 0) {
    const P = getPrompts(language as "zh" | "en");
    lines.push(P.UNRESOLVED_DROPPED_HINT.replace("{count}", String(unresolvedDropped)));
  }

  if (lines.length === 0) return ["", softDegraded];

  const P = getPrompts(language as "zh" | "en");
  return [`${P.SECTION_PLOT_STATE}\n${lines.join("\n")}`, softDegraded];
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
// buildThreadsLayer（剧情线摘要层，M8-B）
// ===========================================================================

/**
 * 把活跃剧情线（status=active）的「当前进展」拼成一段注入文本。
 *
 * - 仅 active 线注入（resolved/dormant 不需要模型注意力）。
 * - 按 updated_at 倒序（最近推进的在前）。
 * - 预算截断：超预算丢尾部线（mirror buildFactsLayer 截断语义）。
 * - 空 / 全非 active ⇒ 返回 ""（调用方 filter(Boolean) 后逐字节回退，golden 零回归）。
 *
 * 成员关系（哪些 Fact 属于线）的真相源是 fact.thread_ids，本函数不反查 fact，
 * 只读 thread.title + thread.state，避免双向状态（spec D1）。
 */
export function buildThreadsLayer(
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
    const stateText = t.state?.trim() || t.description?.trim() || "";
    const line = stateText ? `- 【${t.title}】${stateText}` : `- 【${t.title}】`;
    const tk = _count(line, llm_config).count;
    if (used + tk > budget_tokens) break; // 预算截断，丢尾部
    lines.push(line);
    used += tk;
  }
  if (lines.length === 0) return "";

  const P = getPrompts(language as "zh" | "en");
  return `${P.SECTION_PLOT_THREADS}\n${lines.join("\n")}`;
}

// ===========================================================================
// buildRecentChapterLayer（P2 最近章节）
// ===========================================================================

export async function buildRecentChapterLayer(
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
    content = await chapter_repo.getContentOnly(au_id, current - 1);
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
  // L7：500 字下限本身可能仍超 budget —— 小窗口模型极端时，「不低于 500 字」的硬下限会突破
  // P2 层预算，把 P4/P5 挤爆甚至整体超窗（API 400）。下限退让为「不超过剩余可用预算」：
  // 仅当 500 字对应 token 确实 > budget 时，把有效下限从 500 降到 0（宁可更短也不越层预算）；
  // 正常/充足预算下 floorBudgetOk=true → 有效下限恒为 500，与旧行为逐字节等价（golden 不变）。
  const floorBudgetOk = _count(content.slice(-minChars), llm_config).count <= budget_tokens;
  const effMinChars = floorBudgetOk ? minChars : 0;

  if (content.length <= minChars && floorBudgetOk) {
    // 整段短于下限且能塞进预算：原样返回（与旧行为一致）。
    return P.SECTION_LAST_ENDING.replace("{content}", content);
  }

  let endText = content.slice(-minChars);
  while (_count(endText, llm_config).count < budget_tokens && endText.length < content.length) {
    endText = content.slice(-(endText.length + 200));
  }
  while (_count(endText, llm_config).count > budget_tokens && endText.length > effMinChars) {
    endText = endText.slice(200);
  }

  return P.SECTION_LAST_ENDING_TRUNCATED.replace("{end_text}", endText);
}

// ===========================================================================
// buildCoreSettingsLayer（P5 核心设定）
// ===========================================================================

export function buildCoreSettingsLayer(
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
    allParts.push(`${P.SECTION_CHARACTERS}\n${charParts.join("\n\n")}`);
  }
  if (wbParts.length > 0) {
    allParts.push(`${P.SECTION_WORLDBUILDING}\n${wbParts.join("\n\n")}`);
  }

  if (allParts.length === 0) return ["", injected, truncated, wbInjected];

  return [allParts.join("\n\n"), injected, truncated, wbInjected];
}

/**
 * FicForge Lite 简版 system prompt — 对话式人设 + 意图分类 + 续写细则。
 *
 * 跟 buildSystemPrompt 区别：
 *  - 用 SIMPLE_CHAT_SYSTEM 替换 SYSTEM_NOVELIST + CONFLICT_RESOLUTION_RULES +
 *    FORESHADOWING_RULES + GENERIC_RULES（这些续写专属规则已融进 SIMPLE_CHAT_SYSTEM）
 *  - 保留 PINNED_CONTEXT（P0 铁律）+ 视角 / 情感 / custom_instructions（writing_style），
 *    这四块与 buildSystemPrompt 共用同一组 block 函数（见文件顶部），不再各自复制。
 */
export function buildSystemPromptSimple(project: Project, language = "zh"): string {
  const P = getPrompts(language as "zh" | "en");
  const ws = project.writing_style;
  const chapterLength = project.chapter_length ?? DEFAULT_CHAPTER_LENGTH;
  const chapterLengthMax = Math.trunc(chapterLength * 1.3);

  const parts: string[] = [
    P.SIMPLE_CHAT_SYSTEM.replace("{chapter_length}", String(chapterLength)).replace(
      "{chapter_length_max}",
      String(chapterLengthMax),
    ),
  ];

  // P0 铁律（add_pinned_context 在对话版仍有效）
  const pinned = pinnedContextBlock(P, project);
  if (pinned) parts.push(pinned);

  // 视角（update_writing_style 仍有效）
  parts.push(perspectiveBlock(P, ws, language));

  // 情感风格
  parts.push(emotionBlock(P, ws));

  // custom_instructions
  const custom = customInstructionsBlock(P, ws);
  if (custom) parts.push(custom);

  return parts.join("\n\n");
}
