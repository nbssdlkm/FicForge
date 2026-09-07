// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge Lite — simple_chat_dispatch（编排层；agent MVP Phase 1, T4）
 *
 * 简版 multi-turn agent loop 的编排入口。一次 dispatch 可能多轮 LLM call：
 *  - read-only tool（show_chapter / show_setting）engine 自动 fetch + 注 history → 下一轮
 *  - mutating tool（modify_*_file / create_*_file / add_pinned_context / update_writing_style）
 *    走 human-in-the-loop：emit tool_call → break → 用户 confirm 后由 SimpleChatPanel 启
 *    新 dispatch round 喂回 result（Phase 2）
 *  - chat_reply tool / chapter text streaming / max_iter 触达 / LLM 协议异常 → terminal
 *
 * Single-iter 行为不变（旧 caller / 测试不受影响）：iter 0 命中 terminal 直接 return；
 * read-only fetch 引发 continue 才进 iter 1+。
 *
 * 此 service 不执行 mutating tool 副作用（沿用 settings_chat / useSimpleToolExecutor
 * 栈），只产出意图 + 自动执行 read-only fetch。
 *
 * E4a 文件级拆分：工具判据/参数修复 → simple_chat_tools；只读工具执行 →
 * simple_chat_read_tools；事件类型与翻译 → simple_chat_events。本文件保留前置解析
 * （resolveDispatchSession）、回调工厂（buildAgentLoopConfig）、主编排（dispatchSimpleChat）
 * 及其可变共享状态。行为逐字节不变；公共 API 经下方再导出保持不变。
 */

import type { Project } from "../domain/project.js";
import type { State } from "../domain/state.js";
import type { Settings } from "../domain/settings.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import type { DraftRepository } from "../repositories/interfaces/draft.js";
import type { PlatformAdapter } from "../platform/adapter.js";
import type { Fact } from "../domain/fact.js";
import type { Thread } from "../domain/thread.js";
import type { VectorRepository } from "../repositories/interfaces/vector.js";
import type { EmbeddingProvider } from "../llm/embedding_provider.js";
import type { LLMProvider, Message, ToolDefinition } from "../llm/provider.js";
import {
  createProvider,
  resolveLlmConfig,
  resolveLlmParams,
  type ResolvedLLMConfig,
  type ResolvedLLMParams,
} from "../llm/config_resolver.js";
import { assembleChatContext } from "./context_assembler.js";
import { withAuLock } from "./au_lock.js";
import { persistGeneratedDraft } from "./draft_persist.js";
import { createDraft } from "../domain/draft.js";
import { nextDraftLabel } from "../domain/paths.js";
import { joinPath } from "../utils/file_utils.js";
import { createAbortError, isAbortError } from "../utils/abort_error.js";
import { getToolsForMode } from "../domain/settings_tools.js";
import { SIMPLE_AGENT_MAX_ITER } from "../config/simple_features.js";
import { extractPartialJsonStringField } from "./tool_stream_buffer.js";
import { runAgentLoop, type AgentLoopConfig, type AgentLoopEvent } from "./agent_loop.js";
import type { RepairTrace } from "./tool_args_repair.js";
import { SIMPLE_TOOL_PATH_FIELDS, SIMPLE_TOOL_SCHEMAS } from "../domain/simple_tools_zod.js";
import { createTelemetry, type TelemetrySink } from "./agent_telemetry.js";
// E4a 拆出的工具层（分类判据 / 参数修复）——内部 import，仅本文件族可见
import {
  isKnownTool,
  isMutatingTool,
  isReadOnlyTool,
  repairToolArgs,
  SIMPLE_TOOL_CHAT_REPLY,
} from "./simple_chat_tools.js";
// E4a 拆出的只读工具执行层
import { executeReadTool, loadMdDir, truncateReadResultForHistory } from "./simple_chat_read_tools.js";
// E4a 拆出的事件类型与翻译层
import {
  toDispatchErrorEvent,
  translateLoopEvent,
  type SimpleBusinessEvent,
  type SimpleChatEvent,
} from "./simple_chat_events.js";

// 公共 API 兼容：以下符号 E4a 已迁至工具/事件层，仍从本模块路径再导出，保证 services
// barrel 与既有测试（从 "../simple_chat_dispatch.js" 导入）零改动。
export {
  SIMPLE_MUTATING_TOOLS,
  SIMPLE_TOOL_CHAT_REPLY,
  SIMPLE_TOOL_SHOW_CHAPTER,
  SIMPLE_TOOL_SHOW_SETTING,
} from "./simple_chat_tools.js";
export { toDispatchErrorEvent, translateLoopEvent } from "./simple_chat_events.js";
export type { SimpleChatEvent } from "./simple_chat_events.js";

const SIMPLE_AGENT_NAME = "simple_chat";

// ---------------------------------------------------------------------------
// 幂等 / 并发防护（M17）
// ---------------------------------------------------------------------------
//
// 融合后「对话」tab 与「写文」tab 恒并列，共用同一 AU 的草稿标签空间。dispatch 在
// loop 前一次性分配草稿 label（nextDraftLabel 读当时的 existingDrafts），无重入防护时
// 两个并发生成（对话×对话、或对话流式中切写文 tab 再点生成的对话×写文跨路径）会各自
// 读到同一 existingDrafts → 拿到同一 label → 后完成者静默覆盖先完成者的草稿。
//
// 互斥表与 generateChapter 共用 chapter_inflight 单一真相源（对抗审 F1）：独立 Map
// 只能封住自身重入，封不住跨路径并发。key 用 au+chapter（label 竞争只在同章内发生）。
import {
  chapterInflightKey,
  isChapterInflight,
  markChapterInflight,
  releaseChapterInflight,
} from "./chapter_inflight.js";

