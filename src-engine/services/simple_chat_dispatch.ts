// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge Lite — simple_chat_dispatch（agent MVP Phase 1, T4）
 *
 * 简版 multi-turn agent loop。一次 dispatch 可能多轮 LLM call：
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
import type { LLMProvider, Message, ToolCall, ToolDefinition } from "../llm/provider.js";
import { LLMError } from "../llm/provider.js";
import {
  create_provider,
  resolve_llm_config,
  resolve_llm_params,
  type ResolvedLLMConfig,
  type ResolvedLLMParams,
} from "../llm/config_resolver.js";
import { assemble_chat_context } from "./context_assembler.js";
import { count_tokens } from "../tokenizer/index.js";
import { withAuLock } from "./au_lock.js";
import { persistGeneratedDraft } from "./draft_persist.js";
import { createDraft } from "../domain/draft.js";
import { nextDraftLabel } from "../domain/paths.js";
import type { GeneratedWith } from "../domain/generated_with.js";
import { joinPath } from "../utils/file_utils.js";
import { createAbortError, isAbortError } from "../utils/abort_error.js";
import { get_tools_for_mode } from "../domain/settings_tools.js";
import { SIMPLE_AGENT_MAX_ITER } from "../config/simple_features.js";
import { extractPartialJsonStringField } from "./tool_stream_buffer.js";
import { runAgentLoop, type AgentLoopConfig, type AgentLoopEvent } from "./agent_loop.js";
import { repairAndValidateToolArgs, type RepairTrace } from "./tool_args_repair.js";
import { SIMPLE_TOOL_SCHEMAS, SIMPLE_TOOL_PATH_FIELDS } from "../domain/simple_tools_zod.js";
import { createTelemetry, type TelemetrySink } from "./agent_telemetry.js";

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
// 互斥表与 generate_chapter 共用 chapter_inflight 单一真相源（对抗审 F1）：独立 Map
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
// 常量 — UI 端 switch case 引用，避免字符串散落
// ---------------------------------------------------------------------------

export const SIMPLE_TOOL_SHOW_CHAPTER = "show_chapter";
export const SIMPLE_TOOL_SHOW_SETTING = "show_setting";
export const SIMPLE_TOOL_CHAT_REPLY = "chat_reply";

const SIMPLE_READ_ONLY_TOOLS: ReadonlySet<string> = new Set([SIMPLE_TOOL_SHOW_CHAPTER, SIMPLE_TOOL_SHOW_SETTING]);

/**
 * 修改类工具集合（agent loop 走 human-in-the-loop：emit ToolCallCard → break → 用户
 * confirm 后另起 dispatch round）。
 *
 * 从「实际下发给 LLM 的工具集」get_tools_for_mode("simple") 派生，不再手工双列
 * （盲审 2026-07-11 功能维：旧手工列表额外含 create_/modify_core_character_file —— 它们
 * 从不下发给简版 LLM、UI 执行器也无实现，LLM 幻觉调用会渲染成「可确认却执行不了」的
 * 卡片。派生保证：能出确认卡的 ≡ 真正下发且 UI 可执行的修改类工具，两侧永不漂移）。
 */
export const SIMPLE_MUTATING_TOOLS: ReadonlySet<string> = new Set(
  (get_tools_for_mode("simple") as { function: { name: string } }[])
    .map((t) => t.function.name)
    .filter((n) => n !== SIMPLE_TOOL_CHAT_REPLY && !SIMPLE_READ_ONLY_TOOLS.has(n)),
);

function isMutatingTool(name: string): boolean {
  return SIMPLE_MUTATING_TOOLS.has(name);
}

function isReadOnlyTool(name: string): boolean {
  return SIMPLE_READ_ONLY_TOOLS.has(name);
}

/**
 * 已知（受声明）的工具集合：read-only + mutating + chat_reply + 有 zod schema 的。
 * LLM 幻觉出未声明的工具名（M15）时 isKnownTool=false —— 此类调用参数一律视为无效，
 * 走 repair 的 retryHint 路径让 LLM 改选合法工具，而不是原样 emit 成"无名待确认卡片"
 * （既无 schema 也无执行器，用户 confirm 也执行不了）。
 */
