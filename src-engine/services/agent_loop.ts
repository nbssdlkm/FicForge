// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Agent loop 通用 harness — FicForge agent harness Layer 3。把 simple_chat_dispatch
 * 的 iter loop / 流式 / 错误防御抽通用，业务通过 callback 注入 specific 行为。
 * 任何 agent (facts 提取 / chapter summary / ReAct) 复用此模块。
 */

import { createAbortError, isAbortError } from "../utils/abort_error.js";
import type { Message, ToolCall, ToolDefinition, ToolChoice, LLMProvider, GenerateParams } from "../llm/provider.js";
import { LLMError } from "../llm/provider.js";
import type { ZodType } from "zod";
import type { ToolBuffer } from "./tool_stream_buffer.js";
import { applyToolDelta, finalizeToolCalls } from "./tool_stream_buffer.js";
import type { TelemetrySink } from "./agent_telemetry.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Telemetry sink — Layer 5 (commit e034e44) 已落地，可直接 import。

/**
 * Agent loop 通用事件。E 是 business-specific 透传事件类型（simple agent 用来
 * 透传 chat_reply_chunk / done_text / done_tools 等 simple 特有事件）。
 */
export type AgentLoopEvent<E> =
  | { type: "token"; data: string }
  | { type: "tool_call"; data: ToolCall }
  | { type: "tool_result"; data: { tool_call_id: string; tool_name: string; content: string; error_message?: string } }
  | { type: "iter_start"; data: { iter: number } }
  | { type: "max_iter_reached"; data: { iterCount: number } }
  | { type: "empty_response_terminal" }
  | { type: "declared_tools_but_empty_terminal" }
  | { type: "business"; data: E };

/**
 * iter 完成时（finishReason / toolBuffers 都已收齐后）的上下文。
 * 业务侧 callback 用它读取本 iter 的全部状态做决策。
 */
export interface IterContext {
  iter: number;
  finishReason: string | null;
  fullText: string;
  reasoningContent: string;
  toolCalls: ToolCall[];
  hasFullText: boolean;
  hasTools: boolean;
  forceToolOnly: boolean;
  internalHistory: Message[];
  /** 本 iter LLM API 返回的 input_tokens（首个非 null chunk 的值，0 表示 provider 未返回）。 */
  inputTokens: number;
  /** 本 iter LLM API 返回的 output_tokens（最后一个非 null chunk 的值，null 表示 provider 未返回）。 */
  outputTokens: number | null;
}

/**
 * AgentLoopConfig —— 业务侧通过实现这些 callback 注入 simple-specific 行为。
 */
export interface AgentLoopConfig<E> {
  agentName: string;
  maxIter: number;
  tools: ToolDefinition[];
  /** 静态 tool_choice，或 per-iter 函数（如 ReAct 首轮强制 propose_facts、之后放回 auto）。 */
  toolChoice: ToolChoice | ((iter: number) => ToolChoice);
  zodSchemas: Record<string, ZodType>;
  pathFields: Record<string, (string | number)[][]>;

  isReadOnlyTool: (name: string) => boolean;
  isMutatingTool: (name: string) => boolean;
  isTerminalTool?: (name: string) => boolean;

  executeReadTool: (
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{ content: string; errorMessage?: string }>;

  onIterStart?: (iter: number, history: Message[]) => void | Promise<void>;

  /**
   * 每个 token delta 回调。返 `false` 时 harness 不 yield 该 token（业务侧自行缓冲
   * 并在合适时机 flush）；返 `true` / `void` / `undefined` 时正常 yield。
   */
  onTokenChunk?: (delta: string, ctx: { iter: number }) => boolean | void;

  onToolCallDelta?: (buffer: ToolBuffer, ctx: { iter: number }) => AgentLoopEvent<E>[] | undefined;

  onTextPathTerminal: (ctx: IterContext) => Promise<AgentLoopEvent<E>[]>;

  /**
   * forceToolOnly 路径回调。返 `{ mode: "terminal", events }` 时 harness yield events
   * 并 return；返 `{ mode: "continue", events? }` 时先 yield events（如有）再 continue
   * 下一 iter。注意 `events` 为空且 mode=continue 时仅 continue 不 yield 任何事件。
   */
  onForceToolPath: (
    calls: ToolCall[],
    ctx: IterContext,
  ) => Promise<{ mode: "terminal"; events: AgentLoopEvent<E>[] } | { mode: "continue"; events?: AgentLoopEvent<E>[] }>;

  /**
   * guard retry 回调。kind=deviation 用于 hasFullText && !hasTools（chat_reply 偏离
   * guard），kind=empty_response 用于 !hasFullText && !hasTools（空响应 guard）。
   * 返 null → 不 retry，走对应 terminal 路径；返 Message → push history + continue。
   */
  onGuardRetry?: (
    kind: "deviation" | "empty_response",
    ctx: { count: number; max: number; iter: number; fullText: string },
  ) => Message | null;

  onPartialRescue?: (fullText: string) => Promise<{ rescued: boolean; label?: string }>;

  telemetry?: TelemetrySink;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw createAbortError();
  }
}