function dispatchKey(au_id: string, chapter_num: number): string {
  return chapterInflightKey(au_id, chapter_num);
}

// ---------------------------------------------------------------------------
// dispatch 入参 schema
// ---------------------------------------------------------------------------

export interface SimpleChatDispatchParams {
  au_id: string;
  chapter_num: number;
  user_input: string;
  /**
   * 对话历史 messages（OpenAI 多轮格式：user/assistant 交替）。简版"全塞"哲学：
   * 不截取不简化，章节正文 / tool args 全带，让 LLM 看到完整对话连续性。token
   * 消耗在对话面板顶部 badge 显示让用户监控。空数组表示首轮（无历史）。
   * 问题 8 修复（2026-05-04）。
   */
  history?: Message[];
  session_llm: Record<string, string> | null;
  session_params: Record<string, number> | null;
  project: Project;
  state: State;
  settings: Settings;
  chapter_repo: ChapterRepository;
  draft_repo: DraftRepository;
  adapter: PlatformAdapter;
  /**
   * 记忆栈接线(融合 plan §1.1):分层对话上下文 assembleChatContext(§1.2 消费)所需。
   * 全部可选 —— 缺省视为无记忆/无 RAG,现有 caller / 单测不传不破坏;真实路径由上游
   * engine-simple-dispatch.ts 注入(与 generateChapter 同源)。
   */
  facts?: Fact[];
  threads?: Thread[];
  vector_repo?: VectorRepository;
  embedding_provider?: EmbeddingProvider;
  /**
   * E8：角色别名表（主名 → 别名列表）。透传至 assembleChatContext → retrieveRagForContext，
   * 对话正文/输入只出现别名时活跃角色过滤集也认主名。可选 + 缺省 null（现有 caller / 单测不传逐字节不变）。
   */
  character_aliases?: Record<string, string[]> | null;
  language?: "zh" | "en";
  signal?: AbortSignal;
  /** 测试注入：override LLM provider。 */
  _provider_override?: LLMProvider;
  /** 测试注入：override tools 列表。默认走 getToolsForMode("simple")。 */
  _tools_override?: ToolDefinition[];
  /** 测试注入：override telemetry sink。默认走 createTelemetry() (consoleSink fallback)。 */
  _telemetry_override?: TelemetrySink;
}

/**
 * 续写意图判据：用户消息含明确续写动词 / 长场景描述 → 续写。
 *
 * 用途：dispatch agent loop 的 guard retry —— 若用户消息不像续写指令，但 LLM 在
 * iter 0 走 text path（finish=stop + hasFullText 无 tool），说明 LLM 偏离了
 * chat_reply 路径（v4-pro C-2 review 诊断的 prompt attention dilution + thinking
 * model bias 联合根因，2026-05-04 真机暴露）。此时 dispatch 注入 hint message
 * 让 LLM 重试，避免渲染成"章节待确认卡片"误导用户。
 *
 * 关键字精确命中（仅明确写作动词）：
 * - "写" / "续写" / "续" / "继续" / "再写" / "重写" / "下一章" / "下章"
 * - "主角进" / 类似具体场景动作（暂不加，30+ 字长描述兜底）
 * 不含：单字"章"（"看第3章"误判）/ "段"（"段子"误判）/ "起"（"哪起"误判）
 *
 * 漏判 chitchat → guard retry 兜底（重试 1-2 次后 fallback flush）；
 * 误判 chitchat 为 writing → 用户看到 writing-draft 卡片，是当前 P0 痛点。
 */
const WRITING_INTENT_RE = /写|续|继续|下一章|下章|主角进|场景|开篇/;
const WRITING_INTENT_LONG_THRESHOLD = 30; // 30+ 字大概率是详细场景描述

/**
 * 设定语境判据：消息点名设定对象（设定/人设/角色卡/世界观/铁律/文风）。
 * 「把讨论的人设写入角色卡」「改一下女主设定」都含「写/改」字，但意图是设定操作，
 * 不是续写 —— 误判为续写时 suppressTokens=false 会关掉 deviation guard，模型一旦
 * 用纯文本回（弱模型常见偏离），人设内容会被当章节正文落成草稿卡（2026-09-04 mock
 * 复现实证：46 字人设 → 「接受为第 1 章」待确认卡）。
 */
const LORE_NOUN_RE = /设定|人设|角色卡|世界观|铁律|文风/;

/**
 * 强续写信号：出现它们时即使点名设定对象也仍判续写
 * （「写第 3 章主角人设崩塌的戏」是续写，不是设定操作）。
 */
const STRONG_WRITING_RE = /第\s*\d+\s*章|下一章|下章|续写|继续写|正文|开篇|开头|结尾/;

function looksLikeWritingIntent(userInput: string): boolean {
  const trimmed = userInput.trim();
  if (trimmed.length === 0) return false;
  // 设定语境优先于单字「写」：「把人设写入角色卡」是设定操作不是续写；
  // 带强续写信号（第N章/下一章/续写…）时例外，仍判续写。
  if (LORE_NOUN_RE.test(trimmed) && !STRONG_WRITING_RE.test(trimmed)) return false;
  if (WRITING_INTENT_RE.test(trimmed)) return true;
  if (trimmed.length >= WRITING_INTENT_LONG_THRESHOLD) return true;
  return false;
}

