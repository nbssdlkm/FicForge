// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * dispatch_simple_chat 测试 — 验证流式 + tools 分流。
 * Mock LLM provider 给两种 finish_reason，确认事件序列正确。
 */

import { describe, expect, it } from "vitest";

import {
  dispatch_simple_chat,
  SIMPLE_TOOL_CHAT_REPLY,
  SIMPLE_TOOL_SHOW_CHAPTER,
  type SimpleChatEvent,
} from "../simple_chat_dispatch.js";
import { createProject, createLLMConfig } from "../../domain/project.js";
import { createState } from "../../domain/state.js";
import { createSettings } from "../../domain/settings.js";
import { createFact } from "../../domain/fact.js";
import { createThread } from "../../domain/thread.js";
import { LLMMode, FactStatus, IndexStatus } from "../../domain/enums.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import { FileDraftRepository } from "../../repositories/implementations/file_draft.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import type { LLMProvider, LLMResponse, LLMChunk, Message } from "../../llm/provider.js";
import type { VectorRepository } from "../../repositories/interfaces/vector.js";
import type { EmbeddingProvider } from "../../llm/embedding_provider.js";
import type { TelemetryEvent, TelemetrySink } from "../agent_telemetry.js";

function makeStreamProvider(chunks: LLMChunk[]): LLMProvider {
  return {
    async generate(): Promise<LLMResponse> {
      return { content: "", model: "mock", input_tokens: 0, output_tokens: 0, finish_reason: "stop" };
    },
    async *generateStream(): AsyncIterable<LLMChunk> {
      for (const c of chunks) yield c;
    },
  };
}

function makeBaseParams(adapter: MockAdapter, providerOverride: LLMProvider, userInput: string) {
  return {
    au_id: "au_test",
    chapter_num: 1,
    user_input: userInput,
    session_llm: null,
    session_params: null,
    project: createProject({
      project_id: "p", au_id: "au_test",
      llm: createLLMConfig({ mode: LLMMode.API, model: "test", api_base: "x", api_key: "k" }),
    }),
    state: createState({ au_id: "au_test", current_chapter: 1 }),
    settings: createSettings(),
    chapter_repo: new FileChapterRepository(adapter),
    draft_repo: new FileDraftRepository(adapter),
    adapter,
    _provider_override: providerOverride,
  };
}

async function collect(gen: AsyncGenerator<SimpleChatEvent>): Promise<SimpleChatEvent[]> {
  const events: SimpleChatEvent[] = [];
  for await (const ev of gen) events.push(ev);
  return events;
}

