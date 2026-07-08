// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * agent_loop 通用 harness  golden test 验证 harness 行为契约。
 * Mock LLMProvider + Mock callbacks，覆盖 8 个关键路径。
 */

import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { LLMProvider, LLMChunk, ToolCallChunkDelta, Message } from "../../llm/provider.js";
import type { ToolBuffer } from "../tool_stream_buffer.js";
import {
  runAgentLoop,
  type AgentLoopEvent,
  type AgentLoopConfig,
  type IterContext,
} from "../agent_loop.js";

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const FAKE_READ_TOOL = "fake_read_tool";
const FAKE_TERMINAL_TOOL = "fake_terminal_tool";
const FAKE_MUTATING_TOOL = "fake_mutating_tool";

type TestBusinessEvent = string;

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

/** 单组 chunks 的简单 provider，每次调 generateStream 返同一组 chunks。 */
function makeProvider(iterChunks: LLMChunk[][]): LLMProvider {
  let callIndex = 0;
  return {
    async generate() {
      return { content: "", model: "mock", input_tokens: 0, output_tokens: 0, finish_reason: "stop" };
    },
    async *generateStream(): AsyncIterable<LLMChunk> {
      const chunks = iterChunks[callIndex] ?? [];
      callIndex++;
      for (const c of chunks) yield c;
    },
  };
}

function td(
  index: number,
  id: string,
  name: string,
  args: string,
): ToolCallChunkDelta {
  return { index, id, type: "function", function: { name, arguments: args } };
}

function chunk(overrides: Partial<LLMChunk> = {}): LLMChunk {
  return {
    delta: "",
    is_final: false,
    input_tokens: null,
    output_tokens: null,
    finish_reason: null,
    ...overrides,
  };
}

