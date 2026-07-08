// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * R2-2：testConnection 必须与真实生成打同一 URL —— 自定义 chat_path 网关下
 * 不允许「测默认路径通过、生成 404」。
 * R2-4：fetchProviderModels 错误分类（auth / network / http）供 UI 映射可懂文案。
 * R2-6：testConnection 的 local / Ollama 分支不再硬编码中文 message，只回 error_code。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FetchModelsError, fetchProviderModels, testConnection } from "../engine-settings";

const okChatCompletion = {
  ok: true,
  json: async () => ({
    choices: [{ message: { content: "hi" }, finish_reason: "stop" }],
    model: "echo-model",
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }),
};

describe("testConnection — chat_path 同 URL（R2-2）", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue(okChatCompletion);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("自定义 chat_path → 请求 URL 含该路径（不打默认 /chat/completions）", async () => {
    const result = await testConnection({
      mode: "api",
      model: "m",
      api_base: "https://gateway.example/openai",
      api_key: "sk-x",
      chat_path: "/relay/v1/chat",
    });
    expect(result.success).toBe(true);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe("https://gateway.example/openai/relay/v1/chat");
  });

  it("缺省 chat_path → 回退默认 /chat/completions（行为不变）", async () => {
    await testConnection({ mode: "api", model: "m", api_base: "https://api.example/v1", api_key: "sk-x" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example/v1/chat/completions");
  });

  it("空串 chat_path 归一为缺省（与保存路径 normalizeChatPath 同口径）", async () => {
    await testConnection({ mode: "api", model: "m", api_base: "https://api.example/v1", api_key: "sk-x", chat_path: "  " });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.example/v1/chat/completions");
  });

  it("local 分支：只回 error_code=unsupported_mode，不带硬编码 message（i18n 在 UI 层）", async () => {
    const result = await testConnection({ mode: "local" });
    expect(result.success).toBe(false);
    expect(result.error_code).toBe("unsupported_mode");
    expect((result as { message?: string }).message).toBeUndefined();
  });

  it("ollama 探测失败：只回 error_code=connection_failed，不带硬编码 message", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502 });
    const result = await testConnection({ mode: "ollama", ollama_model: "llama3" });
    expect(result.success).toBe(false);
    expect(result.error_code).toBe("connection_failed");
    expect((result as { message?: string }).message).toBeUndefined();
  });
});

describe("fetchProviderModels — 错误分类（R2-4）", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const call = () => fetchProviderModels({ api_base: "https://api.example/v1", api_key: "sk-x" });

  it("401/403 → code=auth（密钥无效或未填）", async () => {
    for (const status of [401, 403]) {
      fetchMock.mockResolvedValueOnce({ ok: false, status });
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(FetchModelsError);
      expect((err as FetchModelsError).code).toBe("auth");
      expect((err as FetchModelsError).status).toBe(status);
    }
  });

  it("其余非 2xx → code=http 且带状态码", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });
    const err = await call().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchModelsError);
    expect((err as FetchModelsError).code).toBe("http");
    expect((err as FetchModelsError).status).toBe(500);
  });

  it("fetch 网络层失败（DNS/拒连）→ code=network", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const err = await call().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchModelsError);
    expect((err as FetchModelsError).code).toBe("network");
  });

  it("超时中止 → code=network（与网络失败同口径）", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    const err = await call().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(FetchModelsError);
    expect((err as FetchModelsError).code).toBe("network");
  });

  it("成功路径不受分类改造影响", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: "m1" }, { id: "m2" }] }) });
    await expect(call()).resolves.toEqual({ ids: ["m1", "m2"] });
  });
});