/**
 * 设定意图判据（deviation guard 的 hint 分流用）：点名设定对象且未被判为续写。
 * 为 true 时 guard hint 引导模型用 create/modify 工具写入（而不是笼统叫回 chat_reply ——
 * 对「写入角色卡」类消息叫回 chat_reply 是又一次错误纠偏）。
 */
function looksLikeLoreIntent(userInput: string): boolean {
  const trimmed = userInput.trim();
  return trimmed.length > 0 && LORE_NOUN_RE.test(trimmed) && !looksLikeWritingIntent(trimmed);
}

// ---------------------------------------------------------------------------
// dispatch 拆分件（C2 对抗审后按内容如实分节）：
//   ① emitRepairTelemetry —— loop 期回调组共用的 telemetry 投影 helper
//   ② DispatchStreamState —— 跨回调的**可变**共享状态（原散落闭包显式化）
//   ③ DispatchSession / resolveDispatchSession —— 前置解析出的**只读**会话上下文
// ---------------------------------------------------------------------------

/**
 * 把一次 repairToolArgs 的修复轨迹 + 校验结果投影为 telemetry 事件。
 *
 * 从 dispatch 内联闭包提为模块级纯函数（拆分重构 2026-07-11 架构维）：唯一依赖是注入
 * 的 telemetry sink，无共享状态，可独立单测；回调组四处调用点共用同一实现。
 */
function emitRepairTelemetry(
  telemetry: TelemetrySink,
  toolName: string,
  repaired: { repairs: RepairTrace[]; success: boolean },
): void {
  for (const r of repaired.repairs) {
    telemetry.emit({
      kind: "tool_input_repaired",
      agentName: SIMPLE_AGENT_NAME,
      toolName,
      repairKind: r.kind,
      field: r.field,
    });
  }
  if (!repaired.success) {
    telemetry.emit({
      kind: "tool_input_invalid",
      agentName: SIMPLE_AGENT_NAME,
      toolName,
      remainingIssueCount: 0,
    });
  }
}

/**
 * dispatch 单次流式生成的可变共享状态 —— 原先是 dispatchSimpleChat 上帝函数内散落的
 * 6 个闭包变量。为什么要显式成对象（拆分重构 2026-07-11 架构维）：这些变量被多个
 * agent-loop 回调交叉读写（onIterStart 重置 / onTokenChunk 累积 / onToolCallDelta 推进
 * chat_reply 流式游标 / onTextPathTerminal flush buffer + 读 label / onPartialRescue 落盘
 * 置 rescueSucceeded / catch 段读 label + rescueSucceeded 定 partial_draft_label）。藏在
 * 闭包里时任一处改动都要通读整个函数确认没踩别的回调；提为显式 state 后回调工厂只依赖这
 * 一个入参，数据流一目了然、子职责可推理可测。
 *
 * 生命周期：
 * - label / rescueSucceeded：跨 iter 存活（whole-dispatch）。
 * - bufferedTokens / chatReplyEmittedLen / chatReplyStreamingActive：每 iter 由
 *   onIterStart 重置（per-iter）。
 */
interface DispatchStreamState {
  /** loop 前分配的草稿 label；error 事件的 partial_draft_label 也读它。 */
  label: string;
  // L9：rescue 是否真的把 partial 存进了 draft repo。error 事件的 partial_draft_label
  // 只有在 rescue 成功时才该指向 label —— 否则 UI「部分草稿已保存为 X」是空指针，
  // 用户点开找不到草稿。仅当 onPartialRescue 落盘成功才置 true。
  rescueSucceeded: boolean;
  /** suppressTokens 时缓冲的 token，text 路径确认后再 flush。 */
  bufferedTokens: string[];
  /** chat_reply args.content 已 emit 的字符数（流式增量游标）。 */
  chatReplyEmittedLen: number;
  /** 本 iter chat_reply 是否已进入流式（决定 terminal 时是否跳过重复 emit）。 */
  chatReplyStreamingActive: boolean;
  /**
   * 跨 iter 存活：chat_reply 是否已送达过用户（流过一个字符就算）。
   * P1 静默回喂路径会让 loop 在 chat_reply 送达后继续跑（重发坏掉的 mutating 调用），
   * 后续 iter 模型可能再调 chat_reply —— 不压会出第二个重复气泡。
   */
  chatReplyDelivered: boolean;
  /**
   * 跨 iter 存活：chat_reply 是否**完整**送达（三轮审 W3-1）。
   * chatReplyDelivered 在 content 流出半截（args 未闭合/被截断）时也会置真，
   * 若拿它当「已送达」依据，会把完整重发压掉、用户永远只看到半句气泡。
   * 只有终态 args 完整解析且已流出长度覆盖完整 content 时才置真；
   * 重复气泡抑制（onToolCallDelta）与静默回喂的「已送达」告知都以它为准。
   */
  chatReplyFullyDelivered: boolean;
}

function createDispatchStreamState(): DispatchStreamState {
  return {
    label: "",
    rescueSucceeded: false,
    bufferedTokens: [],
    chatReplyEmittedLen: 0,
    chatReplyStreamingActive: false,
    chatReplyDelivered: false,
    chatReplyFullyDelivered: false,
  };
}

/**
 * dispatch 前置解析产物 —— runAgentLoop 启动前一次性算好的全部只读上下文
 * （provider / 三层 LLM 配置与参数 / 分层对话上下文 / 工具集 / 草稿 label / 意图判据）。
 * 组装只在此发生一次（融合契约），循环内不重组、不重算 RAG。
 */