function isKnownTool(name: string): boolean {
  return (
    isReadOnlyTool(name) ||
    isMutatingTool(name) ||
    name === SIMPLE_TOOL_CHAT_REPLY ||
    Object.hasOwn(SIMPLE_TOOL_SCHEMAS, name)
  );
}

/**
 * read-only fetch（show_chapter / show_setting）结果注入 internalHistory 的 token 上限
 * （融合 plan §1.3 B3）。
 *
 * 为什么要截断：agent loop 多轮里，LLM 可能连续 show 多个大章节，每个结果都 append 进
 * internalHistory 喂下一轮 —— 不设上限会让 internalHistory 单调增长撑爆 context（组装期
 * assemble_chat_context 的 chatHistoryReserve 只为"对话历史"留余量，管不到循环内 fetch）。
 *
 * 截断只作用于 LLM 可见的 internalHistory 副本；emit 给 UI 的 tool_result 仍是全文（持久化
 * 不丢）。正常章节（1500-3000 字 ≈ 2-4k tokens）原样通过；仅病态超长文件被截断，保留头部 +
 * 自然语言截断标记（让 LLM 知道这是节选，可再 show 具体段落）。
 *
 * 实测观察点：MAX_READ_FETCH_TOKENS 是保守上限，若多轮长章节场景仍偏紧可下调。
 */
const MAX_READ_FETCH_TOKENS = 6000;

function truncateReadResultForHistory(content: string, llm_config: unknown, language: "zh" | "en"): string {
  const tk = (s: string) => count_tokens(s, llm_config as { mode?: string }).count;
  const total = tk(content);
  if (total <= MAX_READ_FETCH_TOKENS) return content;
  // 按 token/char 比例首切（留 10% 余量让首切大概率落在预算内），再线性微调（保留头部）。
  let head = content.slice(0, Math.max(1, Math.trunc((content.length * MAX_READ_FETCH_TOKENS * 0.9) / total)));
  while (tk(head) > MAX_READ_FETCH_TOKENS && head.length > 1) {
    head = head.slice(0, Math.trunc(head.length * 0.9));
  }
  const marker =
    language === "en"
      ? "\n\n[... fetched content truncated to fit context; ask to show a specific section if needed ...]"
      : "\n\n[……读取内容过长，已截断以适配上下文；如需具体段落请指明……]";
  return head + marker;
}

// ---------------------------------------------------------------------------
// 事件 + 参数 schema
// ---------------------------------------------------------------------------

export type SimpleChatEvent =
  | { type: "token"; data: string }
  | { type: "tool_call"; data: ToolCall } // 累积完成的单个 tool call
  /**
   * chat_reply tool args.content 字段流式增量。dispatch 边累积 tool_call_deltas 边
   * partial-parse content 字段，每次新内容 emit 给 UI 实时渲染对话气泡。流式期间
   * 不 emit chat_reply 的 tool_call 事件（避免 UI 重复 append）；hasChatReply 终结
   * 路径只 emit 其它（read-only / mutating）tool_call。
   * 真机 2026-05-04 选 Option A 实现 (用户确认)。
   */
  | { type: "chat_reply_chunk"; data: string }
  /**
   * agent loop 自动 fetch read-only tool 的结果。UI 持久化为 SimpleToolResultMessage
   * 落 chat.yaml；同时由 dispatch 直接注入 internalHistory 喂下一轮，UI 不需回传。
   * tool_call_id 必须跟同 iter 的 tool_call 事件 data.id 对得上（OpenAI 协议要求）。
   */
  | { type: "tool_result"; data: { tool_call_id: string; tool_name: string; content: string; error_message?: string } }
  | {
      type: "done_text";
      data: { full_text: string; draft_label: string; chapter_num: number; generated_with: GeneratedWith };
    }
  | { type: "done_tools"; data: { tool_calls: ToolCall[] } }
  | {
      type: "error";
      data: { error_code: string; message: string; actions: string[]; partial_draft_label: string | null };
    };

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
   * 记忆栈接线(融合 plan §1.1):分层对话上下文 assemble_chat_context(§1.2 消费)所需。
   * 全部可选 —— 缺省视为无记忆/无 RAG,现有 caller / 单测不传不破坏;真实路径由上游
   * engine-simple-dispatch.ts 注入(与 generate_chapter 同源)。
   */
  facts?: Fact[];
  threads?: Thread[];
  vector_repo?: VectorRepository;
  embedding_provider?: EmbeddingProvider;
  language?: "zh" | "en";
  signal?: AbortSignal;
  /** 测试注入：override LLM provider。 */
  _provider_override?: LLMProvider;
  /** 测试注入：override tools 列表。默认走 get_tools_for_mode("simple")。 */
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

