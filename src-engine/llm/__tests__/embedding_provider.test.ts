// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * RemoteEmbeddingProvider.embed 外部 AbortSignal（MED-2）判别性测试。
 *
 * 目标：取消 backfill / 重建索引时，在飞的 embed HTTP 请求**立即**中止（不空跑到 30s 超时、
 * 不白扣费），并抛出 name="AbortError"（供 backfill.isAbortError 识别为干净取消）。
 * 回退到「embed 不接外部 signal」会让 controller.abort() 无从联动 → 请求挂到超时 → 判别断言挂。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteEmbeddingProvider } from "../embedding_provider.js";

function okEmbedResponse(dim = 3): Response {
  return new Response(JSON.stringify({ data: [{ index: 0, embedding: Array(dim).fill(0.1) }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("RemoteEmbeddingProvider.embed 外部取消", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("外部 signal 已取消 → 不发起请求，立即抛 AbortError", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okEmbedResponse());
    vi.stubGlobal("fetch", fetchMock);

    const provider = new RemoteEmbeddingProvider("https://embed.example.com/v1", "key", "m");
    const controller = new AbortController();
    controller.abort();

    await expect(provider.embed(["hi"], { signal: controller.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
    // 判别：已取消就不该打网络（回退旧码无此短路 → fetch 被调用）
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("在飞时外部 signal 触发 → 立即抛 AbortError，而非超时/网络错误", async () => {
    // fetch 只在其自身 init.signal 被 abort 时 reject（模拟真实 fetch 的中止行为）；否则永不 resolve。
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const e = new Error("The operation was aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new RemoteEmbeddingProvider("https://embed.example.com/v1", "key", "m");
    const controller = new AbortController();
    const p = provider.embed(["hi"], { signal: controller.signal });
    // 外部取消 → 内部 controller 联动 → fetch 立即 reject
    controller.abort();

    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("无外部 signal + 正常响应 → 返回向量（不受改动影响）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okEmbedResponse(4)));
    const provider = new RemoteEmbeddingProvider("https://embed.example.com/v1", "key", "m");
    const out = await provider.embed(["hi"]);
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(4);
  });

  it("空输入 → 直接返回空，不发请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const provider = new RemoteEmbeddingProvider("https://embed.example.com/v1", "key", "m");
    expect(await provider.embed([], { signal: new AbortController().signal })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
