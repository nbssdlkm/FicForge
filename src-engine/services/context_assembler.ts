// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 上下文组装器。参见 PRD §4.1。
 *
 * 六层结构 P0-P5，按优先级截断，reversed 后注入。
 * 收集顺序 P1→P3→thread→P2→P4→P5，reversed 后 P5→P4→P2→thread→P3→P1。
 * （thread = 剧情线摘要层，M8-B；空线时为 ""，filter 后逐字节回退到无该层。）
 *
 * P0 三拆一：prompt 块构建 → context_prompt_blocks.ts，预算计算 → context_budget.ts；本文件
 * 保留记忆层级联 + assembleContext / assembleChatContext 主函数，并 re-export 原 public API，
 * 使 barrel（services/index.ts）与所有外部 import 零改动。
 */

import type { BudgetReport } from "../domain/budget_report.js";
import { createBudgetReport } from "../domain/budget_report.js";
import type { ContextSummary } from "../domain/context_summary.js";
import { createContextSummary } from "../domain/context_summary.js";
import { FactStatus } from "../domain/enums.js";
import type { Fact } from "../domain/fact.js";
import { isColdFact } from "../domain/fact.js";
import type { Thread } from "../domain/thread.js";
import { getContextWindow } from "../domain/model_context_map.js";
import { DEFAULT_CHAPTER_LENGTH } from "../domain/project.js";
import type { Project } from "../domain/project.js";
import type { State } from "../domain/state.js";
import { ensureTokenizer } from "../tokenizer/index.js";
import { getPrompts } from "../prompts/index.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import type { VectorRepository } from "../repositories/interfaces/vector.js";
import type { EmbeddingProvider } from "../llm/embedding_provider.js";
import type { Message } from "../llm/provider.js";
import { retrieveRagForContext } from "./rag_retrieval.js";
import {
  _count,
  buildSystemPrompt,
  buildInstruction,
  buildFactsLayer,
  buildThreadsLayer,
  buildRecentChapterLayer,
  buildCoreSettingsLayer,
  buildSystemPromptSimple,
} from "./context_prompt_blocks.js";
import {
  type EffectiveLLM,
  computeMaxOutputTokens,
  computeInputBudget,
  CHAT_HISTORY_RESERVE_RATIO,
  CHAT_HISTORY_RESERVE_CEIL,
} from "./context_budget.js";

// re-export 原 public API（barrel 与外部 import 零改动）。_count / computeMaxOutputTokens
// 属内部实现，只 import 不 re-export（保持内部）。
export {
  buildSystemPrompt,
  buildInstruction,
  buildFactEnrichmentSuffix,
  buildFactKnowledgeClause,
  buildFactsLayer,
  buildThreadsLayer,
  buildRecentChapterLayer,
  buildCoreSettingsLayer,
  buildSystemPromptSimple,
} from "./context_prompt_blocks.js";
export {
  type EffectiveLLM,
  computeInputBudget,
  CHAT_HISTORY_RESERVE_RATIO,
  CHAT_HISTORY_RESERVE_CEIL,
} from "./context_budget.js";

// ===========================================================================
// 记忆层预算级联（P3→thread→P2→P4→P5）—— 写文 assembleContext 与对话
// assembleChatContext 的单一真相源（盲审 R3 M7）。
//
// 此前两条路径各手抄一份 P3→thread→P2→P4→P5 的「budget = base − used − guarantee →
// build → count → used +=」状态机，仅靠注释维系同源，改一条忘另一条即静默漂移。
// 两者结构逐字节相同，唯二差异是：base（写文=budget / 对话=memBudget）与 P3 的
// focus_ids（写文=chapter_focus / 对话=[]）—— 全部作为入参外提。
//
// 副作用契约：就地写入 report 的 p3/thread/p2/p4/p5_tokens 与 unresolved_soft_degraded，
// 并向 truncated_layers push 被截断的层名（与原两处逐字节一致）。
// ===========================================================================

