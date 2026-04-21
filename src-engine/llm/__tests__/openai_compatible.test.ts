// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleProvider } from "../openai_compatible.js";

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
