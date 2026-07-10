// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useConnectionTest 测试（盲审长期债③：连接测试是新手配置的第一道门，
 * 失败/中断分支此前零测试）。
 *
 * 重点：
 * - error_code → i18n 的兜底映射（testConnection 只回 code 不带 message 的分支）；
 * - reset() 中断在途请求：迟到结果必须被 useActiveRequestGuard 丢弃；
 * - 连续两次 run 的竞态：只有最后一次的结果生效；
 * - 异常路径走 getExceptionMessage。
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEmbeddingConnectionTest, useLlmConnectionTest } from "../useConnectionTest";
import { testConnection, testEmbeddingConnection, type TestConnectionResponse } from "../../api/engine-client";
import type { LlmConfigFields } from "../../ui/shared/llm-config";

vi.mock("../../api/engine-client", () => ({
  testConnection: vi.fn(),
  testEmbeddingConnection: vi.fn(),
}));

vi.mock("../../i18n/useAppTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function makeFields(overrides: Partial<LlmConfigFields> = {}): LlmConfigFields {
  return {
    mode: "api",
    model: "deepseek-v4-flash",
    apiBase: "https://api.deepseek.com",
    apiKey: "sk-test",
    localModelPath: "",
    ollamaModel: "",
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setupLlm() {
  const options = {
    getSuccessMessage: vi.fn(() => "成功文案"),
    getFailureMessage: vi.fn((r: TestConnectionResponse) => `失败:${r.message}`),
    getExceptionMessage: vi.fn(() => "异常文案"),
  };
  const hook = renderHook(() => useLlmConnectionTest(options));
  return { hook, options };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useLlmConnectionTest · 基本状态机", () => {
  it("成功：idle → testing → success，payload 按 llm-config 契约构造（含 chat_path 透传）", async () => {
    vi.mocked(testConnection).mockResolvedValue({ success: true } as never);
    const { hook, options } = setupLlm();
    expect(hook.result.current.status).toBe("idle");

    await act(() => hook.result.current.run(makeFields({ chatPath: "/v1/gateway" })));

    expect(testConnection).toHaveBeenCalledWith(expect.objectContaining({
      mode: "api",
      model: "deepseek-v4-flash",
      api_key: "sk-test",
      chat_path: "/v1/gateway",
    }));
    expect(hook.result.current.status).toBe("success");
    expect(hook.result.current.message).toBe("成功文案");
    expect(options.getSuccessMessage).toHaveBeenCalled();
  });

  it("失败带 message：走调用方 getFailureMessage", async () => {
    vi.mocked(testConnection).mockResolvedValue({ success: false, message: "401 unauthorized" } as never);
    const { hook } = setupLlm();

    await act(() => hook.result.current.run(makeFields()));

    expect(hook.result.current.status).toBe("error");
    expect(hook.result.current.message).toBe("失败:401 unauthorized");
  });

  it("失败只回 error_code：兜底映射 i18n，不走调用方 getFailureMessage", async () => {
    vi.mocked(testConnection).mockResolvedValue({ success: false, error_code: "connection_failed" } as never);
    const { hook, options } = setupLlm();

    await act(() => hook.result.current.run(makeFields()));

    expect(hook.result.current.status).toBe("error");
    expect(hook.result.current.message).toBe("error_messages.connection_failed");
    expect(options.getFailureMessage).not.toHaveBeenCalled();
  });

  it("未知 error_code：映射表没有 → 仍走调用方 getFailureMessage", async () => {
    vi.mocked(testConnection).mockResolvedValue({ success: false, error_code: "weird_code" } as never);
    const { hook, options } = setupLlm();

    await act(() => hook.result.current.run(makeFields()));

    expect(options.getFailureMessage).toHaveBeenCalled();
    expect(hook.result.current.message).toBe("失败:undefined");
  });

  it("异常（网络层抛错）：status=error 走 getExceptionMessage", async () => {
    vi.mocked(testConnection).mockRejectedValue(new Error("fetch failed"));
    const { hook, options } = setupLlm();

    await act(() => hook.result.current.run(makeFields()));

    expect(hook.result.current.status).toBe("error");
    expect(hook.result.current.message).toBe("异常文案");
    expect(options.getExceptionMessage).toHaveBeenCalledWith(
      expect.objectContaining({ message: "fetch failed" }),
      expect.anything(),
    );
  });
});

describe("useLlmConnectionTest · 中断与竞态", () => {
  it("reset() 中断在途请求：迟到的成功结果被丢弃，状态停在 idle", async () => {
    const pending = deferred<TestConnectionResponse>();
    vi.mocked(testConnection).mockReturnValue(pending.promise as never);
    const { hook } = setupLlm();

    let runPromise!: Promise<void>;
    act(() => { runPromise = hook.result.current.run(makeFields()); });
    expect(hook.result.current.status).toBe("testing");

    act(() => hook.result.current.reset());
    expect(hook.result.current.status).toBe("idle");

    await act(async () => {
      pending.resolve({ success: true } as never);
      await runPromise;
    });
    // 迟到结果不得把 idle 顶回 success
    expect(hook.result.current.status).toBe("idle");
    expect(hook.result.current.message).toBe("");
  });

  it("连续两次 run：第一次的迟到失败被丢弃，最终呈现第二次的成功", async () => {
    const first = deferred<TestConnectionResponse>();
    vi.mocked(testConnection)
      .mockReturnValueOnce(first.promise as never)
      .mockResolvedValueOnce({ success: true } as never);
    const { hook } = setupLlm();

    let firstRun!: Promise<void>;
    act(() => { firstRun = hook.result.current.run(makeFields()); });
    await act(() => hook.result.current.run(makeFields()));
    expect(hook.result.current.status).toBe("success");

    await act(async () => {
      first.resolve({ success: false, message: "stale failure" } as never);
      await firstRun;
    });
    expect(hook.result.current.status).toBe("success");
    expect(hook.result.current.message).toBe("成功文案");
  });

  it("异常路径同样受 guard 保护：reset 后迟到 rejection 不改状态", async () => {
    const pending = deferred<TestConnectionResponse>();
    vi.mocked(testConnection).mockReturnValue(pending.promise as never);
    const { hook, options } = setupLlm();

    let runPromise!: Promise<void>;
    act(() => { runPromise = hook.result.current.run(makeFields()); });
    act(() => hook.result.current.reset());

    await act(async () => {
      pending.reject(new Error("late boom"));
      await runPromise;
    });
    expect(hook.result.current.status).toBe("idle");
    expect(options.getExceptionMessage).not.toHaveBeenCalled();
  });
});

describe("useEmbeddingConnectionTest", () => {
  it("参数映射为 snake_case 契约；成功走 getSuccessMessage", async () => {
    vi.mocked(testEmbeddingConnection).mockResolvedValue({ success: true, dimension: 1024 } as never);
    const options = {
      getSuccessMessage: vi.fn(() => "embedding ok"),
      getFailureMessage: vi.fn(() => "embedding fail"),
      getExceptionMessage: vi.fn(() => "embedding err"),
    };
    const { result } = renderHook(() => useEmbeddingConnectionTest(options));

    await act(() => result.current.run({ model: "bge-m3", apiBase: "https://api.siliconflow.cn/v1", apiKey: "sk-e" }));

    expect(testEmbeddingConnection).toHaveBeenCalledWith({
      api_base: "https://api.siliconflow.cn/v1",
      api_key: "sk-e",
      model: "bge-m3",
    });
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.message).toBe("embedding ok");
  });

  it("失败：走 getFailureMessage（embedding 无 error_code 兜底层）", async () => {
    vi.mocked(testEmbeddingConnection).mockResolvedValue({ success: false, message: "bad model" } as never);
    const options = {
      getSuccessMessage: vi.fn(() => "ok"),
      getFailureMessage: vi.fn(() => "embedding 失败"),
      getExceptionMessage: vi.fn(() => "err"),
    };
    const { result } = renderHook(() => useEmbeddingConnectionTest(options));

    await act(() => result.current.run({ model: "m", apiBase: "b", apiKey: "k" }));

    expect(result.current.status).toBe("error");
    expect(result.current.message).toBe("embedding 失败");
  });
});