interface MemoryCascadeParams {
  /** 记忆层可用预算基数：写文=budget，对话=memBudget（已扣 chatHistoryReserve）。 */
  base_budget: number;
  guarantee: number;
  /** 进入级联前已计入的 token（写文=P1，对话=最新轮 user），级联在此基础上累加。 */
  used: number;
  /** P3 事实层的 focus 过滤集：写文=chapter_focus，对话=[]。 */
  focus_ids: string[];
  facts: Fact[];
  threads: Thread[];
  state: State;
  chapter_repo: ChapterRepository;
  au_id: string;
  rag_text: string | null;
  project: Project;
  character_files: Record<string, string> | null;
  worldbuilding_files: Record<string, string> | null;
  llm: unknown;
  language: string;
  /** 就地写入各层 token 数与 soft-degraded 标记。 */
  report: BudgetReport;
  /** 就地 push 被截断的层名。 */
  truncated_layers: string[];
}

interface MemoryCascadeResult {
  p3Text: string;
  threadText: string;
  p2Text: string;
  p4Text: string;
  p5Text: string;
  p5Injected: string[];
  p5Truncated: string[];
  p5WbInjected: string[];
  /** 级联结束后的累计 used（含传入的初始值）。 */
  used: number;
}

async function runMemoryLayerCascade(p: MemoryCascadeParams): Promise<MemoryCascadeResult> {
  const {
    base_budget,
    guarantee,
    focus_ids,
    facts,
    threads,
    state,
    chapter_repo,
    au_id,
    project,
    character_files,
    worldbuilding_files,
    llm,
    language,
    report,
    truncated_layers,
  } = p;
  let used = p.used;
  const ragText = p.rag_text;

  // === P3 事实表（记忆最高优先级）===
  const p3Budget = Math.max(0, base_budget - used - guarantee);
  const [p3Text, softDegraded] = buildFactsLayer(facts, focus_ids, p3Budget, llm, language);
  const p3Tokens = _count(p3Text, llm).count;
  used += p3Tokens;
  report.p3_tokens = p3Tokens;
  report.unresolved_soft_degraded = softDegraded;
  if (softDegraded) truncated_layers.push("P3");

  // === 剧情线摘要层（M8-B）：P3 之后、P2 之前 ===
  const threadBudget = Math.max(0, base_budget - used - guarantee);
  const threadText = buildThreadsLayer(threads, threadBudget, llm, language);
  const threadTokens = _count(threadText, llm).count;
  used += threadTokens;
  report.thread_tokens = threadTokens;

  // === P2 最近章节 ===
  const p2Budget = Math.max(0, base_budget - used - guarantee);
  const p2Text = await buildRecentChapterLayer(state, chapter_repo, au_id, p2Budget, llm, language);
  const p2Tokens = _count(p2Text, llm).count;
  if (p2Tokens > p2Budget && p2Budget > 0) truncated_layers.push("P2");
  used += p2Tokens;
  report.p2_tokens = p2Tokens;

  // === P4 RAG ===
  let p4Text = ragText ?? "";
  let p4Tokens = 0;
  if (p4Text) {
    p4Tokens = _count(p4Text, llm).count;
    const p4Budget = Math.max(0, base_budget - used - guarantee);
    if (p4Tokens > p4Budget) {
      p4Text = "";
      p4Tokens = 0;
      truncated_layers.push("P4");
    }
    used += p4Tokens;
  }
  report.p4_tokens = p4Tokens;

  // === P5 核心设定（最低优先级，但有 core_guarantee 低保）===
  const p5Budget = Math.max(guarantee, base_budget - used);
  const [p5Text, p5Injected, p5Truncated, p5WbInjected] = buildCoreSettingsLayer(
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
  if (p5Truncated.length > 0) truncated_layers.push("P5_core_settings");

  return { p3Text, threadText, p2Text, p4Text, p5Text, p5Injected, p5Truncated, p5WbInjected, used };
}

// ===========================================================================
// assembleContext 主函数
// ===========================================================================

export interface AssembleContextResult {
  messages: Message[];
  max_tokens: number;
  budget_report: BudgetReport;
  context_summary: ContextSummary;
}

/** assembleContext 入参（R3 低危清扫：原 12 个位置参数对象化，与 AssembleChatContextParams 同风格）。 */
export interface AssembleContextParams {
  project: Project;
  state: State;
  user_input: string;
  facts: Fact[];
  chapter_repo: ChapterRepository;
  au_id: string;
  /** 预计算 RAG 文本；null/省略 ⇒ 无 RAG 层。 */
  rag_results?: string | null;
  /** 预加载的角色设定文件（P5 核心设定）。 */
  character_files?: Record<string, string> | null;
  /** 预加载的世界观设定文件（P5 核心设定）。 */
  worldbuilding_files?: Record<string, string> | null;
  language?: string;
  /** 活跃剧情线（M8-B）；省略 ⇒ 无剧情线注入。 */
  threads?: Thread[];
  /**
   * H4：实际生效 LLM 视图（resolveLlmConfig 结果）。可选 + 缺省回退 project.llm，
   * 保证旧调用方 / golden test 逐字节不变（理由见 EffectiveLLM 文档注释）。
   */
  effective_llm?: EffectiveLLM | null;
}

export async function assembleContext(params: AssembleContextParams): Promise<AssembleContextResult> {
  const {
    project,
    state,
    user_input,
    facts,
    chapter_repo,
    au_id,
    rag_results = null,
    character_files = null,
    worldbuilding_files = null,
    language = "zh",
    threads = [],
    effective_llm = null,
  } = params;
  // 融合（plan §1.3/§1.5）：原"simple 模式委托 assemble_context_simple"分支已删 —— 对话路径
  // 改走 assembleChatContext（分层），写文路径恒走下面的 P0-P5 预算切分（逐字节不回归）。
  await ensureTokenizer();
  // tokenizer 编码选择也跟 effective 走（countTokens 现只看 mode，行为等价；语义上保持同源）。
  const llm = effective_llm ?? project.llm;
  const report = createBudgetReport();

  // --- context_window（H4：给了 effective 视图则按实际生效模型算窗口）---
  const contextWindow = getContextWindow(effective_llm ? { llm: effective_llm } : project);
  report.context_window = contextWindow;

  // --- System prompt ---
  let systemPrompt = buildSystemPrompt(project, false, language);
  let sysTc = _count(systemPrompt, llm);
  let systemTokens = sysTc.count;
  report.is_fallback_estimate = sysTc.is_estimate;

  // --- max_tokens（D-0039；公式单一真相源见 computeMaxOutputTokens）---
  const chapterLength = project.chapter_length ?? DEFAULT_CHAPTER_LENGTH;
  const maxTokens = computeMaxOutputTokens(project, contextWindow, "context_assembler", effective_llm ?? undefined);
  report.max_output_tokens = maxTokens;

  // --- input budget（公式单一真相源见 computeInputBudget）---
  let budget = computeInputBudget(contextWindow, systemTokens, maxTokens);

  // fail-safe：budget 不够 → 裁剪 custom_instructions 重算
  if (budget <= 0) {
    systemPrompt = buildSystemPrompt(project, true, language);
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
  const p1Text = buildInstruction(state, user_input, facts, language, chapterLength);
  const p1Tokens = _count(p1Text, llm).count;
  used += p1Tokens;
  report.p1_tokens = p1Tokens;

  // === P3→thread→P2→P4→P5：记忆层级联（与 assembleChatContext 共用单一真相源）===
  // 写文路径 base = budget（无 chatHistoryReserve），P3 focus = chapter_focus。
  const cascade = await runMemoryLayerCascade({
    base_budget: budget,
    guarantee,
    used,
    focus_ids: focusIds,
    facts,
    threads,
    state,
    chapter_repo,
    au_id,
    rag_text: rag_results,
    project,
    character_files,
    worldbuilding_files,
    llm,
    language,
    report,
    truncated_layers: truncatedLayers,
  });
  const { p3Text, threadText, p2Text, p4Text, p5Text, p5Injected, p5Truncated, p5WbInjected } = cascade;
  used = cascade.used;

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
      (f) => (f.status === FactStatus.ACTIVE || f.status === FactStatus.UNRESOLVED) && isColdFact(f),
    ).length;

    if (p4Text) {
      const ragContentLines = p4Text.split("\n").filter((line) => line.trim() && !line.startsWith("### "));
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

// ===========================================================================
// 对话式 × 记忆栈融合：assembleChatContext — 分层对话上下文
// ===========================================================================

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
   * 检索一次（单一真相源，与 generateChapter 同函数）。任一缺省 ⇒ 跳过 RAG。
   * estimate token badge 路径【有意】不传，避免每次估算触发 embedding 调用。
   */
  vector_repo?: VectorRepository;
  embedding_provider?: EmbeddingProvider;
  /** 预计算 RAG 文本，传入（非 null）则跳过内部检索（与 generateChapter 同款 gate）。 */
  rag_text?: string | null;
  language?: string;
  /**
   * H4：实际生效 LLM 视图（resolveLlmConfig 结果）。可选 + 缺省回退 project.llm，
   * 旧调用方 / 测试不传时行为逐字节不变（理由见 EffectiveLLM 文档注释）。
   */
  effective_llm?: EffectiveLLM | null;
  /**
   * E8：角色别名表（主名 → 别名列表）。透传给 retrieveRagForContext → buildActiveChars，
   * 对话正文/输入只出现别名时活跃角色过滤集也认主名（与写文路径同一张表同一语义）。
   * 可选 + 缺省 null：无角色卡 / estimate token 路径不传时 char_filter 行为逐字节不变。
   */
  character_aliases?: Record<string, string[]> | null;
}

/**
 * 分层对话上下文组装（融合 plan §1.2）。
 *
 * 与 assembleContext（完整写文路径）共用同一套 builder（buildFactsLayer /
 * buildThreadsLayer / buildRecentChapterLayer / buildCoreSettingsLayer）+
 * retrieveRagForContext，但：
 *  - system prompt 用对话人设 buildSystemPromptSimple（不是续写体 buildSystemPrompt）。
 *  - 产物切成 systemContent（人设 + 记忆层）+ latestUserContent（最新轮），而不是单 user
 *    message —— 因为对话要 [system, ...history, latestUser]，记忆进 system 才不会随历史
 *    每轮重复。
 *  - 输入侧预留 chatHistoryReserve 给过去多轮历史。
 *
 * 记忆层降级优先级（plan §1.2）：facts > 剧情线 > 上一章 > RAG > 核心设定（低保）。
 * 与 assembleContext 的 P3→thread→P2→P4→P5 收集顺序一致；核心设定享 core_guarantee。
 *
 * 空记忆回退：无 facts/threads/章节/RAG/核心设定 ⇒ systemContent = 纯人设，不崩。
 *
 * **组装时机契约**：本函数在 runAgentLoop 之前调用一次，systemContent 进 startMessages[0]，
 * 循环内不重组（否则每轮重算 RAG）。详见 simple_chat_dispatch.ts。
 */
export async function assembleChatContext(params: AssembleChatContextParams): Promise<AssembleChatContextResult> {
  const {
    project,
    state,
    user_input,
    facts,
    threads = [],
    chapter_repo,
    au_id,
    character_files = null,
    worldbuilding_files = null,
    vector_repo,
    embedding_provider,
    language = "zh",
    effective_llm = null,
    character_aliases = null,
  } = params;
  let { rag_text = null } = params;

  await ensureTokenizer();
  // tokenizer 编码选择也跟 effective 走（countTokens 现只看 mode，行为等价；语义上保持同源）。
  const llm = effective_llm ?? project.llm;
  const P = getPrompts(language as "zh" | "en");
  const report = createBudgetReport();

  // H4：给了 effective 视图则按实际生效模型算窗口（缺省回退 project.llm，向后兼容）。
  const contextWindow = getContextWindow(effective_llm ? { llm: effective_llm } : project);
  report.context_window = contextWindow;

  // --- 对话人设（system prompt 单一真相源：buildSystemPromptSimple）---
  const personaPrompt = buildSystemPromptSimple(project, language);
  const personaTc = _count(personaPrompt, llm);
  const systemTokens = personaTc.count;
  report.is_fallback_estimate = personaTc.is_estimate;
  report.system_tokens = systemTokens;

  // --- max_tokens（D-0039 单一真相源）---
  const maxTokens = computeMaxOutputTokens(project, contextWindow, "assemble_chat_context", effective_llm ?? undefined);
  report.max_output_tokens = maxTokens;

  // --- input budget（公式单一真相源见 computeInputBudget，与 assembleContext 同源）---
  // 对话人设较紧凑，无 custom_instructions 二次裁剪（buildSystemPromptSimple 无 trim 开关）；
  // budget ≤ 0（极小 ctx）时钳到 0，记忆层拿不到预算、只剩人设 + 核心设定低保（不抛，逐字节"不崩"）。
  const budget = Math.max(0, computeInputBudget(contextWindow, systemTokens, maxTokens));

  const guarantee = project.core_guarantee_budget ?? 400;

  // --- chatHistoryReserve：给过去多轮历史留余量（上限封顶）---
  const chatHistoryReserve = Math.min(Math.trunc(budget * CHAT_HISTORY_RESERVE_RATIO), CHAT_HISTORY_RESERVE_CEIL);
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
  // gate 与 generateChapter 一致：rag_text 已给则跳过；否则两 repo 都在才检索。
  if (rag_text === null && vector_repo && embedding_provider) {
    const rag = await retrieveRagForContext({
      project,
      state,
      user_input,
      facts,
      vector_repo,
      embedding_provider,
      au_id,
      llm_config: llm,
      language,
      effective_llm, // H4：ragBudget（≈ctx/4）随实际生效模型的窗口走
      character_aliases, // E8：对话正文只出现别名时活跃角色过滤集也认主名
    });
    rag_text = rag.ragText;
  }

  // === P3→thread→P2→P4→P5：记忆层级联（与 assembleContext 共用单一真相源）===
  // 对话路径 base = memBudget（已扣 chatHistoryReserve）；对话无"chapter_focus 推进目标"
  // 概念（那是续写体 P1 buildInstruction 的机制），故 focus_ids 传空数组 —— 所有
  // active/unresolved fact 都进 P3，不会被 focus 排除后凭空丢失。
  const cascade = await runMemoryLayerCascade({
    base_budget: memBudget,
    guarantee,
    used,
    focus_ids: [],
    facts,
    threads,
    state,
    chapter_repo,
    au_id,
    rag_text,
    project,
    character_files,
    worldbuilding_files,
    llm,
    language,
    report,
    truncated_layers: truncatedLayers,
  });
  const { p3Text, threadText, p2Text, p4Text, p5Text, p5Injected, p5Truncated, p5WbInjected } = cascade;
  used = cascade.used;

  // --- 汇总（账面口径与 assembleContext 一致：total = system + used）---
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
      (f) => (f.status === FactStatus.ACTIVE || f.status === FactStatus.UNRESOLVED) && isColdFact(f),
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
  // 记忆层顺序对齐 assembleContext 反转后布局（去掉 P1）：P5→P4→P2→thread→P3。
  // facts(P3) 紧贴 latestUser 之前 = 最高显著性；空层 filter(Boolean) 滤掉。
  const memoryLayers = [p5Text, p4Text, p2Text, threadText, p3Text].filter(Boolean);
  const systemContent =
    memoryLayers.length > 0 ? `${personaPrompt}\n\n---\n\n${memoryLayers.join("\n\n")}` : personaPrompt;

  return {
    systemContent,
    latestUserContent,
    max_tokens: maxTokens,
    budget_report: report,
    context_summary: summary,
  };
}
