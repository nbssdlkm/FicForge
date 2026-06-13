// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useSimpleDispatch — 包装 dispatchSimpleChat 的 hook 测试。
 * Mock engine-client.dispatchSimpleChat 给两类 finish_reason，验证回调路由。
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/engine-client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/engine-client")>(
    "../../../api/engine-client",
  );
  return {
    ...actual,
    dispatchSimpleChat: vi.fn(),
  };
});

import * as engineClient from "../../../api/engine-client";
import { useSimpleDispatch } from "../useSimpleDispatch";
import type { SimpleChatEvent } from "../../../api/engine-client";

const mocked = vi.mocked(engineClient.dispatchSimpleChat);

function makeStream(events: SimpleChatEvent[]) {
  return vi.fn(async function* (
    _params: unknown,
    _options?: { signal?: AbortSignal },
  ): AsyncGenerator<SimpleChatEvent> {
    for (const e of events) yield e;
  });
}

function makePending(calls: { signal?: AbortSignal }[]) {
  return vi.fn((_params: unknown, options?: { signal?: AbortSignal }) =>
    (async function* () {
      calls.push({ signal: options?.signal });
      await new Promise<never>((_resolve, reject) => {
        if (!options?.signal) return;
        const onAbort = () => {
          options.signal?.removeEventListener("abort", onAbort);
          reject(new DOMException("Aborted", "AbortError"));
        };
        options.signal.addEventListener("abort", onAbort, { once: true });
      });
      yield { type: "done_tools", data: { tool_calls: [] } } as SimpleChatEvent;
    })(),
  );
}