function looksLikeWritingIntent(userInput: string): boolean {
  const trimmed = userInput.trim();
  if (trimmed.length === 0) return false;
  if (WRITING_INTENT_RE.test(trimmed)) return true;
  if (trimmed.length >= WRITING_INTENT_LONG_THRESHOLD) return true;
  return false;
}

/**
 * 通过 Layer 1 (tool_args_repair) 校验 + 修复 LLM 给的 tool args。
 *
 * 整合 commit 6beb720 引入的"args=`{}` 触发 retry hint"路径 + Awais (CommandCode)
 * 帖子的 4 类形状修复 + Markdown 链接拆解（路径字段污染）。返：
 *   - args:      修复后参数（success=true 时）或空对象（fail 时走 retry 路径）
 *   - retryHint: fail 时给 LLM 的可读提示（已加"注意："前缀避免 TUI 标红 / 模型把
 *                它当 fatal 中断推理）
 *   - success:   schema 最终校验通过与否
 *   - repairs:   trace 数组，留 telemetry hook（commit 6 接 Layer 5 后逐条 emit
 *                tool_input_repaired:{toolName}:{kind}）
 *
 * 未知 tool name（理论上 LLM 不调无声明的 tool）→ 退化到 JSON.parse 兜底 + 通用
 * retry hint，让 LLM 改选其它 tool。
 */
function repairToolArgs(
  toolName: string,
  rawArgs: string,
): {
  args: Record<string, unknown>;
  retryHint?: string;
  success: boolean;
  repairs: RepairTrace[];
} {
  const schema = SIMPLE_TOOL_SCHEMAS[toolName];
  const pathFields = SIMPLE_TOOL_PATH_FIELDS[toolName];
  if (!schema) {
    let parsed: Record<string, unknown> = {};
    try {
      const obj = JSON.parse(rawArgs || "{}");
      if (obj && typeof obj === "object" && !Array.isArray(obj)) parsed = obj;
    } catch {
      /* fall through */
    }
    return {
      args: parsed,
      success: false,
      repairs: [],
      retryHint: `注意：工具 ${toolName} 没有声明的 schema，请检查工具名是否正确。`,
    };
  }
  const result = repairAndValidateToolArgs(toolName, rawArgs, schema, { pathFields });
  return {
    args: result.success ? (result.data as Record<string, unknown>) : {},
    success: result.success,
    repairs: result.repairs,
    retryHint: result.retryHint,
  };
}

/**
 * agent loop read-only tool 自动 fetch 实现。返回 OpenAI tool result content：
 * - 成功：文件原文
 * - 文件不存在：machine-readable code（FILE_NOT_FOUND / CHAPTER_NOT_FOUND），
 *   errorMessage 自然语言放 UI 持久化（不入 OpenAI history 防 LLM 把自然语言当事实）
 * - args 非法：machine-readable INVALID_ARGS code
 *
 * 关键：return content 是 LLM 看到的（机器码 + 必要 hint），errorMessage 是 UI 看到的。
 */