describe("useLlmConnectionTest — 明文 HTTP 告警透出（盲审 2026-07-11 安全维）", () => {
  it("success + warning_code=plaintext_http：状态仍 success，文案追加告警句", async () => {
    vi.mocked(testConnection).mockResolvedValue({
      success: true, model: "m", warning_code: "plaintext_http",
    } as never);
    const { hook, options } = setupLlm();
    await act(() => hook.result.current.run(makeFields({ apiBase: "http://relay.example.com/v1" })));
    await waitFor(() => expect(hook.result.current.status).toBe("success"));
    expect(options.getSuccessMessage).toHaveBeenCalled();
    // t() 被 mock 成回 key —— 断言告警键被拼进成功文案
    expect(hook.result.current.message).toContain("成功文案");
    expect(hook.result.current.message).toContain("error_messages.plaintext_http_warning");
  });

  it("success 无 warning_code：文案不带告警", async () => {
    vi.mocked(testConnection).mockResolvedValue({ success: true, model: "m" } as never);
    const { hook } = setupLlm();
    await act(() => hook.result.current.run(makeFields()));
    await waitFor(() => expect(hook.result.current.status).toBe("success"));
    expect(hook.result.current.message).toBe("成功文案");
  });
});

describe("useEmbeddingConnectionTest — 明文 HTTP 告警透出（与 LLM 侧同口径）", () => {
  it("success + warning_code：成功文案追加告警句", async () => {
    vi.mocked(testEmbeddingConnection).mockResolvedValue({
      success: true, dimension: 1024, warning_code: "plaintext_http",
    } as never);
    const options = {
      getSuccessMessage: vi.fn(() => "embedding ok"),
      getFailureMessage: vi.fn(() => "embedding fail"),
      getExceptionMessage: vi.fn(() => "embedding err"),
    };
    const { result } = renderHook(() => useEmbeddingConnectionTest(options));
    await act(() => result.current.run({ model: "bge-m3", apiBase: "http://192.168.1.5/v1", apiKey: "k" }));
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.message).toContain("embedding ok");
    expect(result.current.message).toContain("error_messages.plaintext_http_warning");
  });
});