describe("useSimpleDispatch", () => {
  beforeEach(() => {
    mocked.mockReset();
  });

  it("agent loop tool_result event → onToolResult callback 调用，errorMessage 透传（agent MVP T5）", async () => {
    mocked.mockImplementation(makeStream([
      {
        type: "tool_call",
        data: {
          id: "tc_show",
          type: "function",
          function: { name: "show_chapter", arguments: '{"chapter_num":1}' },
        },
      },
      {
        type: "tool_result",
        data: {
          tool_call_id: "tc_show",
          tool_name: "show_chapter",
          content: "第一章正文...",
        },
      },
      {
        type: "tool_result",
        data: {
          tool_call_id: "tc_setting",
          tool_name: "show_setting",
          content: "FILE_NOT_FOUND",
          error_message: "characters/Alice.md 不存在",
        },
      },
      { type: "done_tools", data: { tool_calls: [] } },
    ]) as unknown as typeof engineClient.dispatchSimpleChat);

    const { result } = renderHook(() => useSimpleDispatch("au_t"));
    const toolResults: Array<{ toolCallId: string; toolName: string; content: string; errorMessage?: string }> = [];

    await act(async () => {
      await result.current.startDispatch(
        { au_path: "au_t", chapter_num: 1, user_input: "看第 1 章 + Alice 设定" },
        {
          onToken: () => {},
          onToolCall: () => {},
          onToolResult: (data) => toolResults.push(data),
          onDoneText: () => {},
          onDoneTools: () => {},
          onError: () => {},
        },
      );
    });

    expect(toolResults).toHaveLength(2);
    expect(toolResults[0]).toEqual({
      toolCallId: "tc_show",
      toolName: "show_chapter",
      content: "第一章正文...",
    });
    // errorMessage 仅在 engine emit 时存在；缺省时不写字段（向后兼容旧 caller）
    expect("errorMessage" in toolResults[0]).toBe(false);
    expect(toolResults[1]).toEqual({
      toolCallId: "tc_setting",
      toolName: "show_setting",
      content: "FILE_NOT_FOUND",
      errorMessage: "characters/Alice.md 不存在",
    });
  });

  it("旧 caller 不传 onToolResult 时遇 tool_result event 不崩（向后兼容）", async () => {
    mocked.mockImplementation(makeStream([
      {
        type: "tool_result",
        data: {
          tool_call_id: "tc_x",
          tool_name: "show_chapter",
          content: "...",
        },
      },
      { type: "done_tools", data: { tool_calls: [] } },
    ]) as unknown as typeof engineClient.dispatchSimpleChat);

    const { result } = renderHook(() => useSimpleDispatch("au_t"));
    let errored = false;

    await act(async () => {
      await result.current.startDispatch(
        { au_path: "au_t", chapter_num: 1, user_input: "x" },
        {
          onToken: () => {},
          onToolCall: () => {},
          // 不传 onToolResult
          onDoneText: () => {},
          onDoneTools: () => {},
          onError: () => { errored = true; },
        },
      );
    });

    expect(errored).toBe(false);
  });

  it("text 路径：onToken 多次 + onDoneText 一次", async () => {
    mocked.mockImplementation(makeStream([
      { type: "token", data: "Hello" },
      { type: "token", data: " world" },
      {
        type: "done_text",
        data: {
          full_text: "Hello world",
          draft_label: "A",
          chapter_num: 1,
          generated_with: { model: "x" },
        },
      },
    ]) as unknown as typeof engineClient.dispatchSimpleChat);

    const { result } = renderHook(() => useSimpleDispatch("au_t"));
    const tokens: string[] = [];
    let doneText: { full_text?: string; draft_label?: string } | null = null;
    let toolCalls = 0;
    let doneTools = 0;

    await act(async () => {
      await result.current.startDispatch(
        { au_path: "au_t", chapter_num: 1, user_input: "写" },
        {
          onToken: (c) => tokens.push(c),
          onToolCall: () => { toolCalls++; },
          onDoneText: (d) => { doneText = d; },
          onDoneTools: () => { doneTools++; },
          onError: () => {},
        },
      );
    });

    expect(tokens).toEqual(["Hello", " world"]);
    expect(doneText?.full_text).toBe("Hello world");
    expect(toolCalls).toBe(0);
    expect(doneTools).toBe(0);
    await waitFor(() => expect(result.current.isStreaming).toBe(false));
  });

  it("tool 路径：onToolCall 按顺序 + onDoneTools 一次", async () => {
    mocked.mockImplementation(makeStream([
      {
        type: "tool_call",
        data: {
          id: "call_1",
          type: "function",
          function: { name: "show_chapter", arguments: '{"chapter_num":3}' },
        },
      },
      {
        type: "tool_call",
        data: {
          id: "call_2",
          type: "function",
          function: { name: "show_setting", arguments: '{"file_path":"characters/Alice.md"}' },
        },
      },
      {
        type: "done_tools",
        data: {
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "show_chapter", arguments: '{"chapter_num":3}' } },
            { id: "call_2", type: "function", function: { name: "show_setting", arguments: '{"file_path":"characters/Alice.md"}' } },
          ],
        },
      },
    ]) as unknown as typeof engineClient.dispatchSimpleChat);

    const { result } = renderHook(() => useSimpleDispatch("au_t"));
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    let doneText = false;
    let doneTools = 0;

    await act(async () => {
      await result.current.startDispatch(
        { au_path: "au_t", chapter_num: 1, user_input: "看第 3 章" },
        {
          onToken: () => {},
          onToolCall: (name, args) => calls.push({ name, args }),
          onDoneText: () => { doneText = true; },
          onDoneTools: () => { doneTools++; },
          onError: () => {},
        },
      );
    });

    expect(calls).toEqual([
      { name: "show_chapter", args: { chapter_num: 3 } },
      { name: "show_setting", args: { file_path: "characters/Alice.md" } },
    ]);
    expect(doneText).toBe(false);
    expect(doneTools).toBe(1);
  });

  it("非法 args JSON 走 safeParseArgs 兜底为 {}，不抛", async () => {
    mocked.mockImplementation(makeStream([
      {
        type: "tool_call",
        data: {
          id: "x", type: "function",
          function: { name: "show_chapter", arguments: "this is not json" },
        },
      },
      { type: "done_tools", data: { tool_calls: [] } },
    ]) as unknown as typeof engineClient.dispatchSimpleChat);

    const { result } = renderHook(() => useSimpleDispatch("au_t"));
    let receivedArgs: Record<string, unknown> | null = null;
    await act(async () => {
      await result.current.startDispatch(
        { au_path: "au_t", chapter_num: 1, user_input: "x" },
        {
          onToken: () => {},
          onToolCall: (_n, a) => { receivedArgs = a; },
          onDoneText: () => {},
          onDoneTools: () => {},
          onError: () => {},
        },
      );
    });
    expect(receivedArgs).toEqual({});
  });

  it("error event 走 onError", async () => {
    mocked.mockImplementation(makeStream([
      {
        type: "error",
        data: { error_code: "UNSUPPORTED_MODE", message: "local 未实现", actions: [], partial_draft_label: null },
      },
    ]) as unknown as typeof engineClient.dispatchSimpleChat);

    const { result } = renderHook(() => useSimpleDispatch("au_t"));
    let err: { error_code?: string; message?: string } | null = null;
    await act(async () => {
      await result.current.startDispatch(
        { au_path: "au_t", chapter_num: 1, user_input: "x" },
        {
          onToken: () => {}, onToolCall: () => {}, onDoneText: () => {}, onDoneTools: () => {},
          onError: (d) => { err = d; },
        },
      );
    });
    expect(err?.error_code).toBe("UNSUPPORTED_MODE");
  });

  it("cancelDispatch 触发 onCancelled，不触发 onError", async () => {
    const calls: { signal?: AbortSignal }[] = [];
    mocked.mockImplementation(makePending(calls) as unknown as typeof engineClient.dispatchSimpleChat);

    const { result } = renderHook(() => useSimpleDispatch("au_t"));
    let cancelled = false;
    let errored = false;

    act(() => {
      void result.current.startDispatch(
        { au_path: "au_t", chapter_num: 1, user_input: "x" },
        {
          onToken: () => {}, onToolCall: () => {}, onDoneText: () => {}, onDoneTools: () => {},
          onError: () => { errored = true; },
          onCancelled: () => { cancelled = true; },
        },
      );
    });

    await waitFor(() => expect(calls.length).toBe(1));
    act(() => { result.current.cancelDispatch(); });
    await waitFor(() => expect(cancelled).toBe(true));
    expect(errored).toBe(false);
    expect(result.current.isStreaming).toBe(false);
  });

  it("AU 切换 cleanup 自动 abort 在跑流", async () => {
    const calls: { signal?: AbortSignal }[] = [];
    mocked.mockImplementation(makePending(calls) as unknown as typeof engineClient.dispatchSimpleChat);

    const { result, rerender } = renderHook(({ au }) => useSimpleDispatch(au), {
      initialProps: { au: "au_a" },
    });

    act(() => {
      void result.current.startDispatch(
        { au_path: "au_a", chapter_num: 1, user_input: "x" },
        { onToken: () => {}, onToolCall: () => {}, onDoneText: () => {}, onDoneTools: () => {}, onError: () => {} },
      );
    });
    await waitFor(() => expect(calls.length).toBe(1));
    const firstSignal = calls[0].signal!;

    rerender({ au: "au_b" });
    await waitFor(() => expect(firstSignal.aborted).toBe(true));
  });
});