/** tool_choice 是否为「强制某个函数」形态（`{type:"function",...}`）。 */
function isForcedChoice(c: ToolChoice): boolean {
  return typeof c === "object" && c !== null && c.type === "function";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export async function* runAgentLoop<E>(
  config: AgentLoopConfig<E>,
  provider: LLMProvider,
  startMessages: Message[],
  generateParams: Omit<GenerateParams, "messages" | "tools" | "tool_choice">,
  signal?: AbortSignal,
): AsyncGenerator<AgentLoopEvent<E>> {
  const maxGuardRetries = 2;
  const internalHistory: Message[] = [];
  let fullText = "";
  let reasoningContent = "";
  let emptyGuardCount = 0;
  let deviationGuardCount = 0;
  // 一旦某模型拒绝强制 tool_choice，本 run 后续不再强制（sticky）。
  let forcedChoiceDisabled = false;

  try {
    for (let iter = 0; iter < config.maxIter; iter++) {
      // --- abort check ---
      checkAbort(signal);

      // --- iter start ---
      yield { type: "iter_start", data: { iter } };
      await config.onIterStart?.(iter, internalHistory);

      // --- stream（含 forced tool_choice 降级重试）---
      const messages: Message[] = [...startMessages, ...internalHistory];
      const toolBuffers = new Map<number, ToolBuffer>();
      let finishReason: string | null = null;
      let inputTokens = 0;
      let outputTokens: number | null = null;

      // 每轮 tool_choice：支持 per-iter 函数（如 ReAct 首轮强制 propose_facts、之后放回 auto）。
      const requestedChoice: ToolChoice =
        typeof config.toolChoice === "function" ? config.toolChoice(iter) : config.toolChoice;

      // 部分模型（deepseek-reasoner 等）拒绝非 auto 的 tool_choice，抛 forced_tool_choice_unsupported。
      // 此时同轮改 auto 重试 + sticky —— 补上 openai_compatible.ts 注释里承诺却从没写的消费者（审计 HIGH）。
      // 该错误在首包前抛出（0 chunk yield），故重试不会重复 yield token/tool-delta。
      streamRetry: while (true) {
        toolBuffers.clear();
        fullText = "";
        reasoningContent = "";
        finishReason = null;
        inputTokens = 0;
        outputTokens = null;
        const effectiveChoice: ToolChoice =
          forcedChoiceDisabled && isForcedChoice(requestedChoice) ? "auto" : requestedChoice;
        // 显式化「本 pass 是否已向 caller yield / 已收到实质内容」不变量：只有一个 chunk 都没吐过
        // 才允许 forced 降级重试。当前 provider 的该错误是首包前的 HTTP 400（对抗审确认零 yield），
        // 但把隐式契约做成显式 guard，未来若有网关 200-then-error-mid-stream 也不会重复 yield。
        let sawContentThisPass = false;
        try {
          for await (const chunk of provider.generateStream({
            messages,
            max_tokens: generateParams.max_tokens,
            temperature: generateParams.temperature,
            top_p: generateParams.top_p,
            tools: config.tools,
            tool_choice: effectiveChoice,
            signal,
          })) {
            checkAbort(signal);

            if (chunk.delta) {
              sawContentThisPass = true;
              fullText += chunk.delta;
              const shouldYield = config.onTokenChunk?.(chunk.delta, { iter });
              if (shouldYield !== false) {
                yield { type: "token", data: chunk.delta };
              }
            }

            if (chunk.reasoning_delta) {
              reasoningContent += chunk.reasoning_delta;
            }

            if (chunk.tool_call_deltas) {
              sawContentThisPass = true;
              for (const d of chunk.tool_call_deltas) applyToolDelta(toolBuffers, d);
              if (config.onToolCallDelta) {
                for (const buf of toolBuffers.values()) {
                  const events = config.onToolCallDelta(buf, { iter });
                  if (events) {
                    for (const ev of events) yield ev;
                  }
                }
              }
            }

            if (chunk.finish_reason !== null) finishReason = chunk.finish_reason;
            if (chunk.input_tokens !== null) inputTokens = chunk.input_tokens;
            if (chunk.output_tokens !== null) outputTokens = chunk.output_tokens;
          }
          break streamRetry; // 流正常完成
        } catch (e) {
          if (
            e instanceof LLMError &&
            e.error_code === "forced_tool_choice_unsupported" &&
            isForcedChoice(effectiveChoice) &&
            !forcedChoiceDisabled &&
            !sawContentThisPass
          ) {
            forcedChoiceDisabled = true;
            config.telemetry?.emit({ kind: "forced_tool_choice_fallback", agentName: config.agentName, model: "" });
            continue streamRetry; // 同轮改 auto 重试
          }
          throw e;
        }
      }

      // --- post-stream guard ---
      const hasFullText = fullText.length > 0;
      const hasTools = toolBuffers.size > 0;
      const forceToolOnly = finishReason === "tool_calls";

      // DECLARED_TOOLS_BUT_EMPTY guard — no retry, immediate terminal
      if (forceToolOnly && !hasTools) {
        yield { type: "declared_tools_but_empty_terminal" };
        return;
      }

      // EMPTY_RESPONSE guard
      if (!hasFullText && !hasTools) {
        if (config.onGuardRetry && emptyGuardCount < maxGuardRetries) {
          const hint = config.onGuardRetry("empty_response", {
            count: emptyGuardCount,
            max: maxGuardRetries,
            iter,
            fullText,
          });
          if (hint) {
            internalHistory.push(hint);
            emptyGuardCount++;
            continue;
          }
        }
        yield { type: "empty_response_terminal" };
        return;
      }

      // Deviation guard（hasFullText && !hasTools）：业务侧可注入 hint 让 LLM 改用
      // tool 路径（如 chat_reply），避免非续写意图时走 text path 产生误导草稿。
      if (hasFullText && !hasTools && config.onGuardRetry && deviationGuardCount < maxGuardRetries) {
        const hint = config.onGuardRetry("deviation", {
          count: deviationGuardCount,
          max: maxGuardRetries,
          iter,
          fullText,
        });
        if (hint) {
          // L10：被丢弃的偏离回复先以 assistant 消息入 history，模型能看到自己上一条说了什么，
          // 否则紧随的 hint（如"改用工具重说"）指涉的是模型看不见的内容。reasoning_content 一并
          // 带回（DeepSeek reasoner 多轮要求回传，否则 400）。
          const deviationMsg: Message = { role: "assistant", content: fullText };
          if (reasoningContent) deviationMsg.reasoning_content = reasoningContent;
          internalHistory.push(deviationMsg);
          internalHistory.push(hint);
          deviationGuardCount++;
          continue;
        }
      }
      // --- build iter context ---
      const toolCalls = finalizeToolCalls(toolBuffers);
      const ctx: IterContext = {
        iter,
        finishReason,
        fullText,
        reasoningContent,
        toolCalls,
        hasFullText,
        hasTools,
        forceToolOnly,
        internalHistory,
        inputTokens,
        outputTokens,
      };

      // --- route ---
      if (forceToolOnly) {
        if (hasFullText) {
          config.telemetry?.emit({
            kind: "force_tool_only_with_text",
            agentName: config.agentName,
            fullTextLen: fullText.length,
          });
        }
        const result = await config.onForceToolPath(toolCalls, ctx);
        // yield optional events first (valid for both "continue" and "terminal" modes)
        if (result.events) {
          for (const ev of result.events) yield ev;
        }
        if (result.mode === "continue") {
          continue;
        }
        // mode === "terminal"
        return;
      }

      // text path — terminal
      const events = await config.onTextPathTerminal(ctx);
      for (const ev of events) yield ev;
      return;
    }

    // max iter reached
    config.telemetry?.emit({
      kind: "agent_iter_max_reached",
      agentName: config.agentName,
      iterCount: config.maxIter,
    });
    yield { type: "max_iter_reached", data: { iterCount: config.maxIter } };
  } catch (e) {
    // AbortError 不进 partial rescue，直接抛给 caller
    if (isAbortError(e)) throw e;

    // partial rescue
    if (config.onPartialRescue && fullText) {
      await config.onPartialRescue(fullText);
    }

    throw e;
  }
}
