// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge Lite — simple_chat 事件类型与翻译层（自 simple_chat_dispatch.ts 拆出，E4a）
 *
 *  - SimpleChatEvent：对外事件契约（UI 消费）；SimpleBusinessEvent：透传给 agent_loop 的业务事件
 *  - translateLoopEvent：runAgentLoop 通用事件 → 对外 SimpleChatEvent（纯函数，terminal 标志驱动收尾）
 *  - toDispatchErrorEvent：catch 段 error → SimpleChatEvent（LLMError 保结构化 code/actions）
 *
 * SimpleChatEvent / translateLoopEvent / toDispatchErrorEvent 经 simple_chat_dispatch 再导出，
 * 保持既有导入路径与 barrel 不变。
 */

import type { GeneratedWith } from "../domain/generated_with.js";
import { LLMError, type ToolCall } from "../llm/provider.js";
import { SIMPLE_AGENT_MAX_ITER } from "../config/simple_features.js";
import type { AgentLoopEvent } from "./agent_loop.js";

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

// ---------------------------------------------------------------------------
// Business event types — simple-specific 事件透传给 agent_loop
// ---------------------------------------------------------------------------

export type SimpleBusinessEvent =
  | { kind: "chat_reply_chunk"; data: string }
  | {
      kind: "done_text";
      data: { full_text: string; draft_label: string; chapter_num: number; generated_with: GeneratedWith };
    }
  | { kind: "done_tools"; data: { tool_calls: ToolCall[] } };

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