interface DispatchSession {
  provider: LLMProvider;
  llmConfig: ResolvedLLMConfig;
  modelName: string;
  llmParams: ResolvedLLMParams;
  tools: ToolDefinition[];
  /** loop 前基于当时 existingDrafts 分配的草稿 label（并发防护见 chapter_inflight）。 */
  label: string;
  /** !looksLikeWritingIntent(user_input)：非续写意图时缓冲 token 不直出。 */
  suppressTokens: boolean;
  /** looksLikeLoreIntent(user_input)：deviation guard 的 hint 分流（引导设定工具 vs chat_reply）。 */
  loreIntent: boolean;
  max_tokens: number;
  /** [systemMessage, ...history, userMessage]：组装只发生一次，进 runAgentLoop startMessages。 */
  startMessages: Message[];
}

interface ResolveDispatchDeps {
  au_id: string;
  chapter_num: number;
  user_input: string;
  history: Message[];
  session_llm: Record<string, string> | null;
  session_params: Record<string, number> | null;
  project: Project;
  state: State;
  settings: Settings;
  facts: Fact[];
  threads: Thread[];
  vector_repo?: VectorRepository;
  embedding_provider?: EmbeddingProvider;
  character_aliases?: Record<string, string[]> | null;
  chapter_repo: ChapterRepository;
  draft_repo: DraftRepository;
  adapter: PlatformAdapter;
  language: "zh" | "en";
  provider_override?: LLMProvider;
  tools_override?: ToolDefinition[];
}

/**
 * 前置解析：三层 LLM 配置/参数解析 + provider 构造 + 人设文件加载 + 分层对话上下文组装 +
 * 草稿 label 分配 + 续写意图判据。纯 async（除读文件/组装无副作用），在 markChapterInflight
 * 之后、runAgentLoop 之前调用一次。抛错则由 dispatch 的 try/catch 兜底（label 未及分配 →
 * partial_draft_label 落 null，与原语义一致）。
 */
async function resolveDispatchSession(deps: ResolveDispatchDeps): Promise<DispatchSession> {
  const {
    au_id,
    chapter_num,
    user_input,
    history,
    session_llm,
    session_params,
    project,
    state,
    settings,
    facts,
    threads,
    vector_repo,
    embedding_provider,
    character_aliases,
    chapter_repo,
    draft_repo,
    adapter,
    language,
    provider_override,
    tools_override,
  } = deps;

  const llmConfig = resolveLlmConfig(session_llm, project, settings);
  const modelName = llmConfig.model;
  const llmParams = resolveLlmParams(modelName, session_params, project, settings);
  const provider = provider_override ?? createProvider(llmConfig);

  const [characterFiles, worldbuildingFiles] = await Promise.all([
    loadMdDir(adapter, joinPath(au_id, "characters")),
    loadMdDir(adapter, joinPath(au_id, "worldbuilding")),
  ]);

  // 分层对话上下文（融合 plan §1.2/§1.3）：记忆栈（facts/剧情线/上一章/RAG/核心设定）进
  // systemContent，最新一轮 user 进 latestUserContent。**组装只在此处发生一次**（runAgentLoop
  // 之前）：systemContent 进 startMessages[0]，循环内不重组、不重算 RAG（否则每轮重检索）。
  const ctx = await assembleChatContext({
    project,
    state,
    user_input,
    facts,
    threads,
    chapter_repo,
    au_id,
    character_files: characterFiles,
    worldbuilding_files: worldbuildingFiles,
    vector_repo,
    embedding_provider,
    language,
    // H4：窗口/输出上限按实际生效模型（resolve 三层结果）算，不再只看 project.llm。
    effective_llm: llmConfig,
    character_aliases, // E8：对话正文只出现别名时活跃角色过滤集也认主名
  });
  const { systemContent, latestUserContent, max_tokens } = ctx;
  const systemMessage: Message = { role: "system", content: systemContent };
  const userMessage: Message = { role: "user", content: latestUserContent };

  const tools = tools_override ?? (getToolsForMode("simple") as unknown as ToolDefinition[]);

  const existingDrafts = await draft_repo.listByChapter(au_id, chapter_num);
  const label = nextDraftLabel(existingDrafts.map((d) => d.variant));

  const suppressTokens = !looksLikeWritingIntent(user_input);
  const loreIntent = looksLikeLoreIntent(user_input);

  return {
    provider,
    llmConfig,
    modelName,
    llmParams,
    tools,
    label,
    suppressTokens,
    loreIntent,
    max_tokens,
    startMessages: [systemMessage, ...history, userMessage],
  };
}

// ---------------------------------------------------------------------------
// agent loop 回调组 —— 共享闭包状态显式化为 DispatchStreamState + 回调工厂
// ---------------------------------------------------------------------------

interface BuildAgentLoopConfigDeps {
  session: DispatchSession;
  streamState: DispatchStreamState;
  startTime: number;
  au_id: string;
  chapter_num: number;
  chapter_repo: ChapterRepository;
  draft_repo: DraftRepository;
  adapter: PlatformAdapter;
  language: "zh" | "en";
  telemetry: TelemetrySink;
  signal?: AbortSignal;
}

/**
 * 构造喂给 runAgentLoop 的 AgentLoopConfig —— 原上帝函数里 260+ 行的内联对象字面量。
 * 全部回调只依赖注入的三样（session 只读上下文 + streamState 可变共享状态 + 少量 dep），
 * 不再闭包捕获散落的裸变量：改任一回调只需看这三样，事件序/终态语义原样保留。
 */
