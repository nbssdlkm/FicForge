// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "../openai_compatible.js";

function makeSseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

describe("OpenAICompatibleProvider.generateStream tool_call streaming (FicForge Lite C2/C3 集成依赖)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("transparently passes tool_call deltas through LLMChunk.tool_call_deltas", async () => {
    const ssePayload = [
      'data: {"choices":[{"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"show_chapter","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"chapter"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"_num\\":3}"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      "data: [DONE]\n\n",
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeSseResponse(ssePayload)));

    const provider = new OpenAICompatibleProvider("https://example.com", "key", "model");
    const chunks = [];
    for await (const c of provider.generateStream({
      messages: [{ role: "user", content: "看第 3 章" }],
      max_tokens: 100, temperature: 1, top_p: 1,
      tools: [
        { type: "function", function: { name: "show_chapter", description: "x", parameters: { type: "object", properties: {} } } },
      ],
    })) {
      chunks.push(c);
    }

    // 4 个 chunks（OpenAI 5 行减去 [DONE] —— [DONE] 是 return 不 yield）
    expect(chunks).toHaveLength(4);

    // 第一片：name 出现，无 args
    expect(chunks[0].tool_call_deltas).toBeDefined();
    expect(chunks[0].tool_call_deltas![0]).toMatchObject({
      index: 0,
      id: "call_abc",
      type: "function",
      function: { name: "show_chapter", arguments: "" },
    });

    // 第二、三片：args 增量
    expect(chunks[1].tool_call_deltas![0].function?.arguments).toBe('{"chapter');
    expect(chunks[2].tool_call_deltas![0].function?.arguments).toBe('_num":3}');

    // 第四片：finish_reason='tool_calls'，无 tool_call_deltas
    expect(chunks[3].finish_reason).toBe("tool_calls");
    expect(chunks[3].tool_call_deltas).toBeUndefined();
  });

  it("纯 text 流式不携带 tool_call_deltas", async () => {
    const ssePayload = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeSseResponse(ssePayload)));

    const provider = new OpenAICompatibleProvider("https://example.com", "key", "model");
    const chunks = [];
    for await (const c of provider.generateStream({
      messages: [{ role: "user", content: "x" }],
      max_tokens: 100, temperature: 1, top_p: 1,
    })) chunks.push(c);

    expect(chunks).toHaveLength(3);
    for (const c of chunks) expect(c.tool_call_deltas).toBeUndefined();
    expect(chunks[0].delta).toBe("Hello");
    expect(chunks[1].delta).toBe(" world");
    expect(chunks[2].finish_reason).toBe("stop");
  });
});

describe("OpenAICompatibleProvider.generateStream", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rethrows AbortError when the external signal cancels the fetch", async () => {
    const fetchImpl = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const signal = init?.signal as AbortSignal | undefined;
      return await new Promise<Response>((_resolve, reject) => {
        const onAbort = () => {
          signal?.removeEventListener("abort", onAbort);
          reject(new DOMException("Aborted", "AbortError"));
        };

        if (!signal) {
          return;
        }
        if (signal.aborted) {
          onAbort();
          return;
        }

        signal.addEventListener("abort", onAbort, { once: true });
      });
    });
    vi.stubGlobal("fetch", fetchImpl);

    const provider = new OpenAICompatibleProvider("https://example.com", "key", "model");
    const controller = new AbortController();
    const iterator = provider.generateStream({
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 32,
      temperature: 1,
      top_p: 1,
      signal: controller.signal,
    })[Symbol.asyncIterator]();

    const nextChunk = iterator.next();
    controller.abort();

    await expect(nextChunk).rejects.toMatchObject({
      name: "AbortError",
    });
  });
});

describe("OpenAICompatibleProvider.generate (T7-5: cancellable retry)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("aborts during 429 backoff wait without finishing the delay", async () => {
    let fetchCalls = 0;
    const fetchImpl = vi.fn().mockImplementation(async () => {
      fetchCalls += 1;
      // 第一次返回 429 触发 retry429；之后不应再被调用，因为我们会在 backoff 中 abort
      return new Response("rate limited", { status: 429, statusText: "Too Many Requests" });
    });
    vi.stubGlobal("fetch", fetchImpl);

    const provider = new OpenAICompatibleProvider("https://example.com", "key", "model");
    const controller = new AbortController();

    const startedAt = Date.now();
    const promise = provider.generate({
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 32,
      temperature: 1,
      top_p: 1,
      signal: controller.signal,
    });

    // retry429 第一个 backoff 是 1000ms；50ms 后 abort，应该立即 reject 而不是等满 1000ms
    setTimeout(() => controller.abort(), 50);

    await expect(promise).rejects.toMatchObject({ error_code: "cancelled" });
    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeLessThan(500); // 远小于 1000ms 的退避，证明 wait 被中断
    expect(fetchCalls).toBe(1); // 不应该走到 retry 的 fetch
  });

  it("cleans up abort listener after successful request (no leak)", async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchImpl);

    const provider = new OpenAICompatibleProvider("https://example.com", "key", "model");
    const controller = new AbortController();

    // Spy on add/removeEventListener to verify pairing
    const addSpy = vi.spyOn(controller.signal, "addEventListener");
    const removeSpy = vi.spyOn(controller.signal, "removeEventListener");

    await provider.generate({
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 32,
      temperature: 1,
      top_p: 1,
      signal: controller.signal,
    });

    // 每次 addEventListener("abort", ...) 都必须有对应的 removeEventListener
    const addAbortCalls = addSpy.mock.calls.filter((c) => c[0] === "abort").length;
    const removeAbortCalls = removeSpy.mock.calls.filter((c) => c[0] === "abort").length;
    expect(addAbortCalls).toBe(removeAbortCalls);
    expect(addAbortCalls).toBeGreaterThan(0); // 至少加过一次，确认走过了 attachAbort 路径
  });
});

describe("OpenAICompatibleProvider 错误处理 (BUG 3.1 错误码拆分)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("tool_choice 错误关键词触发 forced_tool_choice_unsupported", async () => {
    const errorBody = JSON.stringify({
      error: { message: "deepseek-reasoner does not support this tool_choice" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(errorBody, {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const provider = new OpenAICompatibleProvider(
      "https://example.com",
      "key",
      "deepseek-reasoner",
    );
    await expect(
      provider.generate({
        messages: [{ role: "user", content: "hello" }],
        max_tokens: 32,
        temperature: 1,
        top_p: 1,
      }),
    ).rejects.toMatchObject({ error_code: "forced_tool_choice_unsupported" });
  });

  it("tools not supported 错误关键词触发 tools_unsupported（回归保护）", async () => {
    const errorBody = JSON.stringify({
      error: { message: "tools are not supported" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(errorBody, {
          status: 400,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    const provider = new OpenAICompatibleProvider(
      "https://example.com",
      "key",
      "model",
    );
    await expect(
      provider.generate({
        messages: [{ role: "user", content: "hello" }],
        max_tokens: 32,
        temperature: 1,
        top_p: 1,
      }),
    ).rejects.toMatchObject({ error_code: "tools_unsupported" });
  });
});
