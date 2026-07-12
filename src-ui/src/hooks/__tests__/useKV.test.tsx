// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useKV — L21（审计第二轮）判别性回归测试。
 *
 * 两条不变量：
 * 1) 初始异步 kvGet resolve 时若用户已先一步 set，不用磁盘旧值回滚用户刚写的值。
 * 2) key 变更时 value 重置为 defaultValue 并对新 key 重新加载。
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// 可控的 kvGet：用 deferred 手动决定何时 resolve，制造「用户先 set、加载后 resolve」的竞态。
const h = vi.hoisted(() => {
  const store: Record<string, string | null> = {};
  let pendingResolvers: Array<(v: string | null) => void> = [];
  return {
    store,
    resolveNext(value: string | null) {
      const r = pendingResolvers.shift();
      if (r) r(value);
    },
    resetPending() {
      pendingResolvers = [];
    },
    adapter: {
      kvGet: vi.fn(
        (_key: string) =>
          new Promise<string | null>((res) => {
            pendingResolvers.push(res);
          }),
      ),
      kvSet: vi.fn(async (key: string, v: string) => {
        store[key] = v;
      }),
    },
  };
});

vi.mock("../../api/engine-client", () => ({
  isEngineReady: () => true,
  getEngine: () => ({ adapter: h.adapter }),
}));

import { useKV } from "../useKV";

describe("useKV — L21", () => {
  beforeEach(() => {
    h.adapter.kvGet.mockClear();
    h.adapter.kvSet.mockClear();
    h.resetPending();
  });

  it("初始加载 resolve 前用户已 set → 不用磁盘旧值回滚用户写入", async () => {
    const { result } = renderHook(() => useKV("k1", "default"));
    // 初值 = default（加载尚未 resolve）
    expect(result.current[0]).toBe("default");

    // 用户抢先写入
    act(() => {
      result.current[1]("user-typed");
    });
    expect(result.current[0]).toBe("user-typed");

    // 此刻初始 kvGet 才 resolve 出磁盘旧值 —— 不该覆盖用户刚写的
    await act(async () => {
      h.resolveNext("disk-old-value");
    });
    expect(result.current[0]).toBe("user-typed");
  });

  it("初始加载 resolve 早于用户操作 → 采用磁盘值（正常路径不被破坏）", async () => {
    const { result } = renderHook(() => useKV("k2", "default"));
    await act(async () => {
      h.resolveNext("disk-value");
    });
    await waitFor(() => expect(result.current[0]).toBe("disk-value"));
  });

  it("key 变更 → value 重置为 default 并对新 key 重新加载", async () => {
    const { result, rerender } = renderHook(({ k }) => useKV(k, "default"), {
      initialProps: { k: "kA" },
    });
    await act(async () => {
      h.resolveNext("valueA");
    });
    await waitFor(() => expect(result.current[0]).toBe("valueA"));

    // 切 key → 立即重置为 default（不残留 kA 的值），并对 kB 发起加载
    rerender({ k: "kB" });
    expect(result.current[0]).toBe("default");
    // kvGet 对 kB 再次被调用
    expect(h.adapter.kvGet).toHaveBeenLastCalledWith("kB");

    await act(async () => {
      h.resolveNext("valueB");
    });
    await waitFor(() => expect(result.current[0]).toBe("valueB"));
  });
});