describe("dispatch_simple_chat", () => {
  it("text 路径：finish='stop' → token chunks + done_text + draft 落盘", async () => {
    const adapter = new MockAdapter();
    const provider = makeStreamProvider([
      { delta: "Hello", is_final: false, input_tokens: 10, output_tokens: null, finish_reason: null },
      { delta: " world", is_final: false, input_tokens: null, output_tokens: null, finish_reason: null },
      { delta: "!", is_final: true, input_tokens: null, output_tokens: 3, finish_reason: "stop" },
    ]);

    const events = await collect(dispatch_simple_chat(makeBaseParams(adapter, provider, "写第一章")));

    const tokenEvents = events.filter((e) => e.type === "token");
    expect(tokenEvents.map((e) => e.data)).toEqual(["Hello", " world", "!"]);
    const done = events.find((e) => e.type === "done_text");
    expect(done).toBeDefined();
    if (done && done.type === "done_text") {
      expect(done.data.full_text).toBe("Hello world!");
      expect(done.data.draft_label).toBe("A");
      expect(done.data.chapter_num).toBe(1);
      expect(done.data.generated_with.output_tokens).toBe(3);
    }
    // draft 落盘
    const drafts = await new FileDraftRepository(adapter).list_by_chapter("au_test", 1);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].variant).toBe("A");
    expect(drafts[0].content.trimEnd()).toBe("Hello world!");
  });

  it("terminal tool 路径：finish='tool_calls' chat_reply 流式 → chat_reply_chunk + done_tools 不 emit tool_call (agent MVP T4 + 流式 Option A)", async () => {
    // chat_reply 路径走流式：args content 字段被 dispatch partial-parse 后增量 emit
    // 为 chat_reply_chunk；tool_call 事件 skip 避免 UI 重复 append（用户实测要求）。
    // done_tools 仍含 chat_reply 在 tool_calls array（持久化 / 协议完整性需要）。
    const adapter = new MockAdapter();
    const provider = makeStreamProvider([
      {
        delta: "",
        tool_call_deltas: [{
          index: 0, id: "call_1", type: "function",
          function: { name: SIMPLE_TOOL_CHAT_REPLY, arguments: "" },
        }],
        is_final: false, input_tokens: 50, output_tokens: null, finish_reason: null,
      },
      {
        delta: "",
        tool_call_deltas: [{ index: 0, function: { arguments: '{"content":"hi ' } }],
        is_final: false, input_tokens: null, output_tokens: null, finish_reason: null,
      },
      {
        delta: "",
        tool_call_deltas: [{ index: 0, function: { arguments: 'there"}' } }],
        is_final: false, input_tokens: null, output_tokens: null, finish_reason: null,
      },
      { delta: "", is_final: true, input_tokens: null, output_tokens: 12, finish_reason: "tool_calls" },
    ]);

    const events = await collect(dispatch_simple_chat(makeBaseParams(adapter, provider, "嘿")));

    expect(events.find((e) => e.type === "done_text")).toBeUndefined();
    const doneTools = events.find((e) => e.type === "done_tools");
    expect(doneTools).toBeDefined();
    if (doneTools && doneTools.type === "done_tools") {
      expect(doneTools.data.tool_calls).toHaveLength(1);
      expect(doneTools.data.tool_calls[0].function.name).toBe(SIMPLE_TOOL_CHAT_REPLY);
      expect(doneTools.data.tool_calls[0].function.arguments).toBe('{"content":"hi there"}');
    }

    // chat_reply 路径流式 → tool_call 事件 NOT emit，chat_reply_chunk 增量 emit
    const toolCallEvents = events.filter((e) => e.type === "tool_call");
    expect(toolCallEvents).toHaveLength(0);

    const chunkEvents = events.filter((e) => e.type === "chat_reply_chunk");
    expect(chunkEvents.length).toBeGreaterThan(0);
    const fullStreamed = chunkEvents
      .map((e) => (e.type === "chat_reply_chunk" ? e.data : ""))
      .join("");
    expect(fullStreamed).toBe("hi there");

    const drafts = await new FileDraftRepository(adapter).list_by_chapter("au_test", 1);
    expect(drafts).toHaveLength(0);
  });

  it("多个 tool calls 按 index 拼装（agent MVP T4：terminal 路径用 chat_reply 兜底）", async () => {
    // 测协议机制：tool_call_deltas 多个 index 同 chunk → finalizeToolCalls 按 index
    // 排序拼回。chat_reply 触发 terminal break，混调 read-only 时 dispatch 把所有
    // tool_call 都 emit 给 UI（plan §三：chat_reply 路径 emit 全部 tool_call 让 UI
    // 看到完整 LLM 决策，不区分谁是 chat_reply）。
    const adapter = new MockAdapter();
    const provider = makeStreamProvider([
      {
        delta: "",
        tool_call_deltas: [
          { index: 0, id: "c0", type: "function", function: { name: SIMPLE_TOOL_SHOW_CHAPTER, arguments: '{"chapter_num":1}' } },
          { index: 1, id: "c1", type: "function", function: { name: SIMPLE_TOOL_CHAT_REPLY, arguments: '{"content":"看完了第一章"}' } },
        ],
        is_final: false, input_tokens: 0, output_tokens: null, finish_reason: null,
      },
      { delta: "", is_final: true, input_tokens: null, output_tokens: 0, finish_reason: "tool_calls" },
    ]);

    const events = await collect(dispatch_simple_chat(makeBaseParams(adapter, provider, "看第 1 章 + 闲聊")));
    const doneTools = events.find((e) => e.type === "done_tools");
    expect(doneTools).toBeDefined();
    if (doneTools && doneTools.type === "done_tools") {
      expect(doneTools.data.tool_calls).toHaveLength(2);
      expect(doneTools.data.tool_calls[0].function.name).toBe(SIMPLE_TOOL_SHOW_CHAPTER);
      expect(doneTools.data.tool_calls[1].function.name).toBe(SIMPLE_TOOL_CHAT_REPLY);
    }
  });

  it("provider 抛非 abort 错误 → DISPATCH_FAILURE", async () => {
    const adapter = new MockAdapter();
    const provider: LLMProvider = {
      async generate(): Promise<LLMResponse> { throw new Error("net"); },
      async *generateStream(): AsyncIterable<LLMChunk> {
        throw new Error("upstream broke");
      },
    };
    const events = await collect(dispatch_simple_chat(makeBaseParams(adapter, provider, "写")));
    const err = events.find((e) => e.type === "error");
    expect(err).toBeDefined();
    if (err && err.type === "error") {
      expect(err.data.error_code).toBe("DISPATCH_FAILURE");
      expect(err.data.message).toBe("upstream broke");
    }
  });

  it("name 跨 chunk 重发不重复（applyToolDelta 用 = 而非 += 防御非标实现）", async () => {
    // 用 chat_reply 触发 terminal 让 done_tools emit；测试焦点是 applyToolDelta 拼接
    // 行为，与具体 tool 名无关。
    const adapter = new MockAdapter();
    const provider = makeStreamProvider([
      {
        delta: "",
        tool_call_deltas: [{ index: 0, id: "x", type: "function", function: { name: SIMPLE_TOOL_CHAT_REPLY, arguments: "" } }],
        is_final: false, input_tokens: 0, output_tokens: null, finish_reason: null,
      },
      // 非标实现把 name 在第二片再发一次（不应该拼成 "chat_replychat_reply"）
      {
        delta: "",
        tool_call_deltas: [{ index: 0, function: { name: SIMPLE_TOOL_CHAT_REPLY, arguments: '{"content":"hi"}' } }],
        is_final: false, input_tokens: null, output_tokens: null, finish_reason: null,
      },
      { delta: "", is_final: true, input_tokens: null, output_tokens: 0, finish_reason: "tool_calls" },
    ]);
    const events = await collect(dispatch_simple_chat(makeBaseParams(adapter, provider, "嘿")));
    const doneTools = events.find((e) => e.type === "done_tools");
    expect(doneTools).toBeDefined();
    if (doneTools && doneTools.type === "done_tools") {
      expect(doneTools.data.tool_calls[0].function.name).toBe(SIMPLE_TOOL_CHAT_REPLY);
    }
  });

  it("partial rescue：mid-stream throw 时已累积的 fullText 真落盘为 partial draft（v4 盲审 2026-05-04 P0-2）", async () => {
    const adapter = new MockAdapter();
    // provider 先 yield 两段 text 然后抛错（典型网络中断 / 超时场景）
    const provider: LLMProvider = {
      async generate(): Promise<LLMResponse> {
        return { content: "", model: "mock", input_tokens: 0, output_tokens: 0, finish_reason: "stop" };
      },
      async *generateStream(): AsyncIterable<LLMChunk> {
        yield { delta: "夜色低垂，", is_final: false, input_tokens: 100, output_tokens: null, finish_reason: null };
        yield { delta: "酒馆里灯火通明", is_final: false, input_tokens: null, output_tokens: null, finish_reason: null };
        throw new Error("upstream connection closed");
      },
    };

    const events = await collect(dispatch_simple_chat(makeBaseParams(adapter, provider, "写第一章 主角进酒馆")));

    // partial_draft_label 必须在 error event 里非 null
    const err = events.find((e) => e.type === "error");
    expect(err).toBeDefined();
    if (err && err.type === "error") {
      expect(err.data.error_code).toBe("DISPATCH_FAILURE");
      expect(err.data.partial_draft_label).toBe("A");
    }

    // partial draft 必须真落盘（之前 label="" bug 时这条永远 0 个）
    const drafts = await new FileDraftRepository(adapter).list_by_chapter("au_test", 1);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].variant).toBe("A");
    expect(drafts[0].content).toContain("夜色低垂");
    expect(drafts[0].content).toContain("酒馆里灯火通明");
  });

  it("双 emit：finish='stop' + fullText + tools 共存 → done_text 与 done_tools 都 emit（v4 盲审 P0-1）", async () => {
    const adapter = new MockAdapter();
    const provider = makeStreamProvider([
      { delta: "Hello", is_final: false, input_tokens: 0, output_tokens: null, finish_reason: null },
      {
        delta: "",
        tool_call_deltas: [{ index: 0, id: "x", type: "function", function: { name: "show_chapter", arguments: '{"chapter_num":1}' } }],
        is_final: false, input_tokens: null, output_tokens: null, finish_reason: null,
      },
      { delta: "", is_final: true, input_tokens: null, output_tokens: 1, finish_reason: "stop" },
    ]);
    const events = await collect(dispatch_simple_chat(makeBaseParams(adapter, provider, "x")));

    // 双路径都触发
    const doneText = events.find((e) => e.type === "done_text");
    const doneTools = events.find((e) => e.type === "done_tools");
    expect(doneText).toBeDefined();
    expect(doneTools).toBeDefined();

    if (doneText && doneText.type === "done_text") {
      expect(doneText.data.full_text).toBe("Hello");
      expect(doneText.data.draft_label).toBe("A");
    }
    if (doneTools && doneTools.type === "done_tools") {
      expect(doneTools.data.tool_calls).toHaveLength(1);
      expect(doneTools.data.tool_calls[0].function.name).toBe("show_chapter");
    }

    // 事件顺序：done_text 先于 tool_call / done_tools（dispatch 实现保证）
    const idxDoneText = events.findIndex((e) => e.type === "done_text");
    const idxDoneTools = events.findIndex((e) => e.type === "done_tools");
    expect(idxDoneText).toBeLessThan(idxDoneTools);

    // draft 真落盘
    const drafts = await new FileDraftRepository(adapter).list_by_chapter("au_test", 1);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].content.trimEnd()).toBe("Hello");
  });

  it("协议异常 DECLARED_TOOLS_BUT_EMPTY：finish='tool_calls' 但 toolBuffers 空 → emit error，不落 draft（v4 二次盲审）", async () => {
    const adapter = new MockAdapter();
    // LLM 声明 tool_calls 但未产出任何 tool call delta（罕见 provider bug）
    const provider = makeStreamProvider([
      { delta: "", is_final: false, input_tokens: 50, output_tokens: null, finish_reason: null },
      { delta: "", is_final: true, input_tokens: null, output_tokens: 0, finish_reason: "tool_calls" },
    ]);
    const events = await collect(dispatch_simple_chat(makeBaseParams(adapter, provider, "x")));

    expect(events.find((e) => e.type === "done_text")).toBeUndefined();
    expect(events.find((e) => e.type === "done_tools")).toBeUndefined();
    const err = events.find((e) => e.type === "error");
    expect(err).toBeDefined();
    if (err && err.type === "error") {
      expect(err.data.error_code).toBe("DECLARED_TOOLS_BUT_EMPTY");
      expect(err.data.partial_draft_label).toBeNull();
    }

    // 不应落 draft（既无 fullText 也无 tool 输出，没东西可救）
    const drafts = await new FileDraftRepository(adapter).list_by_chapter("au_test", 1);
    expect(drafts).toHaveLength(0);
  });

  it("协议异常 EMPTY_RESPONSE：chunk 全空（无 text 无 tool）→ emit error，不落空 draft（v4 二次盲审）", async () => {
    const adapter = new MockAdapter();
    // 模型啥都没输出（finish='stop' 但 fullText 和 tool 都空）
    const provider = makeStreamProvider([
      { delta: "", is_final: true, input_tokens: 100, output_tokens: 0, finish_reason: "stop" },
    ]);
    const events = await collect(dispatch_simple_chat(makeBaseParams(adapter, provider, "x")));

    expect(events.find((e) => e.type === "done_text")).toBeUndefined();
    expect(events.find((e) => e.type === "done_tools")).toBeUndefined();
    const err = events.find((e) => e.type === "error");
    expect(err).toBeDefined();
    if (err && err.type === "error") {
      expect(err.data.error_code).toBe("EMPTY_RESPONSE");
      expect(err.data.partial_draft_label).toBeNull();
    }

    // 不应落空 draft（旧行为是落空 draft + done_text，新行为 yield error）
    const drafts = await new FileDraftRepository(adapter).list_by_chapter("au_test", 1);
    expect(drafts).toHaveLength(0);
  });

  it("协议异常 EMPTY_RESPONSE：finish_reason=null + 全空（provider 没传 finish_reason）→ 仍 emit error", async () => {
    const adapter = new MockAdapter();
    const provider = makeStreamProvider([
      { delta: "", is_final: true, input_tokens: null, output_tokens: null, finish_reason: null },
    ]);
    const events = await collect(dispatch_simple_chat(makeBaseParams(adapter, provider, "x")));

    const err = events.find((e) => e.type === "error");
    expect(err).toBeDefined();
    if (err && err.type === "error") {
      expect(err.data.error_code).toBe("EMPTY_RESPONSE");
    }
  });

  // ===========================================================================
  // agent MVP T4 — multi-iter agent loop
  // ===========================================================================

  /** 多 iter mock provider：每次调 generateStream 按 callIndex 取下一组 chunks。
   * 用于模拟 agent loop 多轮 LLM call —— 每轮 LLM 看到不同 internalHistory 决定不同输出。 */
  function makeMultiIterProvider(iterChunks: LLMChunk[][]): LLMProvider {
    let callIndex = 0;
    return {
      async generate(): Promise<LLMResponse> {
        return { content: "", model: "mock", input_tokens: 0, output_tokens: 0, finish_reason: "stop" };
      },
      async *generateStream(): AsyncIterable<LLMChunk> {
        const chunks = iterChunks[callIndex] ?? [];
        callIndex++;
        for (const c of chunks) yield c;
      },
    };
  }

  it("agent loop case 1: show_chapter 命中 → tool_result emit + 注 history → 下一轮 chat_reply terminal", async () => {
    // 准备：au_test/chapters/main/ 已有第 1 章
    const adapter = new MockAdapter();
    await adapter.mkdir("au_test/chapters/main");
    await adapter.writeFile(
      "au_test/chapters/main/ch0001.md",
      "---\nau_id: au_test\nchapter_num: 1\nrevision: 1\nfinalized_at: '2026-05-01T10:00:00Z'\nshow_in_text: true\n---\n第一章正文：夜色低垂...",
    );

    const provider = makeMultiIterProvider([
      // iter 0: LLM 调 show_chapter(1)
      [
        {
          delta: "",
          tool_call_deltas: [{
            index: 0, id: "tc_show", type: "function",
            function: { name: SIMPLE_TOOL_SHOW_CHAPTER, arguments: '{"chapter_num":1}' },
          }],
          is_final: false, input_tokens: 50, output_tokens: null, finish_reason: null,
        },
        { delta: "", is_final: true, input_tokens: null, output_tokens: 5, finish_reason: "tool_calls" },
      ],
      // iter 1: LLM 看到 tool_result 决定 chat_reply
      [
        {
          delta: "",
          tool_call_deltas: [{
            index: 0, id: "tc_reply", type: "function",
            function: { name: SIMPLE_TOOL_CHAT_REPLY, arguments: '{"content":"我看到第 1 章了，要我接着写吗？"}' },
          }],
          is_final: false, input_tokens: 200, output_tokens: null, finish_reason: null,
        },
        { delta: "", is_final: true, input_tokens: null, output_tokens: 20, finish_reason: "tool_calls" },
      ],
    ]);

    const events = await collect(dispatch_simple_chat(makeBaseParams(adapter, provider, "看第 1 章")));

    // 期望：iter 0 emit tool_call(show_chapter) + tool_result + iter 1 chat_reply 流式
    // (Option A 真机选用)：chat_reply 路径不 emit tool_call event 而 emit chat_reply_chunk 增量
    const toolCallEvents = events.filter((e) => e.type === "tool_call");
    expect(toolCallEvents).toHaveLength(1);
    expect(toolCallEvents[0].type === "tool_call" && toolCallEvents[0].data.function.name).toBe(SIMPLE_TOOL_SHOW_CHAPTER);

    const chunkEvents = events.filter((e) => e.type === "chat_reply_chunk");
    expect(chunkEvents.length).toBeGreaterThan(0);
    const fullStreamed = chunkEvents
      .map((e) => (e.type === "chat_reply_chunk" ? e.data : ""))
      .join("");
    expect(fullStreamed).toBe("我看到第 1 章了，要我接着写吗？");

    const toolResultEvents = events.filter((e) => e.type === "tool_result");
    expect(toolResultEvents).toHaveLength(1);
    if (toolResultEvents[0].type === "tool_result") {
      expect(toolResultEvents[0].data.tool_call_id).toBe("tc_show");
      expect(toolResultEvents[0].data.tool_name).toBe(SIMPLE_TOOL_SHOW_CHAPTER);
      expect(toolResultEvents[0].data.content).toContain("夜色低垂");
      expect(toolResultEvents[0].data.error_message).toBeUndefined();
    }

    // terminal done_tools (只 emit 一次，对应 chat_reply iter)
    const doneTools = events.filter((e) => e.type === "done_tools");
    expect(doneTools).toHaveLength(1);
    if (doneTools[0].type === "done_tools") {
      expect(doneTools[0].data.tool_calls[0].function.name).toBe(SIMPLE_TOOL_CHAT_REPLY);
    }

    // 不应落 draft（无 text 路径）
    const drafts = await new FileDraftRepository(adapter).list_by_chapter("au_test", 1);
    expect(drafts).toHaveLength(0);
  });

  it("agent loop case 2: show_setting NOT_FOUND → tool_result error + 注 history → 下一轮 create_character_file PENDING", async () => {
    // 用户问"建 Alice 设定"；LLM 先 show_setting('characters/Alice.md') → NOT_FOUND →
    // 下一轮 LLM 改用 create_character_file 带全 args → emit ToolCallCard + break PENDING
    const adapter = new MockAdapter();

    const provider = makeMultiIterProvider([
      // iter 0: show_setting Alice
      [
        {
          delta: "",
          tool_call_deltas: [{
            index: 0, id: "tc_show", type: "function",
            function: { name: "show_setting", arguments: '{"file_path":"characters/Alice.md"}' },
          }],
          is_final: false, input_tokens: 50, output_tokens: null, finish_reason: null,
        },
        { delta: "", is_final: true, input_tokens: null, output_tokens: 5, finish_reason: "tool_calls" },
      ],
      // iter 1: create_character_file with all required args
      [
        {
          delta: "",
          tool_call_deltas: [{
            index: 0, id: "tc_create", type: "function",
            function: {
              name: "create_character_file",
              arguments: '{"name":"Alice","content":"# Alice\\n银发女剑客"}',
            },
          }],
          is_final: false, input_tokens: 200, output_tokens: null, finish_reason: null,
        },
        { delta: "", is_final: true, input_tokens: null, output_tokens: 30, finish_reason: "tool_calls" },
      ],
    ]);

    const events = await collect(dispatch_simple_chat(makeBaseParams(adapter, provider, "建 Alice 设定")));

    // tool_result 应 emit FILE_NOT_FOUND
    const trEvents = events.filter((e) => e.type === "tool_result");
    expect(trEvents).toHaveLength(1);
    if (trEvents[0].type === "tool_result") {
      expect(trEvents[0].data.content).toBe("FILE_NOT_FOUND");
      expect(trEvents[0].data.error_message).toContain("Alice.md 不存在");
    }

    // 第二轮 mutating tool emit + done_tools terminal (PENDING_USER_CONFIRM)
    const tcEvents = events.filter((e) => e.type === "tool_call");
    expect(tcEvents).toHaveLength(2);
    if (tcEvents[1].type === "tool_call") {
      expect(tcEvents[1].data.function.name).toBe("create_character_file");
    }
    expect(events.filter((e) => e.type === "done_tools")).toHaveLength(1);

    // 不应自动落 mutating tool 副作用：dispatch 只产出意图，写盘走 confirm 路径
    expect(await adapter.exists("au_test/characters/Alice.md")).toBe(false);
  });

  it("agent loop case 3: max_iter 触达（read-only 死循环）→ AGENT_MAX_ITERATIONS error", async () => {
    const adapter = new MockAdapter();
    // 准备 5 章（够 LLM 一直 show 不同章）
    await adapter.mkdir("au_test/chapters/main");
    for (let n = 1; n <= 5; n++) {
      await adapter.writeFile(
        `au_test/chapters/main/ch${String(n).padStart(4, "0")}.md`,
        `---\nau_id: au_test\nchapter_num: ${n}\nrevision: 1\nfinalized_at: '2026-05-01T10:00:00Z'\nshow_in_text: true\n---\n第${n}章...`,
      );
    }
    // 每 iter LLM 都调 show_chapter(N)，N 递增（构造死循环）
    const iterChunks: LLMChunk[][] = [];
    for (let i = 0; i < 6; i++) {
      // 比 SIMPLE_AGENT_MAX_ITER=5 多准备一组防 mock 不够；正常 5 轮后 dispatch 退出
      iterChunks.push([
        {
          delta: "",
          tool_call_deltas: [{
            index: 0, id: `tc_show_${i}`, type: "function",
            function: { name: SIMPLE_TOOL_SHOW_CHAPTER, arguments: `{"chapter_num":${i + 1}}` },
          }],
          is_final: false, input_tokens: 50 + i * 10, output_tokens: null, finish_reason: null,
        },
        { delta: "", is_final: true, input_tokens: null, output_tokens: 5, finish_reason: "tool_calls" },
      ]);
    }
    const provider = makeMultiIterProvider(iterChunks);

    const events = await collect(dispatch_simple_chat(makeBaseParams(adapter, provider, "看每一章")));

    // 5 个 iter 都 emit show_chapter tool_call + tool_result
    const tcEvents = events.filter((e) => e.type === "tool_call");
    expect(tcEvents).toHaveLength(5);
    const trEvents = events.filter((e) => e.type === "tool_result");
    expect(trEvents).toHaveLength(5);

    // terminal AGENT_MAX_ITERATIONS error
    const err = events.find((e) => e.type === "error");
    expect(err).toBeDefined();
    if (err && err.type === "error") {
      expect(err.data.error_code).toBe("AGENT_MAX_ITERATIONS");
      expect(err.data.partial_draft_label).toBeNull();
    }
    // 不 emit done_tools / done_text（terminal 是 error）
    expect(events.find((e) => e.type === "done_tools")).toBeUndefined();
    expect(events.find((e) => e.type === "done_text")).toBeUndefined();
  });

  it("agent loop case 4: mutating tool args 不全（deepseek-v4-pro args=`{}` bug）→ tool_result 注错让 LLM 重试", async () => {
    // 复现 commit 6beb720 真机 bug：LLM 调 create_character_file 但 args={} →
    // dispatch validateToolArgs 拦下，注 TOOL_ARGS_INVALID tool_result + 继续 loop。
    // 第二轮 LLM 看到 error 改用正确 args 重调（emit + PENDING terminal）。
    const adapter = new MockAdapter();
    const provider = makeMultiIterProvider([
      // iter 0: create_character_file with args={}
      [
        {
          delta: "",
          tool_call_deltas: [{
            index: 0, id: "tc_bad", type: "function",
            function: { name: "create_character_file", arguments: "{}" },
          }],
          is_final: false, input_tokens: 50, output_tokens: null, finish_reason: null,
        },
        { delta: "", is_final: true, input_tokens: null, output_tokens: 3, finish_reason: "tool_calls" },
      ],
      // iter 1: 修正 args (name + content)
      [
        {
          delta: "",
          tool_call_deltas: [{
            index: 0, id: "tc_good", type: "function",
            function: {
              name: "create_character_file",
              arguments: '{"name":"Bob","content":"# Bob"}',
            },
          }],
          is_final: false, input_tokens: 200, output_tokens: null, finish_reason: null,
        },
        { delta: "", is_final: true, input_tokens: null, output_tokens: 15, finish_reason: "tool_calls" },
      ],
    ]);

    const events = await collect(dispatch_simple_chat(makeBaseParams(adapter, provider, "建 Bob")));

    // iter 0 应 emit tool_result 让 UI 看到 LLM 出错重试（不 emit ToolCallCard，避免污染对话流）
    // tool_call 只 emit 1 次（iter 1 的 valid args 那次）
    const tcEvents = events.filter((e) => e.type === "tool_call");
    expect(tcEvents).toHaveLength(1);
    if (tcEvents[0].type === "tool_call") {
      expect(tcEvents[0].data.id).toBe("tc_good");
      expect(JSON.parse(tcEvents[0].data.function.arguments).name).toBe("Bob");
    }

    const trEvents = events.filter((e) => e.type === "tool_result");
    expect(trEvents).toHaveLength(1);
    if (trEvents[0].type === "tool_result") {
      expect(trEvents[0].data.tool_call_id).toBe("tc_bad");
      // commit 接 Layer 1 后：retryHint 替代旧 hardcode "TOOL_ARGS_INVALID:"，
      // 保留"注意："前缀（避免 TUI 标红 + 模型把它当 fatal 中断推理）+ 字段名。
      expect(trEvents[0].data.content).toContain("注意：");
      expect(trEvents[0].data.content).toContain("name");
      expect(trEvents[0].data.content).toContain("content");
      expect(trEvents[0].data.error_message).toContain("参数无效");
    }

    expect(events.filter((e) => e.type === "done_tools")).toHaveLength(1);
  });

  it("agent loop case 6: 单 iter 多个 read-only tool → 顺次 fetch + 多 tool_result 注 history（v4-pro C3 review P2-9）", async () => {
    // 用户问"看第 1 章和 Alice 的设定"，LLM 一次产 [show_chapter, show_setting] →
    // 验证 dispatch 顺序 emit 两个 tool_call + 两个 tool_result，并把 assistant 含
    // 双 tool_calls + 两条 tool role messages 注入 internalHistory。第二轮 LLM
    // chat_reply 终结。
    const adapter = new MockAdapter();
    await adapter.mkdir("au_test/chapters/main");
    await adapter.writeFile(
      "au_test/chapters/main/ch0001.md",
      "---\nau_id: au_test\nchapter_num: 1\nrevision: 1\nfinalized_at: '2026-05-01T10:00:00Z'\nshow_in_text: true\n---\n第一章正文",
    );
    await adapter.mkdir("au_test/characters");
    await adapter.writeFile("au_test/characters/Alice.md", "# Alice\n剑客");

    const provider = makeMultiIterProvider([
      [
        {
          delta: "",
          tool_call_deltas: [
            { index: 0, id: "tc_chap", type: "function", function: { name: SIMPLE_TOOL_SHOW_CHAPTER, arguments: '{"chapter_num":1}' } },
            { index: 1, id: "tc_setting", type: "function", function: { name: "show_setting", arguments: '{"file_path":"characters/Alice.md"}' } },
          ],
          is_final: false, input_tokens: 50, output_tokens: null, finish_reason: null,
        },
        { delta: "", is_final: true, input_tokens: null, output_tokens: 5, finish_reason: "tool_calls" },
      ],
      [
        {
          delta: "",
          tool_call_deltas: [{
            index: 0, id: "tc_reply", type: "function",
            function: { name: SIMPLE_TOOL_CHAT_REPLY, arguments: '{"content":"看完了"}' },
          }],
          is_final: false, input_tokens: 200, output_tokens: null, finish_reason: null,
        },
        { delta: "", is_final: true, input_tokens: null, output_tokens: 10, finish_reason: "tool_calls" },
      ],
    ]);

    const events = await collect(dispatch_simple_chat(makeBaseParams(adapter, provider, "看第 1 章 + Alice")));

    // iter 0: 2 tool_call (read-only) + 2 tool_result + iter 1: chat_reply 流式（不 emit
    // tool_call，emit chat_reply_chunk）+ done_tools。Option A 真机选用。
    const tcEvents = events.filter((e) => e.type === "tool_call");
    expect(tcEvents).toHaveLength(2);
    if (tcEvents[0].type === "tool_call") expect(tcEvents[0].data.id).toBe("tc_chap");
    if (tcEvents[1].type === "tool_call") expect(tcEvents[1].data.id).toBe("tc_setting");

    const chunkEvents = events.filter((e) => e.type === "chat_reply_chunk");
    expect(chunkEvents.length).toBeGreaterThan(0);
    const fullStreamed = chunkEvents
      .map((e) => (e.type === "chat_reply_chunk" ? e.data : ""))
      .join("");
    expect(fullStreamed).toBe("看完了");

    const trEvents = events.filter((e) => e.type === "tool_result");
    expect(trEvents).toHaveLength(2);
    if (trEvents[0].type === "tool_result") {
      expect(trEvents[0].data.tool_call_id).toBe("tc_chap");
      expect(trEvents[0].data.content).toContain("第一章正文");
    }
    if (trEvents[1].type === "tool_result") {
      expect(trEvents[1].data.tool_call_id).toBe("tc_setting");
      expect(trEvents[1].data.content).toContain("Alice");
      expect(trEvents[1].data.content).toContain("剑客");
    }

    // 顺序：tool_call(chap) → tool_result(chap) → tool_call(setting) → tool_result(setting) → tool_call(reply) → done_tools
    const eventTypes = events.map((e) => e.type);
    const tcIndices = eventTypes.flatMap((t, i) => t === "tool_call" ? [i] : []);
    const trIndices = eventTypes.flatMap((t, i) => t === "tool_result" ? [i] : []);
    expect(tcIndices[0]).toBeLessThan(trIndices[0]);
    expect(trIndices[0]).toBeLessThan(tcIndices[1]);
    expect(tcIndices[1]).toBeLessThan(trIndices[1]);
  });

  it("agent loop case 7: show_chapter CHAPTER_NOT_FOUND → tool_result 含错误码，error_message 非空（executeReadTool 错误分支覆盖）", async () => {
    const adapter = new MockAdapter();
    // 不 mkdir chapters；exists 返 false
    const provider = makeMultiIterProvider([
      [
        {
          delta: "",
          tool_call_deltas: [{
            index: 0, id: "tc", type: "function",
            function: { name: SIMPLE_TOOL_SHOW_CHAPTER, arguments: '{"chapter_num":99}' },
          }],
          is_final: false, input_tokens: 0, output_tokens: null, finish_reason: null,
        },
        { delta: "", is_final: true, input_tokens: null, output_tokens: 0, finish_reason: "tool_calls" },
      ],
      // iter 1: chat_reply 终结
      [
        {
          delta: "",
          tool_call_deltas: [{
            index: 0, id: "tc_reply", type: "function",
            function: { name: SIMPLE_TOOL_CHAT_REPLY, arguments: '{"content":"那一章还没写"}' },
          }],
          is_final: false, input_tokens: 100, output_tokens: null, finish_reason: null,
        },
        { delta: "", is_final: true, input_tokens: null, output_tokens: 5, finish_reason: "tool_calls" },
      ],
    ]);

    const events = await collect(dispatch_simple_chat(makeBaseParams(adapter, provider, "看第 99 章")));

    const tr = events.find((e) => e.type === "tool_result");
    expect(tr).toBeDefined();
    if (tr && tr.type === "tool_result") {
      expect(tr.data.content).toContain("CHAPTER_NOT_FOUND");
      expect(tr.data.content).toContain("99");
      expect(tr.data.error_message).toContain("99 章不存在");
    }
  });

  it("agent loop case 8: batch retry 含原始 args（v4-pro C3 review P1-7）", async () => {
    // batch [valid create_character + invalid modify_character]：valid 兄弟收 BATCH_RETRY
    // 时 content 必须含原始 args 让 LLM 直接拷贝（不依赖记忆）。
    const adapter = new MockAdapter();
    const provider = makeMultiIterProvider([
      [
        {
          delta: "",
          tool_call_deltas: [
            {
              index: 0, id: "tc_valid", type: "function",
              function: { name: "create_character_file", arguments: '{"name":"Alice","content":"# Alice"}' },
            },
            {
              index: 1, id: "tc_invalid", type: "function",
              function: { name: "modify_character_file", arguments: "{}" },
            },
          ],
          is_final: false, input_tokens: 100, output_tokens: null, finish_reason: null,
        },
        { delta: "", is_final: true, input_tokens: null, output_tokens: 10, finish_reason: "tool_calls" },
      ],
      // iter 1: chat_reply 兜底（避免 max_iter 导致测试 timeout 等）
      [
        {
          delta: "",
          tool_call_deltas: [{
            index: 0, id: "tc_r", type: "function",
            function: { name: SIMPLE_TOOL_CHAT_REPLY, arguments: '{"content":"嗯"}' },
          }],
          is_final: false, input_tokens: 200, output_tokens: null, finish_reason: null,
        },
        { delta: "", is_final: true, input_tokens: null, output_tokens: 3, finish_reason: "tool_calls" },
      ],
    ]);

    const events = await collect(dispatch_simple_chat(makeBaseParams(adapter, provider, "Alice + Bob")));

    const trEvents = events.filter((e) => e.type === "tool_result");
    expect(trEvents).toHaveLength(2);

    // valid tc_valid 收 BATCH_RETRY + 原始 args
    const validResult = trEvents.find((e) => e.type === "tool_result" && e.data.tool_call_id === "tc_valid");
    expect(validResult).toBeDefined();
    if (validResult && validResult.type === "tool_result") {
      expect(validResult.data.content).toContain("TOOL_BATCH_RETRY");
      // 原始 args 被附在 content 末尾（防 LLM 重新生成失误）
      expect(validResult.data.content).toContain("create_character_file");
      expect(validResult.data.content).toContain("Alice");
    }

    // invalid tc_invalid 收 retryHint（含字段名 filename / new_content）
    // commit 接 Layer 1 后：retryHint 替代旧 hardcode "TOOL_ARGS_INVALID:"
    const invalidResult = trEvents.find((e) => e.type === "tool_result" && e.data.tool_call_id === "tc_invalid");
    expect(invalidResult).toBeDefined();
    if (invalidResult && invalidResult.type === "tool_result") {
      expect(invalidResult.data.content).toContain("注意：");
      expect(invalidResult.data.content).toContain("filename");
      expect(invalidResult.data.content).toContain("new_content");
    }
  });

  it("agent loop case 9: thinking 模型 reasoning_content 累积并多轮回传（真机 2026-05-04 P0 bug 修复）", async () => {
    // DeepSeek reasoner 在 thinking 阶段把内容放 chunk.delta.reasoning_content（不是
    // delta.content）。dispatch 必须累积 reasoning_content 写进下一轮 assistant message
    // 喂回 API，否则 deepseek 报 HTTP 400 "reasoning_content must be passed back"。
    // 测：read-only fetch 后 iter 1 的 messages 数组里应包含 iter 0 的 reasoning_content。
    const adapter = new MockAdapter();
    await adapter.mkdir("au_test/chapters/main");
    await adapter.writeFile(
      "au_test/chapters/main/ch0001.md",
      "---\nau_id: au_test\nchapter_num: 1\nrevision: 1\nfinalized_at: '2026-05-01T10:00:00Z'\nshow_in_text: true\n---\n第一章...",
    );

    // 自定义 provider：记录每次 generateStream 收到的 messages 数组
    const receivedMessages: import("../../llm/provider.js").Message[][] = [];
    let callIndex = 0;
    const provider: LLMProvider = {
      async generate(): Promise<LLMResponse> {
        return { content: "", model: "m", input_tokens: 0, output_tokens: 0, finish_reason: "stop" };
      },
      async *generateStream(params): AsyncIterable<LLMChunk> {
        receivedMessages.push([...params.messages]);
        const idx = callIndex++;
        if (idx === 0) {
          // iter 0: thinking 模型先发 reasoning_delta（多 chunks），再 tool_call
          yield { delta: "", reasoning_delta: "用户想看第一章，", is_final: false, input_tokens: 50, output_tokens: null, finish_reason: null };
          yield { delta: "", reasoning_delta: "我应该调用 show_chapter(1)。", is_final: false, input_tokens: null, output_tokens: null, finish_reason: null };
          yield {
            delta: "",
            tool_call_deltas: [{
              index: 0, id: "tc_show", type: "function",
              function: { name: SIMPLE_TOOL_SHOW_CHAPTER, arguments: '{"chapter_num":1}' },
            }],
            is_final: false, input_tokens: null, output_tokens: null, finish_reason: null,
          };
          yield { delta: "", is_final: true, input_tokens: null, output_tokens: 5, finish_reason: "tool_calls" };
        } else {
          // iter 1: chat_reply 终结
          yield {
            delta: "",
            tool_call_deltas: [{
              index: 0, id: "tc_reply", type: "function",
              function: { name: SIMPLE_TOOL_CHAT_REPLY, arguments: '{"content":"看完了"}' },
            }],
            is_final: false, input_tokens: 200, output_tokens: null, finish_reason: null,
          };
          yield { delta: "", is_final: true, input_tokens: null, output_tokens: 10, finish_reason: "tool_calls" };
        }
      },
    };

    await collect(dispatch_simple_chat(makeBaseParams(adapter, provider, "看第 1 章")));

    // iter 1 的 messages 数组中应该包含 iter 0 累积的 reasoning_content
    expect(receivedMessages.length).toBeGreaterThanOrEqual(2);
    const iter1Messages = receivedMessages[1];
    const assistantWithReasoning = iter1Messages.find((m) => m.role === "assistant" && m.tool_calls);
    expect(assistantWithReasoning).toBeDefined();
    expect(assistantWithReasoning?.reasoning_content).toBe("用户想看第一章，我应该调用 show_chapter(1)。");
  });

  it("agent loop case 10: 非 thinking 模型（无 reasoning_delta）assistant message 不写 reasoning_content（向后兼容）", async () => {
    // 普通 OpenAI / 老版本 deepseek 不发 reasoning_delta；assistant message 应保持
    // 没有 reasoning_content 字段（不是空字符串），保 chat history 干净。
    const adapter = new MockAdapter();
    await adapter.mkdir("au_test/chapters/main");
    await adapter.writeFile(
      "au_test/chapters/main/ch0001.md",
      "---\nau_id: au_test\nchapter_num: 1\nrevision: 1\nfinalized_at: '2026-05-01T10:00:00Z'\nshow_in_text: true\n---\n第一章...",
    );

    const receivedMessages: import("../../llm/provider.js").Message[][] = [];
    let callIndex = 0;
    const provider: LLMProvider = {
      async generate(): Promise<LLMResponse> {
        return { content: "", model: "m", input_tokens: 0, output_tokens: 0, finish_reason: "stop" };
      },
      async *generateStream(params): AsyncIterable<LLMChunk> {
        receivedMessages.push([...params.messages]);
        const idx = callIndex++;
        if (idx === 0) {
          yield {
            delta: "",
            tool_call_deltas: [{
              index: 0, id: "tc_show", type: "function",
              function: { name: SIMPLE_TOOL_SHOW_CHAPTER, arguments: '{"chapter_num":1}' },
            }],
            is_final: false, input_tokens: 50, output_tokens: null, finish_reason: null,
          };
          yield { delta: "", is_final: true, input_tokens: null, output_tokens: 5, finish_reason: "tool_calls" };
        } else {
          yield {
            delta: "",
            tool_call_deltas: [{
              index: 0, id: "tc_reply", type: "function",
              function: { name: SIMPLE_TOOL_CHAT_REPLY, arguments: '{"content":"ok"}' },
            }],
            is_final: false, input_tokens: 200, output_tokens: null, finish_reason: null,
          };
          yield { delta: "", is_final: true, input_tokens: null, output_tokens: 5, finish_reason: "tool_calls" };
        }
      },
    };

    await collect(dispatch_simple_chat(makeBaseParams(adapter, provider, "看第 1 章")));

    const iter1Messages = receivedMessages[1];
    const assistantWithToolCalls = iter1Messages.find((m) => m.role === "assistant" && m.tool_calls);
    expect(assistantWithToolCalls).toBeDefined();
    // 非 thinking 模型无 reasoning_content 字段（不是空字符串，是字段不存在）
    expect("reasoning_content" in (assistantWithToolCalls as object)).toBe(false);
  });

  it("agent loop case 5: mutating tool 单轮 valid args → emit ToolCallCard + done_tools PENDING（不进 iter 1）", async () => {
    // 单轮场景：LLM 一次性调 modify_character_file 带全 args，不需要 read-only 探索。
    // dispatch 直接 emit + break，不 fetch、不进下一 iter。
    const adapter = new MockAdapter();
    const provider = makeMultiIterProvider([
      [
        {
          delta: "",
          tool_call_deltas: [{
            index: 0, id: "tc_modify", type: "function",
            function: {
              name: "modify_character_file",
              arguments: '{"filename":"Alice.md","new_content":"# Alice\\n银发","change_summary":"改发色"}',
            },
          }],
          is_final: false, input_tokens: 100, output_tokens: null, finish_reason: null,
        },
        { delta: "", is_final: true, input_tokens: null, output_tokens: 20, finish_reason: "tool_calls" },
      ],
    ]);

    const events = await collect(dispatch_simple_chat(makeBaseParams(adapter, provider, "Alice 发色改银色")));

    expect(events.filter((e) => e.type === "tool_call")).toHaveLength(1);
    expect(events.filter((e) => e.type === "tool_result")).toHaveLength(0); // 单轮直 break，不注 result
    expect(events.filter((e) => e.type === "done_tools")).toHaveLength(1);
    expect(events.find((e) => e.type === "error")).toBeUndefined();
  });

  it("forceToolOnly：finish='tool_calls' + fullText 非空 → tool only + telemetry emit force_tool_only_with_text（v4 盲审 P0-1）", async () => {
    // 用 chat_reply 触发 terminal break；测试焦点是 forceToolOnly 模式下 fullText 被
    // 丢弃 + telemetry "force_tool_only_with_text" 事件触发，与具体 tool 名无关。
    // commit Layer 5 后：旧 console.warn 改为 telemetry.emit，本 test 用 mock sink 捕获。
    const adapter = new MockAdapter();
    const provider = makeStreamProvider([
      { delta: "我先想想", is_final: false, input_tokens: 0, output_tokens: null, finish_reason: null },
      {
        delta: "",
        tool_call_deltas: [{ index: 0, id: "y", type: "function", function: { name: SIMPLE_TOOL_CHAT_REPLY, arguments: '{"content":"hi"}' } }],
        is_final: false, input_tokens: null, output_tokens: null, finish_reason: null,
      },
      { delta: "", is_final: true, input_tokens: null, output_tokens: 5, finish_reason: "tool_calls" },
    ]);

    const emitted: TelemetryEvent[] = [];
    const mockSink: TelemetrySink = { emit: (e) => emitted.push(e) };
    const events = await collect(
      dispatch_simple_chat({
        ...makeBaseParams(adapter, provider, "看第二章"),
        _telemetry_override: mockSink,
      }),
    );

    // tool_calls finish_reason 强制 tool 路径，丢弃 fullText
    expect(events.find((e) => e.type === "done_text")).toBeUndefined();
    expect(events.find((e) => e.type === "done_tools")).toBeDefined();

    // telemetry 事件触发（提示 LLM 在 tool_calls 模式下还发了 text）
    const forceEvent = emitted.find((e) => e.kind === "force_tool_only_with_text");
    expect(forceEvent).toBeDefined();
    if (forceEvent && forceEvent.kind === "force_tool_only_with_text") {
      expect(forceEvent.agentName).toBe("simple_chat");
      expect(forceEvent.fullTextLen).toBeGreaterThan(0);
    }

    // draft 不应落盘（forceToolOnly 不写 draft）
    const drafts = await new FileDraftRepository(adapter).list_by_chapter("au_test", 1);
    expect(drafts).toHaveLength(0);
  });

  // ===========================================================================
  // 对话式 × 记忆栈融合 P1.3 — dispatch 改接 assemble_chat_context
  // ===========================================================================

  /** 多 iter mock：每轮按 callIndex 取 chunks，并捕获每轮 generateStream 收到的 messages。
   *  用于断言「组装只在循环外一次」（system message 跨轮 byte-identical）+ 记忆注入。 */
  function makeCapturingProvider(iterChunks: LLMChunk[][]): { provider: LLMProvider; calls: Message[][] } {
    let callIndex = 0;
    const calls: Message[][] = [];
    const provider: LLMProvider = {
      async generate(): Promise<LLMResponse> {
        return { content: "", model: "mock", input_tokens: 0, output_tokens: 0, finish_reason: "stop" };
      },
      async *generateStream(req: { messages: Message[] }): AsyncIterable<LLMChunk> {
        calls.push(req.messages);
        const chunks = iterChunks[callIndex] ?? [];
        callIndex++;
        for (const c of chunks) yield c;
      },
    };
    return { provider, calls };
  }

  it("分层上下文：facts / 剧情线 进 system message（走 assemble_chat_context，非全塞）", async () => {
    const adapter = new MockAdapter();
    const { provider, calls } = makeCapturingProvider([
      [{ delta: "好的", is_final: true, input_tokens: 10, output_tokens: 2, finish_reason: "stop" }],
    ]);

    const base = makeBaseParams(adapter, provider, "写第一章 主角登场");
    await collect(dispatch_simple_chat({
      ...base,
      facts: [createFact({ id: "f1", content_raw: "x", content_clean: "主角名叫林夜，是隐世剑客", status: FactStatus.ACTIVE, chapter: 1 })],
      threads: [createThread({ id: "t1", title: "复仇主线", state: "林夜在追查灭门凶手" })],
    }));

    expect(calls.length).toBeGreaterThanOrEqual(1);
    const systemContent = calls[0][0].content ?? "";
    expect(calls[0][0].role).toBe("system");
    expect(systemContent).toContain("主角名叫林夜");
    expect(systemContent).toContain("复仇主线");
    expect(systemContent).toContain("林夜在追查灭门凶手");
  });

  it("组装只在循环外一次：多 iter（read-only continue）下 RAG 只检索一次（embed 调用计数 = 1）", async () => {
    const adapter = new MockAdapter();
    await adapter.mkdir("au_test/chapters/main");
    await adapter.writeFile(
      "au_test/chapters/main/ch0001.md",
      "---\nau_id: au_test\nchapter_num: 1\nrevision: 1\nfinalized_at: '2026-05-01T10:00:00Z'\nshow_in_text: true\n---\n第一章正文：风起。",
    );
    const { provider, calls } = makeCapturingProvider([
      // iter 0: show_chapter(1) → read-only continue
      [
        {
          delta: "",
          tool_call_deltas: [{ index: 0, id: "tc_show", type: "function", function: { name: SIMPLE_TOOL_SHOW_CHAPTER, arguments: '{"chapter_num":1}' } }],
          is_final: false, input_tokens: 50, output_tokens: null, finish_reason: null,
        },
        { delta: "", is_final: true, input_tokens: null, output_tokens: 5, finish_reason: "tool_calls" },
      ],
      // iter 1: chat_reply → terminal
      [
        {
          delta: "",
          tool_call_deltas: [{ index: 0, id: "tc_reply", type: "function", function: { name: SIMPLE_TOOL_CHAT_REPLY, arguments: '{"content":"读完了"}' } }],
          is_final: false, input_tokens: 200, output_tokens: null, finish_reason: null,
        },
        { delta: "", is_final: true, input_tokens: null, output_tokens: 10, finish_reason: "tool_calls" },
      ],
    ]);

    // 注入 vector_repo + 计数 embedding：assemble_chat_context 每跑一次 → retrieveRagForContext
    // → embed([query]) 一次。所以 embed 调用次数 === 组装次数。这是"组装只一次、循环内不重算 RAG"
    // 的**载荷断言** —— 仅靠 system message byte-identity 抓不住（systemMessage 是同一对象引用，
    // 即便组装搬进循环、确定性重算出逐字节相同内容，引用比较仍 true，是伪命题）。
    let embedCount = 0;
    const embedding_provider: EmbeddingProvider = {
      async embed(texts: string[]): Promise<number[][]> { embedCount++; return texts.map(() => [1, 0, 0]); },
      get_dimension() { return 3; },
      get_model_name() { return "mock"; },
    };
    const vector_repo: VectorRepository = {
      async search() { return []; }, // 返空：RAG 无结果，但 embed 仍被调用一次/组装
      async index_chunks() {}, async delete_by_chapter() {}, async delete_by_source() {},
      async rebuild_index() {}, async get_index_status() { return IndexStatus.READY; },
    };

    const base = makeBaseParams(adapter, provider, "看第 1 章");
    await collect(dispatch_simple_chat({
      ...base,
      facts: [createFact({ id: "f1", content_raw: "x", content_clean: "世界设定：剑与魔法", status: FactStatus.ACTIVE })],
      vector_repo,
      embedding_provider,
    }));

    // 两轮 LLM call，但 RAG 只检索一次 ⇒ 组装只发生在循环外一次（循环内若重组会 embed 两次）。
    expect(calls.length).toBe(2);
    expect(embedCount).toBe(1);
    // 辅证：system message 含记忆层（facts 进 prompt）+ 跨轮一致（同一对象，逐字节自然相同）。
    expect(calls[0][0].content ?? "").toContain("世界设定：剑与魔法");
    expect(calls[0][0].content).toBe(calls[1][0].content);
    // 第二轮 internalHistory 增长（多了 assistant + tool 消息）。
    expect(calls[1].length).toBeGreaterThan(calls[0].length);
  });

  it("read-only fetch 结果按上限截断后注入 internalHistory（B3 防多轮爆 context）", async () => {
    const adapter = new MockAdapter();
    await adapter.mkdir("au_test/chapters/main");
    // 病态超长章节（远超 MAX_READ_FETCH_TOKENS=6000）
    const huge = "情节".repeat(4500); // ≈ 9000 字，token 数远超上限
    await adapter.writeFile(
      "au_test/chapters/main/ch0001.md",
      `---\nau_id: au_test\nchapter_num: 1\nrevision: 1\nfinalized_at: '2026-05-01T10:00:00Z'\nshow_in_text: true\n---\n${huge}`,
    );
    const { provider, calls } = makeCapturingProvider([
      [
        {
          delta: "",
          tool_call_deltas: [{ index: 0, id: "tc_show", type: "function", function: { name: SIMPLE_TOOL_SHOW_CHAPTER, arguments: '{"chapter_num":1}' } }],
          is_final: false, input_tokens: 50, output_tokens: null, finish_reason: null,
        },
        { delta: "", is_final: true, input_tokens: null, output_tokens: 5, finish_reason: "tool_calls" },
      ],
      [
        {
          delta: "",
          tool_call_deltas: [{ index: 0, id: "tc_reply", type: "function", function: { name: SIMPLE_TOOL_CHAT_REPLY, arguments: '{"content":"ok"}' } }],
          is_final: false, input_tokens: 200, output_tokens: null, finish_reason: null,
        },
        { delta: "", is_final: true, input_tokens: null, output_tokens: 10, finish_reason: "tool_calls" },
      ],
    ]);

    const events = await collect(dispatch_simple_chat(makeBaseParams(adapter, provider, "看第 1 章")));

    // 第二轮 internalHistory 里的 tool 消息内容被截断（远短于原文）
    const iter1ToolMsg = calls[1].find((m) => m.role === "tool");
    expect(iter1ToolMsg).toBeDefined();
    expect((iter1ToolMsg!.content ?? "").length).toBeLessThan(huge.length);
    expect(iter1ToolMsg!.content ?? "").toContain("截断");

    // 但 emit 给 UI 的 tool_result 仍是全文（持久化不丢）
    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult).toBeDefined();
    if (toolResult && toolResult.type === "tool_result") {
      expect(toolResult.data.content.length).toBeGreaterThan(huge.length / 2);
    }
  });
});