async function executeReadTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: { au_id: string; chapter_repo: ChapterRepository; adapter: PlatformAdapter },
): Promise<{ content: string; errorMessage?: string }> {
  if (toolName === SIMPLE_TOOL_SHOW_CHAPTER) {
    const num = Number(args.chapter_num);
    if (!Number.isInteger(num) || num <= 0) {
      return {
        content: "INVALID_ARGS: chapter_num must be a positive integer.",
        errorMessage: `show_chapter 收到非法 chapter_num：${String(args.chapter_num)}`,
      };
    }
    try {
      const exists = await ctx.chapter_repo.exists(ctx.au_id, num);
      if (!exists) {
        return {
          content: `CHAPTER_NOT_FOUND: chapter ${num} does not exist yet.`,
          errorMessage: `第 ${num} 章不存在`,
        };
      }
      const text = await ctx.chapter_repo.get_content_only(ctx.au_id, num);
      return { content: text };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: `READ_FAILED: ${msg}`,
        errorMessage: `读第 ${num} 章失败：${msg}`,
      };
    }
  }

  if (toolName === SIMPLE_TOOL_SHOW_SETTING) {
    const filePath = typeof args.file_path === "string" ? args.file_path.trim() : "";
    if (!filePath) {
      return {
        content: "INVALID_ARGS: file_path is required (e.g., 'characters/Alice.md').",
        errorMessage: "show_setting 收到空 file_path",
      };
    }
    // 防越界访问 AU 之外的文件：file_path 必须以 characters/ worldbuilding/
    // core_characters/ core_worldbuilding/ 开头，否则拒
    // 大小写不敏感比较 —— Windows / macOS fs case-insensitive，LLM 可能产 "Characters/Alice.md"
    // 这种轻微大小写漂移；正常用 lower 形式做白名单 check（v4-pro C3 review P0-3）。
    // 实际访问时保留原 case 让 fs 自己处理（Windows/Mac 大小写不敏感会命中，Linux 大小写敏感
    // 会按 LLM 给的 case 找）。
    const allowedPrefixes = ["characters/", "worldbuilding/", "core_characters/", "core_worldbuilding/"];
    const lowerPath = filePath.toLowerCase();
    if (!allowedPrefixes.some((p) => lowerPath.startsWith(p))) {
      return {
        content: `INVALID_ARGS: file_path must start with one of [${allowedPrefixes.join(", ")}]`,
        errorMessage: `show_setting 路径越界：${filePath}`,
      };
    }
    if (filePath.includes("..")) {
      return {
        content: "INVALID_ARGS: file_path must not contain '..'",
        errorMessage: `show_setting 路径含 '..'：${filePath}`,
      };
    }
    try {
      const fullPath = joinPath(ctx.au_id, filePath);
      const exists = await ctx.adapter.exists(fullPath);
      if (!exists) {
        return {
          content: "FILE_NOT_FOUND",
          errorMessage: `${filePath} 不存在`,
        };
      }
      const text = await ctx.adapter.readFile(fullPath);
      return { content: text };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: `READ_FAILED: ${msg}`,
        errorMessage: `读 ${filePath} 失败：${msg}`,
      };
    }
  }

  // 不支持的工具 — 理论上 LLM 不应到这里（dispatch 路由前已分流），但兜底
  return {
    content: `UNSUPPORTED_READ_TOOL: ${toolName}`,
    errorMessage: `executeReadTool 不识别工具：${toolName}`,
  };
}

async function loadMdDir(adapter: PlatformAdapter, dirPath: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  let exists = false;
  try {
    exists = await adapter.exists(dirPath);
  } catch {
    return result;
  }
  if (!exists) return result;
  let files: string[] = [];
  try {
    files = await adapter.listDir(dirPath);
  } catch {
    return result;
  }
  for (const f of files.sort()) {
    if (!f.endsWith(".md")) continue;
    try {
      const content = await adapter.readFile(joinPath(dirPath, f));
      result[f.replace(/\.md$/, "")] = content;
    } catch {}
  }
  return result;
}

// ---------------------------------------------------------------------------
// Business event types — simple-specific 事件透传给 agent_loop
// ---------------------------------------------------------------------------

type SimpleBusinessEvent =
  | { kind: "chat_reply_chunk"; data: string }
  | {
      kind: "done_text";
      data: { full_text: string; draft_label: string; chapter_num: number; generated_with: GeneratedWith };
    }
  | { kind: "done_tools"; data: { tool_calls: ToolCall[] } };

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
 * dispatch 单次流式生成的可变共享状态 —— 原先是 dispatch_simple_chat 上帝函数内散落的
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
}

