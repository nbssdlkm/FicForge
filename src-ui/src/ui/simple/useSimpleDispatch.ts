// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge Lite — useSimpleDispatch
 *
 * 替代旧 useSimpleStreaming：包装 dispatchSimpleChat（流式 + tools），
 * 一次 LLM 调用同时处理写章节 / show / modify_*。
 *
 * 调用方按事件类型分发到 chat message 或副作用。AU 切换 / 用户主动 cancel 即 abort
 * 在跑请求（参考 T7-3 端到端 AbortSignal 4 层贯通方案的最外层）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { dispatchSimpleChat, type DispatchSimpleChatParams } from "../../api/engine-client";

export interface SimpleDispatchCallbacks {
  /** 流式 text chunk（write 路径）。 */
  onToken: (chunk: string) => void;
  /** 单个完整 tool call（tool 路径，每次 done_tools 前 emit 一次/个）。 */
  onToolCall: (toolName: string, toolArgs: Record<string, unknown>, toolCallId: string) => void;
  /**
   * chat_reply 流式增量内容（dispatch 边累积 chat_reply tool args 边 partial-parse
   * content 字段 emit 给 UI 实时渲染对话气泡）。第一个 chunk 触发 UI append empty
   * assistant message + 设 streamingId；后续 chunks append 到该消息。dispatch 流式
   * 期间不再 emit chat_reply 的 tool_call 事件，避免 UI 重复 append（OpenAI tool call
   * args 累积完整后才到 done_tools，如不流式 UX 会"卡顿"——用户实测希望流式）。
   */
  onChatReplyChunk?: (delta: string) => void;
  /**
   * agent loop 自动 fetch read-only tool 的结果（show_chapter / show_setting）。
   * UI 持久化为 SimpleToolResultMessage 进 chat.yaml，让 reload 后 LLM 能从 history
   * 还原完整 reasoning 链路。dispatch 已注入 internalHistory 喂下一轮 LLM，UI 不
   * 需要做任何回灌，仅作持久化用途。
   */
  onToolResult?: (data: { toolCallId: string; toolName: string; content: string; errorMessage?: string }) => void;
  /** write 路径完成：full_text + draft_label + generated_with 已写到 draft 文件。 */
  onDoneText: (data: {
    full_text: string;
    draft_label: string;
    chapter_num: number;
    generated_with: Record<string, unknown> | unknown;
  }) => void;
  /** tool 路径完成：所有 tool calls 已通过 onToolCall 发完。 */
  onDoneTools: () => void;
  /** 失败：error_code + message + 可选 partial_draft_label（部分文本已存盘）。 */
  onError: (data: {
    error_code?: string;
    message?: string;
    actions?: string[];
    partial_draft_label?: string | null;
  }) => void;
  /** 用户主动 cancel 或 AU 切换被中断时触发；不展示 error toast。 */
  onCancelled?: () => void;
}

export interface UseSimpleDispatchResult {
  isStreaming: boolean;
  startDispatch: (params: DispatchSimpleChatParams, callbacks: SimpleDispatchCallbacks) => Promise<void>;
  cancelDispatch: () => void;
}

function safeParseArgs(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

export function useSimpleDispatch(auPath: string): UseSimpleDispatchResult {
  const [isStreaming, setIsStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const cancelCallbackRef = useRef<(() => void) | null>(null);

  // AU 切换 cleanup（铁律 2：state + reset 同文件）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 边沿触发——cleanup 仅随 auPath 变化跑（abort 在跑请求 + 复位 isStreaming）；auPath 只作触发键、体内不读取；删除会使切 AU 不再中断在飞 dispatch
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      cancelCallbackRef.current?.();
      cancelCallbackRef.current = null;
      // L20：auPath 原地变更（当前被 App 的 key remount 掩盖，但契约上 hook 应自洽）
      // 时复位 isStreaming —— 否则 abort 后 dispatch 的 finally 只在「非 abort」分支复位，
      // 切 AU 会让新宿主继承 isStreaming=true 卡住输入框。unmount cleanup 里 setState
      // React 会静默忽略（组件已卸载），原地变更时才真正生效，两种情形都安全。
      setIsStreaming(false);
    };
  }, [auPath]);

  const cancelDispatch = useCallback(() => {
    // F8：立即 abort + 复位 isStreaming 保证输入框秒回可用（用户体验优先）。engine 侧的
    // chapter_inflight 锁在被 abort 的 async generator 被 `for await` 循环 break 后经其
    // finally（simple_chat_dispatch.ts）异步释放，`cancelDispatch` 拿不到该迭代器句柄、
    // 也不宜同步 await（会卡住 UI，且 generator 可能不立即终止）。故不在此等待锁释放；
    // 「刚点停立刻重发」撞上尚未释放的 DISPATCH_IN_PROGRESS/GENERATION_IN_PROGRESS 409 时，
    // 由 getFriendlyErrorMessage 的 busy_in_progress 文案兜底（提示稍候一两秒再发），
    // 而非把裸机器码抛给用户。
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    cancelCallbackRef.current?.();
    cancelCallbackRef.current = null;
    setIsStreaming(false);
  }, []);

  const startDispatch = useCallback(async (params: DispatchSimpleChatParams, callbacks: SimpleDispatchCallbacks) => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
      cancelCallbackRef.current?.();
      cancelCallbackRef.current = null;
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    cancelCallbackRef.current = callbacks.onCancelled ?? null;
    setIsStreaming(true);

    try {
      for await (const ev of dispatchSimpleChat(params, { signal: ctrl.signal })) {
        if (ctrl.signal.aborted) break;
        switch (ev.type) {
          case "token":
            callbacks.onToken(ev.data);
            break;
          case "tool_call":
            callbacks.onToolCall(ev.data.function.name, safeParseArgs(ev.data.function.arguments), ev.data.id);
            break;
          case "chat_reply_chunk":
            callbacks.onChatReplyChunk?.(ev.data);
            break;
          case "tool_result":
            callbacks.onToolResult?.({
              toolCallId: ev.data.tool_call_id,
              toolName: ev.data.tool_name,
              content: ev.data.content,
              ...(ev.data.error_message !== undefined ? { errorMessage: ev.data.error_message } : {}),
            });
            break;
          case "done_text":
            callbacks.onDoneText(ev.data);
            break;
          case "done_tools":
            callbacks.onDoneTools();
            break;
          case "error":
            callbacks.onError(ev.data);
            break;
        }
      }
    } catch (err) {
      if (ctrl.signal.aborted) return;
      callbacks.onError({
        error_code: "DISPATCH_FAILURE",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        cancelCallbackRef.current = null;
      }
      if (!ctrl.signal.aborted) {
        setIsStreaming(false);
      }
    }
  }, []);

  return { isStreaming, startDispatch, cancelDispatch };
}