function buildAgentLoopConfig(deps: BuildAgentLoopConfigDeps): AgentLoopConfig<SimpleBusinessEvent> {
  const {
    session,
    streamState: st,
    startTime,
    au_id,
    chapter_num,
    chapter_repo,
    draft_repo,
    adapter,
    language,
    telemetry,
    signal,
  } = deps;
  const { llmConfig, modelName, llmParams, tools, suppressTokens, loreIntent } = session;

  return {
    agentName: SIMPLE_AGENT_NAME,
    maxIter: SIMPLE_AGENT_MAX_ITER,
    tools,
    toolChoice: "auto",
    zodSchemas: SIMPLE_TOOL_SCHEMAS,
    pathFields: SIMPLE_TOOL_PATH_FIELDS,
    isReadOnlyTool,
    isMutatingTool,
    isTerminalTool: (name) => name === SIMPLE_TOOL_CHAT_REPLY,
    executeReadTool: async (name, args, _sig) => executeReadTool(name, args, { au_id, chapter_repo, adapter }),
    onIterStart: async () => {
      st.bufferedTokens = [];
      st.chatReplyEmittedLen = 0;
      st.chatReplyStreamingActive = false;
    },
    onTokenChunk: (delta) => {
      if (suppressTokens) {
        st.bufferedTokens.push(delta);
        return false;
      }
      return true;
    },
    onToolCallDelta: (buf) => {
      if (buf.name !== SIMPLE_TOOL_CHAT_REPLY) return undefined;
      // P1：chat_reply 在**之前的 iter** 已完整送达过（静默回喂重试轮模型又调了一次）→ 不再流式，
      // 防重复气泡。判定用 chatReplyFullyDelivered 而非 chatReplyDelivered（W3-1：半截气泡不算送达，
      // 重发必须放行）。同 iter 的续流（streamingActive 本 iter 已开）不拦，否则增量被截断。
      if (st.chatReplyFullyDelivered && !st.chatReplyStreamingActive) return undefined;
      const partial = extractPartialJsonStringField(buf.args, "content");
      if (partial === null || partial.length <= st.chatReplyEmittedLen) return undefined;
      const delta = partial.slice(st.chatReplyEmittedLen);
      st.chatReplyEmittedLen = partial.length;
      st.chatReplyStreamingActive = true;
      st.chatReplyDelivered = true;
      return [{ type: "business", data: { kind: "chat_reply_chunk", data: delta } }];
    },
    onTextPathTerminal: async (iterCtx) => {
      const hasMutatingInBatch = iterCtx.toolCalls.some((c) => isMutatingTool(c.function.name));
      const emitText = iterCtx.hasFullText && !hasMutatingInBatch;
      const emitTools = iterCtx.hasTools;

      if (iterCtx.hasFullText && hasMutatingInBatch) {
        telemetry.emit({
          kind: "double_emit_with_mutating_tool",
          agentName: SIMPLE_AGENT_NAME,
          fullTextLen: iterCtx.fullText.length,
        });
      }

      const events: AgentLoopEvent<SimpleBusinessEvent>[] = [];

      if (suppressTokens && emitText && st.bufferedTokens.length > 0) {
        for (const t of st.bufferedTokens) events.push({ type: "token", data: t });
      }

      if (emitText) {
        const elapsedMs = Math.trunc(performance.now() - startTime);
        const { generated_with: gw } = await persistGeneratedDraft({
          au_id,
          chapter_num,
          variant: st.label,
          content: iterCtx.fullText,
          mode: llmConfig.mode,
          model: modelName,
          temperature: llmParams.temperature,
          top_p: llmParams.top_p,
          input_tokens: iterCtx.inputTokens,
          output_tokens: iterCtx.outputTokens ?? 0,
          duration_ms: elapsedMs,
          draft_repo,
        });
        events.push({
          type: "business",
          data: {
            kind: "done_text",
            data: { full_text: iterCtx.fullText, draft_label: st.label, chapter_num, generated_with: gw },
          },
        });
      }

      if (emitTools) {
        for (const c of iterCtx.toolCalls) events.push({ type: "tool_call", data: c });
        events.push({ type: "business", data: { kind: "done_tools", data: { tool_calls: iterCtx.toolCalls } } });
      }

      return events;
    },
    onForceToolPath: async (calls, iterCtx) => {
      const events: AgentLoopEvent<SimpleBusinessEvent>[] = [];
      const hasChatReply = calls.some((c) => c.function.name === SIMPLE_TOOL_CHAT_REPLY);

      // Branch 1: chat_reply terminal (含 mixed read-only)
      if (hasChatReply) {
        const readOnlyCalls = calls.filter((c) => isReadOnlyTool(c.function.name));
        // P1：read-only 结果顺手收集 —— 静默回喂路径要把它们按 OpenAI 协议配对进 internalHistory
        const readOnlyResults = new Map<string, string>();
        for (const c of readOnlyCalls) {
          if (signal?.aborted) throw createAbortError();
          events.push({ type: "tool_call", data: c });
          const repaired = repairToolArgs(c.function.name, c.function.arguments);
          emitRepairTelemetry(telemetry, c.function.name, repaired);
          const result = await executeReadTool(c.function.name, repaired.args, { au_id, chapter_repo, adapter });
          if (signal?.aborted) throw createAbortError();
          readOnlyResults.set(c.id, result.content);
          events.push({
            type: "tool_result",
            data: {
              tool_call_id: c.id,
              tool_name: c.function.name,
              content: result.content,
              ...(result.errorMessage !== undefined ? { error_message: result.errorMessage } : {}),
            },
          });
        }
        const restCalls = calls.filter((c) => !isReadOnlyTool(c.function.name));

        // P1（2026-09-04，对标 pi-ai 执行层哲学）：先扫全部 mutating 调用的 repair 结果。
        // 有任何一个无效（含未知工具）→ 走静默回喂 continue，坏参数绝不渲染成确认卡
        // （旧行为原样 emit → UI safeParseArgs 静默转 {} → 用户看到空 JSON 卡，实证根源）。
        const mutatingChecks = restCalls
          .filter((c) => c.function.name !== SIMPLE_TOOL_CHAT_REPLY)
          .map((c) => {
            const repaired = repairToolArgs(c.function.name, c.function.arguments);
            emitRepairTelemetry(telemetry, c.function.name, repaired);
            return { call: c, repaired, known: isKnownTool(c.function.name) };
          });
        const hasInvalidMutating = mutatingChecks.some((m) => !m.repaired.success || !m.known);

        if (!hasInvalidMutating) {
          // 全 valid → 原 terminal 路径（emit 修复后 args，与旧 M15 口径一致）
          const checkById = new Map(mutatingChecks.map((m) => [m.call.id, m]));
          for (const c of restCalls) {
            if (c.function.name === SIMPLE_TOOL_CHAT_REPLY && (st.chatReplyStreamingActive || st.chatReplyDelivered))
              continue;
            const m = checkById.get(c.id);
            if (m) {
              events.push({
                type: "tool_call",
                data: { ...c, function: { ...c.function, arguments: JSON.stringify(m.repaired.args) } },
              });
              continue;
            }
            events.push({ type: "tool_call", data: c });
          }
          events.push({ type: "business", data: { kind: "done_tools", data: { tool_calls: calls } } });
          return { mode: "terminal", events };
        }

        // —— 静默回喂路径（continue）：assistant tool_calls + 全部配对的 tool result 入
        // internalHistory，模型下一轮重发修正后的调用。chat_reply 已送达用户（流式气泡），
        // 用合成 result 告知无需重发；valid 的 mutating 与 Branch 3 同口径 TOOL_BATCH_RETRY。
        iterCtx.internalHistory.push({
          role: "assistant",
          content: iterCtx.fullText,
          tool_calls: calls,
          ...(iterCtx.reasoningContent ? { reasoning_content: iterCtx.reasoningContent } : {}),
        });
        const checkById2 = new Map(mutatingChecks.map((m) => [m.call.id, m]));
        for (const c of calls) {
          let content: string;
          if (c.function.name === SIMPLE_TOOL_CHAT_REPLY) {
            // 二轮审 W2-2 + 三轮审 W3-1：只有「完整送达」才算已送达——
            // 终态 args 完整解析、content 非空且已流出长度覆盖完整 content。
            // 空参数 / 半截气泡（未闭合、被截断）一律视为未送达，回喂重发提示、下轮不压。
            if (!st.chatReplyFullyDelivered && st.chatReplyDelivered) {
              try {
                const parsed = JSON.parse(c.function.arguments || "{}") as { content?: unknown };
                if (
                  typeof parsed.content === "string" &&
                  parsed.content.length > 0 &&
                  parsed.content.length <= st.chatReplyEmittedLen
                ) {
                  st.chatReplyFullyDelivered = true;
                }
              } catch {
                /* args 不完整（未闭合/截断）→ 保持未送达 */
              }
            }
            content = st.chatReplyFullyDelivered
              ? "[chat_reply 已送达用户，无需重发]"
              : "注意：chat_reply 未完整送达（content 为空或参数被截断），用户未收到消息。请重新发出带完整 content 的 chat_reply。";
          } else if (isReadOnlyTool(c.function.name)) {
            content = truncateReadResultForHistory(readOnlyResults.get(c.id) ?? "", llmConfig, language);
          } else {
            const m = checkById2.get(c.id);
            const invalid = !m?.repaired.success || !m.known;
            if (invalid) {
              content = m?.repaired.retryHint ?? `注意：工具 ${c.function.name} 参数无效，请重发完整合法的 JSON 参数。`;
            } else {
              content = `TOOL_BATCH_RETRY: a sibling tool call had invalid args; please reissue this call next round if still needed. Original call: ${c.function.name}(${c.function.arguments || "{}"})`;
            }
          }
          // 二轮审 W2-3：静默回喂的 result 只入 internalHistory（当前 loop 协议配对用），
          // 不 emit 到 UI/持久化层——没有对应的 UI tool_call，落库会变孤儿消息。
          iterCtx.internalHistory.push({ role: "tool", tool_call_id: c.id, content });
        }
        return { mode: "continue", events };
      }

      // Branch 2: all read-only continue
      const allReadOnly = calls.every((c) => isReadOnlyTool(c.function.name));
      if (allReadOnly) {
        iterCtx.internalHistory.push({
          role: "assistant",
          content: iterCtx.fullText,
          tool_calls: calls,
          ...(iterCtx.reasoningContent ? { reasoning_content: iterCtx.reasoningContent } : {}),
        });
        for (const c of calls) {
          if (signal?.aborted) throw createAbortError();
          events.push({ type: "tool_call", data: c });
          const repaired = repairToolArgs(c.function.name, c.function.arguments);
          emitRepairTelemetry(telemetry, c.function.name, repaired);
          const result = await executeReadTool(c.function.name, repaired.args, { au_id, chapter_repo, adapter });
          if (signal?.aborted) throw createAbortError();
          events.push({
            type: "tool_result",
            data: {
              tool_call_id: c.id,
              tool_name: c.function.name,
              content: result.content,
              ...(result.errorMessage !== undefined ? { error_message: result.errorMessage } : {}),
            },
          });
          // internalHistory 副本按上限截断（B3）：防多轮大章节 fetch 累积撑爆 context。
          // 上面 emit 给 UI 的 tool_result 仍是全文（持久化不丢）。
          // H4：token 计数配置用实际生效 LLM（countTokens 现只看 mode，行为等价；保持同源）。
          iterCtx.internalHistory.push({
            role: "tool",
            tool_call_id: c.id,
            content: truncateReadResultForHistory(result.content, llmConfig, language),
          });
        }
        return { mode: "continue", events };
      }

      // Branch 3: mutating (含 mixed, no chat_reply) — validate args
      const validations = calls.map((c) => {
        const repaired = repairToolArgs(c.function.name, c.function.arguments);
        emitRepairTelemetry(telemetry, c.function.name, repaired);
        return {
          call: c,
          isMutating: isMutatingTool(c.function.name),
          known: isKnownTool(c.function.name),
          valid: repaired.success,
          retryHint: repaired.retryHint,
          // F6：valid 路径 emit 修复后的 args（与 Branch 1 的 M15 口径一致）——
          // UI confirm 卡片展示/执行的必须是修复产物，原样透传的路径污染无从纠正。
          repairedArgs: repaired.args,
        };
      });
      // M15：未知工具（LLM 幻觉的工具名，非 mutating/read-only/chat_reply、无 schema）
      // 同样触发 retry 路径 —— repairToolArgs 对无 schema 的工具返回 success=false +
      // "工具名是否正确" retryHint，但旧 hasInvalidArgs 只看 isMutating，未知工具
      // 被漏过、原样 emit 成无法执行的待确认卡片，"注 hint 让 LLM 改正"死路。
      const hasInvalidArgs = validations.some((v) => (v.isMutating || !v.known) && !v.valid);

      if (hasInvalidArgs) {
        iterCtx.internalHistory.push({
          role: "assistant",
          content: iterCtx.fullText,
          tool_calls: calls,
          ...(iterCtx.reasoningContent ? { reasoning_content: iterCtx.reasoningContent } : {}),
        });
        for (const v of validations) {
          const c = v.call;
          const errContent = !v.valid
            ? (v.retryHint ?? `注意：工具 ${c.function.name} 参数无效，请重试。`)
            : `TOOL_BATCH_RETRY: a sibling tool call had invalid args; please reissue this call next round if still needed. Original call: ${c.function.name}(${c.function.arguments || "{}"})`;
          events.push({
            type: "tool_result",
            data: {
              tool_call_id: c.id,
              tool_name: c.function.name,
              content: errContent,
              error_message: !v.valid ? `${c.function.name} 参数无效，已让 AI 重试` : undefined,
            },
          });
          iterCtx.internalHistory.push({
            role: "tool",
            tool_call_id: c.id,
            content: errContent,
          });
        }
        return { mode: "continue", events };
      }

      // mutating valid → emit 修复后 args + terminal break（F6：与 Branch 1 同口径）
      for (const v of validations) {
        events.push({
          type: "tool_call",
          data: { ...v.call, function: { ...v.call.function, arguments: JSON.stringify(v.repairedArgs) } },
        });
      }
      events.push({ type: "business", data: { kind: "done_tools", data: { tool_calls: calls } } });
      return { mode: "terminal", events };
    },
    onGuardRetry: (kind, ctx) => {
      if (kind === "deviation") {
        if (!suppressTokens) return null;
        telemetry.emit({
          kind: "chat_reply_deviation_guard",
          agentName: SIMPLE_AGENT_NAME,
          count: ctx.count + 1,
          iter: ctx.iter,
        });
        // 设定意图的 hint 不能笼统叫回 chat_reply（用户要的是写入文件）——
        // 明确引导 create/modify 工具；讨论则 chat_reply。两方向都给出路，模型自我纠正。
        if (loreIntent) {
          return {
            role: "user",
            content:
              language === "en"
                ? "[system note] If the user is asking to create or update settings (character card, worldbuilding, writing style, pinned rules), call the corresponding create/modify tool with all required fields filled. If the user is just discussing, use the chat_reply tool. Do NOT output settings content as plain text."
                : "[系统提示] 如果用户是在要求创建/修改设定（角色卡、世界观、文风、铁律等），请调用对应的 create/modify 工具并把 required 字段带全；如果只是讨论，请用 chat_reply tool 回复。不要把设定内容用纯文本输出。",
          };
        }
        return {
          role: "user",
          content:
            language === "en"
              ? "[system note] You replied with plain text but the user message was not a writing instruction. Please use the chat_reply tool to respond (put your reply in the content field)."
              : "[系统提示] 你刚才用纯文本回复了，但用户消息不是续写指令。请改用 chat_reply tool 重新回复（把要说的话填在 content 字段）。",
        };
      }
      telemetry.emit({
        kind: "empty_response_guard",
        agentName: SIMPLE_AGENT_NAME,
        count: ctx.count + 1,
        iter: ctx.iter,
      });
      return {
        role: "user",
        content:
          language === "en"
            ? "[system note] Your previous response was empty. Please respond with chat_reply tool (concise content) or write the chapter body if applicable."
            : "[系统提示] 你刚才返回空响应。请用 chat_reply tool 简洁回复，或者如果是续写则直接输出章节正文。",
      };
    },
    onPartialRescue: async (text) => {
      if (!text || !st.label) return { rescued: false };
      const partial = createDraft({ au_id, chapter_num, variant: st.label, content: text });
      try {
        await withAuLock(au_id, async () => {
          await draft_repo.save(partial);
        });
        st.rescueSucceeded = true;
        telemetry.emit({
          kind: "partial_draft_rescued",
          agentName: SIMPLE_AGENT_NAME,
          label: st.label,
          len: text.length,
        });
        return { rescued: true, label: st.label };
      } catch {
        return { rescued: false };
      }
    },
    // P3 截断防御：finish=length 的 tool 调用一律不弹卡——assistant tool_calls +
    // 每个调用的「参数可能被截断」错误 result 入 internalHistory，模型下轮重发完整参数。
    // 长 content（人设正文）撞输出上限是高频场景，附「精简/分批」指引。
    onTruncatedToolCalls: async (calls, iterCtx) => {
      telemetry.emit({
        kind: "truncated_tool_calls_retry",
        agentName: SIMPLE_AGENT_NAME,
        count: iterCtx.iter + 1,
        iter: iterCtx.iter,
        toolCount: calls.length,
      });
      iterCtx.internalHistory.push({
        role: "assistant",
        content: iterCtx.fullText,
        tool_calls: calls,
        ...(iterCtx.reasoningContent ? { reasoning_content: iterCtx.reasoningContent } : {}),
      });
      const events: AgentLoopEvent<SimpleBusinessEvent>[] = [];
      for (const c of calls) {
        const content =
          language === "en"
            ? `Tool call "${c.function.name}" was not executed: the response hit the output token limit, so its arguments may be truncated. Re-issue the tool call with complete arguments. If the content is long, shorten it or split into smaller pieces.`
            : `工具 ${c.function.name} 未执行：响应达到输出长度上限，参数可能被截断。请重新发出完整参数的调用；如果 content 较长，请精简后重发。`;
        // 二轮审 W2-3：截断回喂的 result 只入 internalHistory，不 emit 到 UI/持久化层（孤儿消息）。
        iterCtx.internalHistory.push({ role: "tool", tool_call_id: c.id, content });
      }
      return { retry: true, events };
    },
    telemetry,
  };
}