function createDispatchStreamState(): DispatchStreamState {
  return {
    label: "",
    rescueSucceeded: false,
    bufferedTokens: [],
    chatReplyEmittedLen: 0,
    chatReplyStreamingActive: false,
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
    chapter_repo,
    draft_repo,
    adapter,
    language,
    provider_override,
    tools_override,
  } = deps;

  const llmConfig = resolve_llm_config(session_llm, project, settings);
  const modelName = llmConfig.model;
  const llmParams = resolve_llm_params(modelName, session_params, project, settings);
  const provider = provider_override ?? create_provider(llmConfig);

  const [character_files, worldbuilding_files] = await Promise.all([
    loadMdDir(adapter, joinPath(au_id, "characters")),
    loadMdDir(adapter, joinPath(au_id, "worldbuilding")),
  ]);

  // 分层对话上下文（融合 plan §1.2/§1.3）：记忆栈（facts/剧情线/上一章/RAG/核心设定）进
  // systemContent，最新一轮 user 进 latestUserContent。**组装只在此处发生一次**（runAgentLoop
  // 之前）：systemContent 进 startMessages[0]，循环内不重组、不重算 RAG（否则每轮重检索）。
  const ctx = await assemble_chat_context({
    project,
    state,
    user_input,
    facts,
    threads,
    chapter_repo,
    au_id,
    character_files,
    worldbuilding_files,
    vector_repo,
    embedding_provider,
    language,
    // H4：窗口/输出上限按实际生效模型（resolve 三层结果）算，不再只看 project.llm。
    effective_llm: llmConfig,
  });
  const { systemContent, latestUserContent, max_tokens } = ctx;
  const systemMessage: Message = { role: "system", content: systemContent };
  const userMessage: Message = { role: "user", content: latestUserContent };

  const tools = tools_override ?? (get_tools_for_mode("simple") as unknown as ToolDefinition[]);

  const existingDrafts = await draft_repo.list_by_chapter(au_id, chapter_num);
  const label = nextDraftLabel(existingDrafts.map((d) => d.variant));

  const suppressTokens = !looksLikeWritingIntent(user_input);

  return {
    provider,
    llmConfig,
    modelName,
    llmParams,
    tools,
    label,
    suppressTokens,
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
  const { llmConfig, modelName, llmParams, tools, suppressTokens } = session;

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
      const partial = extractPartialJsonStringField(buf.args, "content");
      if (partial === null || partial.length <= st.chatReplyEmittedLen) return undefined;
      const delta = partial.slice(st.chatReplyEmittedLen);
      st.chatReplyEmittedLen = partial.length;
      st.chatReplyStreamingActive = true;
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
        for (const c of readOnlyCalls) {
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
        }
        const restCalls = calls.filter((c) => !isReadOnlyTool(c.function.name));
        for (const c of restCalls) {
          if (c.function.name === SIMPLE_TOOL_CHAT_REPLY && st.chatReplyStreamingActive) continue;
          // M15：chat_reply 以外的 mutating 调用同样过 repair —— 修复后的 args 才是
          // UI confirm 卡片该展示/执行的（旧代码原样透传 LLM 未修复 args，路径污染
          // 无从纠正）。chat_reply 本身不 emit tool_call（它是 terminal 文本气泡），
          // 无需 repair。
          if (c.function.name !== SIMPLE_TOOL_CHAT_REPLY) {
            const repaired = repairToolArgs(c.function.name, c.function.arguments);
            emitRepairTelemetry(telemetry, c.function.name, repaired);
            if (repaired.success) {
              events.push({
                type: "tool_call",
                data: { ...c, function: { ...c.function, arguments: JSON.stringify(repaired.args) } },
              });
              continue;
            }
          }
          events.push({ type: "tool_call", data: c });
        }
        events.push({ type: "business", data: { kind: "done_tools", data: { tool_calls: calls } } });
        return { mode: "terminal", events };
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
          // H4：token 计数配置用实际生效 LLM（count_tokens 现只看 mode，行为等价；保持同源）。
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
    telemetry,
  };
}

// ---------------------------------------------------------------------------
// 事件翻译 —— runAgentLoop 通用事件 → 对外 SimpleChatEvent
// ---------------------------------------------------------------------------

