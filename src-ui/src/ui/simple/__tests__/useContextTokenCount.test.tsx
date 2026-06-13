// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/engine-client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/engine-client")>(
    "../../../api/engine-client",
  );
  return {
    ...actual,
    estimateSimpleContextTokens: vi.fn(),
  };
});

import * as engineClient from "../../../api/engine-client";
import { useContextTokenCount } from "../useContextTokenCount";
import type { SimpleChatMessage } from "../types";
import { nowIso } from "../types";

const mocked = vi.mocked(engineClient.estimateSimpleContextTokens);

describe("useContextTokenCount", () => {
  beforeEach(() => {
    mocked.mockReset();
  });

  it("初始 estimate=null，loading=true，加载完后填值", async () => {
    mocked.mockResolvedValue({
      inputTokens: 12_345,
      contextWindow: 128_000,
      maxOutput: 8_000,
      ratio: 0.096,
      level: "normal",
    });

    const { result } = renderHook(() => useContextTokenCount("au_t"));
    expect(result.current.estimate).toBeNull();
    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.estimate).not.toBeNull(), { timeout: 1500 });
    expect(result.current.estimate?.inputTokens).toBe(12_345);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("refreshKey 变化触发重算", async () => {
    mocked.mockResolvedValue({
      inputTokens: 100, contextWindow: 1000, maxOutput: 100, ratio: 0.1, level: "normal",
    });

    const { result, rerender } = renderHook(
      ({ key }) => useContextTokenCount("au_r", key),
      { initialProps: { key: 0 } },
    );

    await waitFor(() => expect(mocked).toHaveBeenCalledTimes(1), { timeout: 1500 });
    expect(result.current.estimate?.inputTokens).toBe(100);

    mocked.mockResolvedValue({
      inputTokens: 200, contextWindow: 1000, maxOutput: 100, ratio: 0.2, level: "normal",
    });
    rerender({ key: 1 });
    await waitFor(() => expect(mocked).toHaveBeenCalledTimes(2), { timeout: 1500 });
    expect(result.current.estimate?.inputTokens).toBe(200);
  });

  it("error 设到 error 字段", async () => {
    mocked.mockRejectedValue(new Error("repo locked"));

    const { result } = renderHook(() => useContextTokenCount("au_e"));
    await waitFor(() => expect(result.current.error).not.toBeNull(), { timeout: 1500 });
    expect(result.current.error).toBe("repo locked");
    expect(result.current.estimate).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it("messages 变化触发重算（含 history）", async () => {
    mocked.mockResolvedValue({
      inputTokens: 100, contextWindow: 1000, maxOutput: 100, ratio: 0.1, level: "normal",
    });

    const { rerender } = renderHook(
      ({ msgs }) => useContextTokenCount("au_h", 0, msgs),
      { initialProps: { msgs: [] as SimpleChatMessage[] } },
    );

    await waitFor(() => expect(mocked).toHaveBeenCalledTimes(1), { timeout: 1500 });

    const newMsgs: SimpleChatMessage[] = [
      { id: "m1", kind: "user", timestamp: nowIso(), content: "hi" },
      { id: "m2", kind: "assistant", timestamp: nowIso(), content: "hello" },
    ];
    rerender({ msgs: newMsgs });
    await waitFor(() => expect(mocked).toHaveBeenCalledTimes(2), { timeout: 1500 });

    // 验证 mocked 第二次被传了 history
    const lastCallArgs = mocked.mock.calls[mocked.mock.calls.length - 1];
    expect(lastCallArgs[1]).toBeDefined();  // history 参数
    expect(Array.isArray(lastCallArgs[1])).toBe(true);
  });
});