async function collect<E>(gen: AsyncGenerator<AgentLoopEvent<E>>): Promise<AgentLoopEvent<E>[]> {
  const events: AgentLoopEvent<E>[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

async function collectOrError<E>(
  gen: AsyncGenerator<AgentLoopEvent<E>>,
): Promise<{ events: AgentLoopEvent<E>[]; error: unknown }> {
  const events: AgentLoopEvent<E>[] = [];
  let error: unknown = null;
  try {
    for await (const ev of gen) events.push(ev);
  } catch (e) {
    error = e;
  }
  return { events, error };
}

// ---------------------------------------------------------------------------
// Config builder
// ---------------------------------------------------------------------------

function buildConfig(
  overrides: Partial<AgentLoopConfig<TestBusinessEvent>> = {},
): AgentLoopConfig<TestBusinessEvent> {
  return {
    agentName: "test_agent",
    maxIter: 5,
    tools: [],
    toolChoice: "auto",
    zodSchemas: {},
    pathFields: {},
    isReadOnlyTool: (n: string) => n === FAKE_READ_TOOL,
    isMutatingTool: (n: string) => n === FAKE_MUTATING_TOOL,
    isTerminalTool: (n: string) => n === FAKE_TERMINAL_TOOL,
    executeReadTool: async () => ({ content: "mock_result" }),
    onTextPathTerminal: async () => [{ type: "business", data: "TEXT_TERMINAL" }],
    onForceToolPath: async () => ({ mode: "terminal" as const, events: [{ type: "business", data: "TOOL_TERMINAL" }] }),
    ...overrides,
  };
}

// ===========================================================================
// Tests
// ===========================================================================

describe("runAgentLoop", () => {
  // -------------------------------------------------------------------------
  // Case 1: read-only continue → next iter terminal tool
  // -------------------------------------------------------------------------
  it("case 1: read-only continue → next iter terminal tool", async () => {
    // iter 0: fake_read_tool → onForceToolPath 返 "continue"
    // iter 1: fake_terminal_tool → onForceToolPath 返 business events
    const provider = makeProvider([
      // iter 0: read-only
      [
        chunk({
          tool_call_deltas: [td(0, "tc_r", FAKE_READ_TOOL, '{"key":"val"}')],
          finish_reason: "tool_calls",
          is_final: true,
        }),
      ],
      // iter 1: terminal
      [
        chunk({
          tool_call_deltas: [td(0, "tc_t", FAKE_TERMINAL_TOOL, "{}")],
          finish_reason: "tool_calls",
          is_final: true,
        }),
      ],
    ]);

    let iterCount = 0;
    // onToolCallDelta: emit tool_call event during streaming (once per tool per iter)
    // emittedIndices 必须 per-iter 重置 —— harness 每 iter reinit toolBuffers Map，新
    // buf 的 index 可能跟上 iter 重复（都是 0）。靠 onIterStart 钩子 clear。
    const emittedIndices = new Set<number>();
    const config = buildConfig({
      onIterStart: () => {
        emittedIndices.clear();
      },
      onToolCallDelta: (buf: ToolBuffer) => {
        if (emittedIndices.has(buf.index)) return undefined;
        emittedIndices.add(buf.index);
        return [{
          type: "tool_call" as const,
          data: {
            id: buf.id || `tc-${buf.index}`,
            type: "function" as const,
            function: { name: buf.name, arguments: buf.args },
          },
        }];
      },
      onForceToolPath: async (_calls, _ctx) => {
        iterCount++;
        if (iterCount === 1) {
          // read-only → continue
          return { mode: "continue" as const };
        }
        // terminal → business events
        return { mode: "terminal" as const, events: [{ type: "business", data: "DONE" }] };
      },
    });

    const events = await collect(runAgentLoop(config, provider, [], { max_tokens: 100, temperature: 0, top_p: 1 }));

    // 期望顺序
    const types = events.map((e) => e.type);
    const i0 = types.indexOf("iter_start");
    const tcRead = types.indexOf("tool_call", i0 + 1);
    const i1 = types.indexOf("iter_start", tcRead + 1);
    const tcTerminal = types.indexOf("tool_call", i1 + 1);
    const biz = types.indexOf("business", tcTerminal + 1);

    expect(i0).toBeGreaterThanOrEqual(0);
    expect(tcRead).toBeGreaterThan(i0);
    expect(i1).toBeGreaterThan(tcRead);
    expect(tcTerminal).toBeGreaterThan(i1);
    expect(biz).toBeGreaterThan(tcTerminal);

    // 验证 business event 数据
    const bizEv = events[biz] as Extract<AgentLoopEvent<TestBusinessEvent>, { type: "business" }>;
    expect(bizEv.data).toBe("DONE");

    // iter_start 应出现两次
    expect(events.filter((e) => e.type === "iter_start")).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Case 2: mutating valid args → onForceToolPath returns PENDING terminal
  // -------------------------------------------------------------------------
  it("case 2: mutating valid args → onForceToolPath returns PENDING terminal", async () => {
    const provider = makeProvider([
      [
        chunk({
          tool_call_deltas: [td(0, "tc_m", FAKE_MUTATING_TOOL, '{"name":"Alice"}')],
          finish_reason: "tool_calls",
          is_final: true,
        }),
      ],
    ]);

    let onForceCalled = false;
    const config = buildConfig({
      onForceToolPath: async (calls, _ctx) => {
        onForceCalled = true;
        expect(calls).toHaveLength(1);
        expect(calls[0].function.name).toBe(FAKE_MUTATING_TOOL);
        return { mode: "terminal" as const, events: [{ type: "business", data: "PENDING" }] };
      },
    });

    const events = await collect(runAgentLoop(config, provider, [], { max_tokens: 100, temperature: 0, top_p: 1 }));

    expect(onForceCalled).toBe(true);

    // 应包含 business "PENDING" 且只有 1 个 iter
    const bizEvents = events.filter((e) => e.type === "business");
    expect(bizEvents).toHaveLength(1);
    const biz = bizEvents[0] as Extract<AgentLoopEvent<TestBusinessEvent>, { type: "business" }>;
    expect(biz.data).toBe("PENDING");

    expect(events.filter((e) => e.type === "iter_start")).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Case 3: mutating invalid args → onForceToolPath returns "continue" → iter 1 fix
  // -------------------------------------------------------------------------
  it("case 3: mutating invalid args → onForceToolPath returns 'continue' → iter 1 fix", async () => {
    const provider = makeProvider([
      // iter 0: bad args
      [
        chunk({
          tool_call_deltas: [td(0, "tc_bad", FAKE_MUTATING_TOOL, "{}")],
          finish_reason: "tool_calls",
          is_final: true,
        }),
      ],
      // iter 1: corrected args
      [
        chunk({
          tool_call_deltas: [td(0, "tc_good", FAKE_MUTATING_TOOL, '{"name":"Bob"}')],
          finish_reason: "tool_calls",
          is_final: true,
        }),
      ],
    ]);

    let iterCount = 0;
    // 同 case 1: emittedIndices 必须 per-iter 重置（每 iter 新 toolBuffers Map）
    const emittedIndices = new Set<number>();
    const config = buildConfig({
      onIterStart: () => {
        emittedIndices.clear();
      },
      onToolCallDelta: (buf: ToolBuffer) => {
        if (emittedIndices.has(buf.index)) return undefined;
        emittedIndices.add(buf.index);
        return [{
          type: "tool_call" as const,
          data: {
            id: buf.id || `tc-${buf.index}`,
            type: "function" as const,
            function: { name: buf.name, arguments: buf.args },
          },
        }];
      },
      onForceToolPath: async (_calls, ctx) => {
        iterCount++;
        if (iterCount === 1) {
          // args invalid → push error tool_result to history, continue
          ctx.internalHistory.push({
            role: "tool",
            tool_call_id: "tc_bad",
            content: "注意：字段 name 缺失，请修正",
          });
          return { mode: "continue" as const };
        }
        // args corrected → terminal
        return { mode: "terminal" as const, events: [{ type: "business", data: "PENDING" }] };
      },
    });

    const events = await collect(runAgentLoop(config, provider, [], { max_tokens: 100, temperature: 0, top_p: 1 }));

    // 应有两次 iter_start
    expect(events.filter((e) => e.type === "iter_start")).toHaveLength(2);

    // 两次 tool_call 事件
    expect(events.filter((e) => e.type === "tool_call")).toHaveLength(2);

    // 终结于 business "PENDING"
    const bizEvents = events.filter((e) => e.type === "business");
    expect(bizEvents).toHaveLength(1);
    const biz = bizEvents[0] as Extract<AgentLoopEvent<TestBusinessEvent>, { type: "business" }>;
    expect(biz.data).toBe("PENDING");
  });

  // -------------------------------------------------------------------------
  // Case 4: single iter terminal tool
  // -------------------------------------------------------------------------
  it("case 4: single iter terminal tool → terminal events return", async () => {
    const provider = makeProvider([
      [
        chunk({
          tool_call_deltas: [td(0, "tc_term", FAKE_TERMINAL_TOOL, "{}")],
          finish_reason: "tool_calls",
          is_final: true,
        }),
      ],
    ]);

    let onForceCalled = false;
    const config = buildConfig({
      onForceToolPath: async (calls, _ctx) => {
        onForceCalled = true;
        expect(calls).toHaveLength(1);
        expect(calls[0].function.name).toBe(FAKE_TERMINAL_TOOL);
        return { mode: "terminal" as const, events: [{ type: "business", data: "TERMINAL" }] };
      },
    });

    const events = await collect(runAgentLoop(config, provider, [], { max_tokens: 100, temperature: 0, top_p: 1 }));

    expect(onForceCalled).toBe(true);
    expect(events.filter((e) => e.type === "iter_start")).toHaveLength(1);

    const bizEvents = events.filter((e) => e.type === "business");
    expect(bizEvents).toHaveLength(1);
    const biz = bizEvents[0] as Extract<AgentLoopEvent<TestBusinessEvent>, { type: "business" }>;
    expect(biz.data).toBe("TERMINAL");
  });

  // -------------------------------------------------------------------------
  // Case 5: EMPTY_RESPONSE guard retry → iter 1 normal
  // -------------------------------------------------------------------------
  it("case 5: EMPTY_RESPONSE guard retry → iter 1 normal", async () => {
    const provider = makeProvider([
      // iter 0: empty (no tokens, no tools)
      [
        chunk({ delta: "", is_final: true, finish_reason: "stop" }),
      ],
      // iter 1: has token → text path
      [
        chunk({ delta: "Hello", is_final: true, finish_reason: "stop" }),
      ],
    ]);

    let guardCalls = 0;
    const config = buildConfig({
      onGuardRetry: (kind, ctx) => {
        guardCalls++;
        if (kind === "empty_response") {
          expect(ctx.count).toBe(0);
          expect(ctx.iter).toBe(0);
          return { role: "user", content: "[system] Please respond." };
        }
        // deviation guard: let text path proceed (no retry)
        return null;
      },
      onTextPathTerminal: async (_ctx) => {
        return [{ type: "business", data: "TEXT_DONE" }];
      },
    });

    const events = await collect(runAgentLoop(config, provider, [], { max_tokens: 100, temperature: 0, top_p: 1 }));

    // onGuardRetry 被调两次：iter 0 empty_response guard + iter 1 deviation guard（后者返 null）
    expect(guardCalls).toBe(2);

    // 应有两次 iter_start（retry 后第二 iter）
    expect(events.filter((e) => e.type === "iter_start")).toHaveLength(2);

    // iter 1 应走 text path → business "TEXT_DONE"
    const bizEvents = events.filter((e) => e.type === "business");
    expect(bizEvents).toHaveLength(1);
    const biz = bizEvents[0] as Extract<AgentLoopEvent<TestBusinessEvent>, { type: "business" }>;
    expect(biz.data).toBe("TEXT_DONE");

    // 不应有 empty_response_terminal
    expect(events.find((e) => e.type === "empty_response_terminal")).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // Case 6: AGENT_MAX_ITERATIONS
  // -------------------------------------------------------------------------
  it("case 6: max_iter reached → emit max_iter_reached", async () => {
    const chunks = [
      chunk({
        tool_call_deltas: [td(0, "tc_r", FAKE_READ_TOOL, "{}")],
        finish_reason: "tool_calls",
        is_final: true,
      }),
    ];

    // 足够的 read-only chunks 填满所有 iter
    const provider = makeProvider([
      chunks, chunks, // maxIter=2 需要 2 组
    ]);

    const config = buildConfig({
      maxIter: 2,
      onForceToolPath: async () => ({ mode: "continue" as const }),
    });

    const events = await collect(runAgentLoop(config, provider, [], { max_tokens: 100, temperature: 0, top_p: 1 }));

    // 2 个 iter_start
    expect(events.filter((e) => e.type === "iter_start")).toHaveLength(2);

    // 终结于 max_iter_reached
    expect(events.find((e) => e.type === "max_iter_reached")).toBeDefined();

    const maxIter = events.find((e) => e.type === "max_iter_reached") as
      | Extract<AgentLoopEvent<TestBusinessEvent>, { type: "max_iter_reached" }>
      | undefined;
    expect(maxIter?.data.iterCount).toBe(2);
  });

  // -------------------------------------------------------------------------
  // Case 7: streaming token + business chunk passthrough
  // -------------------------------------------------------------------------
  it("case 7: streaming token + business chunk passthrough via onToolCallDelta", async () => {
    const provider = makeProvider([
      [
        chunk({ delta: "Hello", is_final: false, finish_reason: null }),
        chunk({
          tool_call_deltas: [td(0, "tc_fake", FAKE_READ_TOOL, '{"k":"v"}')],
          is_final: false,
          finish_reason: null,
        }),
        chunk({ delta: "", is_final: true, finish_reason: "tool_calls" }),
      ],
    ]);

    const tokenChunks: string[] = [];
    let toolCallDeltaCalls = 0;

    const config = buildConfig({
      onTokenChunk: (delta) => {
        tokenChunks.push(delta);
      },
      onToolCallDelta: (_buf) => {
        toolCallDeltaCalls++;
        // business passthrough: emit extra business event alongside harness events
        return [{ type: "business", data: "STREAM_CHUNK" }];
      },
      onForceToolPath: async () => ({ mode: "terminal" as const, events: [{ type: "business", data: "DONE" }] }),
    });

    const events = await collect(runAgentLoop(config, provider, [], { max_tokens: 100, temperature: 0, top_p: 1 }));

    // onTokenChunk 被调（token chunk 透传）
    expect(tokenChunks).toHaveLength(1);
    expect(tokenChunks[0]).toBe("Hello");

    // token event 由 harness 直接 emit
    const tokenEvents = events.filter((e) => e.type === "token");
    expect(tokenEvents).toHaveLength(1);
    if (tokenEvents[0].type === "token") expect(tokenEvents[0].data).toBe("Hello");

    // onToolCallDelta 被调多次（每个 tool buffer 每个 delta 都触发）
    expect(toolCallDeltaCalls).toBeGreaterThanOrEqual(1);

    // business passthrough: STREAM_CHUNK 事件被 harness 透传
    const bizEvents = events.filter(
      (e) => e.type === "business" && (e as Extract<AgentLoopEvent<TestBusinessEvent>, { type: "business" }>).data === "STREAM_CHUNK",
    );
    expect(bizEvents.length).toBeGreaterThanOrEqual(1);

    // terminal business "DONE" 也在
    const doneBiz = events.find(
      (e) => e.type === "business" && (e as Extract<AgentLoopEvent<TestBusinessEvent>, { type: "business" }>).data === "DONE",
    );
    expect(doneBiz).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Case 8: catch path onPartialRescue
  // -------------------------------------------------------------------------
  it("case 8: catch path → onPartialRescue called → error rethrown", async () => {
    const provider: LLMProvider = {
      async generate() {
        return { content: "", model: "mock", input_tokens: 0, output_tokens: 0, finish_reason: "stop" };
      },
      async *generateStream(): AsyncIterable<LLMChunk> {
        yield chunk({ delta: "partial text", is_final: false, finish_reason: null });
        throw new Error("LLM streaming failure");
      },
    };

    let rescuedText = "";
    let rescueCalled = false;

    const config = buildConfig({
      onPartialRescue: async (fullText) => {
        rescueCalled = true;
        rescuedText = fullText;
        return { rescued: true };
      },
      onTextPathTerminal: async () => [],
    });

    const { events, error } = await collectOrError(
      runAgentLoop(config, provider, [], { max_tokens: 100, temperature: 0, top_p: 1 }),
    );

    // onPartialRescue 被调，传入已累积的 fullText
    expect(rescueCalled).toBe(true);
    expect(rescuedText).toBe("partial text");

    // error rethrown 给 caller
    expect(error).toBeInstanceOf(Error);
    if (error instanceof Error) {
      expect(error.message).toBe("LLM streaming failure");
    }
  });

  // -------------------------------------------------------------------------
  // L10（审计第二轮）：deviation 重试时，被丢弃的偏离文本先以 assistant 消息入 history，
  // 模型能看到自己上一条说了什么。回退旧码（只 push hint）→ 重试轮 messages 无该 assistant → 挂。
  // -------------------------------------------------------------------------
  it("L10: deviation 重试轮的 messages 含被丢弃的偏离 assistant 文本", async () => {
    // 每次 generateStream 记录收到的 messages。
    const capturedMessages: Message[][] = [];
    const iterChunks: LLMChunk[][] = [
      // iter 0: 纯文本偏离（hasFullText && !hasTools）→ 触发 deviation guard
      [chunk({ delta: "我先聊两句而不是续写。", is_final: true, finish_reason: "stop" })],
      // iter 1: 重试后走文本路径收尾
      [chunk({ delta: "好的，这次照做。", is_final: true, finish_reason: "stop" })],
    ];
    let callIndex = 0;
    const provider: LLMProvider = {
      async generate() {
        return { content: "", model: "mock", input_tokens: 0, output_tokens: 0, finish_reason: "stop" };
      },
      async *generateStream(params: { messages: Message[] }): AsyncIterable<LLMChunk> {
        capturedMessages.push(params.messages);
        const chunks = iterChunks[callIndex] ?? [];
        callIndex++;
        for (const c of chunks) yield c;
      },
    };

    const HINT = "[system] 请改用工具重说，不要用纯文本。";
    let deviationCalls = 0;
    const config = buildConfig({
      onGuardRetry: (kind) => {
        // 只在第一次 deviation 注入 hint 触发重试；iter1 再偏离时返 null 让文本路径收尾。
        if (kind === "deviation" && deviationCalls++ === 0) return { role: "user", content: HINT };
        return null;
      },
      onTextPathTerminal: async () => [{ type: "business", data: "TEXT_DONE" }],
    });

    await collect(runAgentLoop(config, provider, [{ role: "user", content: "开始" }], { max_tokens: 100, temperature: 0, top_p: 1 }));

    // 两次 LLM 调用（iter0 偏离 + iter1 重试收尾）
    expect(capturedMessages).toHaveLength(2);
    const retryMessages = capturedMessages[1];
    // 重试轮的 messages 必须包含 iter0 的偏离文本作为 assistant 消息……
    const deviationAssistant = retryMessages.find(
      (m) => m.role === "assistant" && m.content === "我先聊两句而不是续写。",
    );
    expect(deviationAssistant).toBeDefined();
    // ……且紧随其后是 hint（顺序：assistant 偏离 → user hint）
    const idxAssistant = retryMessages.findIndex((m) => m.role === "assistant" && m.content === "我先聊两句而不是续写。");
    const idxHint = retryMessages.findIndex((m) => m.role === "user" && m.content === HINT);
    expect(idxHint).toBe(idxAssistant + 1);
  });
});