/**
 * runAgentLoop 通用事件 → 对外 SimpleChatEvent 的翻译。terminal=true 时主 generator 应
 * yield 完 event（如有）后立即 return —— 对应原大 switch 里的 3 条 error+return 分支
 * （max_iter / empty_response / declared_tools_but_empty）。event=null 表示该事件不透传
 * （如 iter_start）。纯函数（仅依赖 language + 模块常量 SIMPLE_AGENT_MAX_ITER），事件序
 * 等价性可逐条单测。
 */
export function translateLoopEvent(
  ev: AgentLoopEvent<SimpleBusinessEvent>,
  language: "zh" | "en",
): { event: SimpleChatEvent | null; terminal: boolean } {
  switch (ev.type) {
    case "iter_start":
      return { event: null, terminal: false };
    case "max_iter_reached":
      return {
        event: {
          type: "error",
          data: {
            error_code: "AGENT_MAX_ITERATIONS",
            message:
              language === "en"
                ? `Agent loop exceeded ${SIMPLE_AGENT_MAX_ITER} iterations without reaching a terminal action. Please simplify the request or split into multiple steps.`
                : `Agent 超 ${SIMPLE_AGENT_MAX_ITER} 轮未到终态，请简化请求或拆分多步。`,
            actions: [],
            partial_draft_label: null,
          },
        },
        terminal: true,
      };
    case "empty_response_terminal":
      return {
        event: {
          type: "error",
          data: {
            error_code: "EMPTY_RESPONSE",
            message: language === "en" ? "Model returned empty response. Please retry." : "模型返回空响应，请重试。",
            actions: [],
            partial_draft_label: null,
          },
        },
        terminal: true,
      };
    case "declared_tools_but_empty_terminal":
      return {
        event: {
          type: "error",
          data: {
            error_code: "DECLARED_TOOLS_BUT_EMPTY",
            message:
              language === "en"
                ? "Model declared tool_calls but produced no tool call. Please retry."
                : "模型声明要调用工具但没产出有效 tool call，请重试。",
            actions: [],
            partial_draft_label: null,
          },
        },
        terminal: true,
      };
    case "token":
      return { event: { type: "token", data: ev.data }, terminal: false };
    case "tool_call":
      return { event: { type: "tool_call", data: ev.data }, terminal: false };
    case "tool_result":
      return { event: { type: "tool_result", data: ev.data }, terminal: false };
    case "business": {
      const data = ev.data;
      if (data.kind === "chat_reply_chunk")
        return { event: { type: "chat_reply_chunk", data: data.data }, terminal: false };
      if (data.kind === "done_text") return { event: { type: "done_text", data: data.data }, terminal: false };
      if (data.kind === "done_tools") return { event: { type: "done_tools", data: data.data }, terminal: false };
      return { event: null, terminal: false };
    }
  }
}

/**
 * catch 段的 error → SimpleChatEvent 翻译（LLMError 保留结构化 code/actions；其它归
 * DISPATCH_FAILURE）。abort 由 caller 先行 rethrow，不进此函数。
 * partial_draft_label 已由 caller 依 rescueSucceeded 决定（rescue 真落盘才给 label，否则
 * UI「部分草稿已保存为 X」是空指针 —— L9）。
 */
export function toDispatchErrorEvent(e: unknown, partial_draft_label: string | null): SimpleChatEvent {
  if (e instanceof LLMError) {
    return {
      type: "error",
      data: {
        error_code: e.error_code,
        message: e.message,
        actions: e.actions,
        partial_draft_label,
      },
    };
  }
  return {
    type: "error",
    data: {
      error_code: "DISPATCH_FAILURE",
      message: e instanceof Error ? e.message : String(e),
      actions: [],
      partial_draft_label,
    },
  };
}

// ---------------------------------------------------------------------------
// 主流程 —─ 前置解析 → 构造 state/回调 → for await 循环委托翻译 → 收尾
// ---------------------------------------------------------------------------

export async function* dispatch_simple_chat(params: SimpleChatDispatchParams): AsyncGenerator<SimpleChatEvent> {
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