// ---------------------------------------------------------------------------
// 主流程 —─ 前置解析 → 构造 state/回调 → for await 循环委托翻译 → 收尾
// ---------------------------------------------------------------------------

export async function* dispatchSimpleChat(params: SimpleChatDispatchParams): AsyncGenerator<SimpleChatEvent> {
  const {
    au_id,
    chapter_num,
    user_input,
    history = [],
    session_llm,
    session_params,
    project,
    state,
    settings,
    facts = [],
    threads = [],
    vector_repo,
    embedding_provider,
    character_aliases = null,
    chapter_repo,
    draft_repo,
    adapter,
    language = "zh",
    signal,
    _provider_override,
    _tools_override,
    _telemetry_override,
  } = params;

  // M17+F1：同 (au, chapter) 已有在飞生成（对话或写文任一路径）→ 直接 409 拒绝，
  // 不进 loop、不分配 label。
  const concurrencyKey = dispatchKey(au_id, chapter_num);
  if (isChapterInflight(concurrencyKey)) {
    yield {
      type: "error",
      data: {
        error_code: "DISPATCH_IN_PROGRESS",
        message:
          language === "en"
            ? "This chapter is already being generated. Please wait for it to finish."
            : "该章节正在生成中，请等待完成",
        actions: [],
        partial_draft_label: null,
      },
    };
    return;
  }

  const telemetry = _telemetry_override ?? createTelemetry();
  const streamState = createDispatchStreamState();
  const startTime = performance.now();

  // M17：占用并发标志紧贴 try —— finally 保证释放，中间无可抛点，避免标志泄漏锁死本章。
  markChapterInflight(concurrencyKey, "dispatch");
  try {
    // 前置解析段：一次性算好 provider / 上下文 / label / 意图判据。
    const session = await resolveDispatchSession({
      au_id,
      chapter_num,
      user_input,
      history,
      session_llm,
      session_params,
      project,
      state,
      settings,
      facts,
      threads,
      vector_repo,
      embedding_provider,
      character_aliases,
      chapter_repo,
      draft_repo,
      adapter,
      language,
      provider_override: _provider_override,
      tools_override: _tools_override,
    });
    // label 从只读 session 落到可变 streamState —— 回调组 / catch 段统一读 streamState.label。
    streamState.label = session.label;

    // agent loop 回调组：共享闭包已显式化为 streamState，回调工厂只依赖 (session + state + dep)。
    const config = buildAgentLoopConfig({
      session,
      streamState,
      startTime,
      au_id,
      chapter_num,
      chapter_repo,
      draft_repo,
      adapter,
      language,
      telemetry,
      signal,
    });

    // 跑 runAgentLoop + 事件翻译委托：event 有则 yield，terminal 则终止。
    for await (const ev of runAgentLoop(
      config,
      session.provider,
      session.startMessages,
      { max_tokens: session.max_tokens, temperature: session.llmParams.temperature, top_p: session.llmParams.top_p },
      signal,
    )) {
      const { event, terminal } = translateLoopEvent(ev, language);
      if (event) yield event;
      if (terminal) return;
    }
  } catch (e) {
    // AbortError 直接透传给 caller，不 emit error event。
    if (isAbortError(e)) {
      throw e;
    }
    // partial rescue 已在 onPartialRescue 内处理，这里只 emit error event。
    // L9：partial_draft_label 只有在 rescue 真落盘成功时才给 label（详见 DispatchStreamState）。
    yield toDispatchErrorEvent(e, streamState.rescueSucceeded ? streamState.label : null);
  } finally {
    // M17：无论正常结束 / error / abort throw，都要释放并发标志，否则该 (au, chapter)
    // 永久被锁死无法再生成。
    releaseChapterInflight(concurrencyKey);
  }
}
