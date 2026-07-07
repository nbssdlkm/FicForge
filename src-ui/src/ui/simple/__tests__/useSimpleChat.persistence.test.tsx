// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * C2 持久化集成测试：useSimpleChat ↔ engine simpleChat repo。
 * 用真实 timer + waitFor，避免 fake timer 与 promise microtask 的死锁。
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/engine-client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/engine-client")>(
    "../../../api/engine-client",
  );
  return {
    ...actual,
    getSimpleChat: vi.fn(),
    saveSimpleChat: vi.fn(),
  };
});

import * as engineClient from "../../../api/engine-client";
import { useSimpleChat } from "../useSimpleChat";

const mockedGet = vi.mocked(engineClient.getSimpleChat);
const mockedSave = vi.mocked(engineClient.saveSimpleChat);

function emptyChatFile(auPath: string) {
  return {
    version: 1,
    au_path: auPath,
    created_at: "2026-05-03T10:00:00Z",
    updated_at: "2026-05-03T10:00:00Z",
    messages: [],
  };
}

async function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

describe("useSimpleChat persistence (C2)", () => {
  beforeEach(() => {
    mockedGet.mockReset();
    mockedSave.mockReset();
  });

  it("初始 isLoaded=false，load 完成后转 true", async () => {
    mockedGet.mockResolvedValue(emptyChatFile("au_a"));
    const { result } = renderHook(() => useSimpleChat("au_a"));

    expect(result.current.isLoaded).toBe(false);
    expect(mockedGet).toHaveBeenCalledWith("au_a");

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.messages).toEqual([]);
    expect(result.current.loadError).toBeNull();
  });

  it("load 返回历史消息，hook 内即可见", async () => {
    mockedGet.mockResolvedValue({
      version: 1,
      au_path: "au_b",
      created_at: "t",
      updated_at: "t",
      messages: [
        { id: "smplmsg-1", timestamp: "t1", kind: "user", content: "你好" },
        { id: "smplmsg-2", timestamp: "t2", kind: "system", tone: "info", content: "AU 加载成功" },
      ],
    });

    const { result } = renderHook(() => useSimpleChat("au_b"));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({ kind: "user", content: "你好" });
  });

  it("append 后防抖触发 save", async () => {
    mockedGet.mockResolvedValue(emptyChatFile("au_s"));
    mockedSave.mockResolvedValue();

    const { result } = renderHook(() => useSimpleChat("au_s"));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => { result.current.appendUserMessage("first"); });
    expect(mockedSave).not.toHaveBeenCalled();

    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1), { timeout: 1000 });
    expect(mockedSave).toHaveBeenCalledWith(
      "au_s",
      expect.arrayContaining([expect.objectContaining({ kind: "user", content: "first" })]),
    );
  });

  it("连续 append 防抖合并：250ms 内只 save 一次", async () => {
    mockedGet.mockResolvedValue(emptyChatFile("au_d"));
    mockedSave.mockResolvedValue();

    const { result } = renderHook(() => useSimpleChat("au_d"));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => { result.current.appendUserMessage("a"); });
    await sleep(50);
    act(() => { result.current.appendUserMessage("b"); });
    await sleep(50);
    act(() => { result.current.appendUserMessage("c"); });
    await waitFor(() => expect(mockedSave).toHaveBeenCalledTimes(1), { timeout: 1000 });

    const lastCall = mockedSave.mock.calls[0];
    expect(lastCall[1]).toHaveLength(3);
  });

  it("load 失败设 loadError；hook 内存可写但**不自动 save**（防止用空 [] 覆盖磁盘）", async () => {
    mockedGet.mockRejectedValue(new Error("disk full"));
    mockedSave.mockResolvedValue();

    const { result } = renderHook(() => useSimpleChat("au_err"));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.loadError).toBe("disk full");

    act(() => { result.current.appendUserMessage("memory-only after load fail"); });
    // 等过 debounce 200ms 看是否 fire
    await sleep(400);
    expect(mockedSave).not.toHaveBeenCalled();
    // messages 仍在内存
    expect(result.current.messages).toHaveLength(1);
  });

  it("save 失败静默吞掉", async () => {
    mockedGet.mockResolvedValue(emptyChatFile("au_savefail"));
    mockedSave.mockRejectedValue(new Error("readonly fs"));

    const { result } = renderHook(() => useSimpleChat("au_savefail"));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => { result.current.appendUserMessage("x"); });
    await waitFor(() => expect(mockedSave).toHaveBeenCalled(), { timeout: 1000 });
    // hook state 没破坏
    expect(result.current.messages).toHaveLength(1);
  });

  it("卸载 flush：防抖窗口内的最后一笔变更在 unmount 时立即落盘（审计 H3）", async () => {
    mockedGet.mockResolvedValue(emptyChatFile("au_flush"));
    mockedSave.mockResolvedValue();

    const { result, unmount } = renderHook(() => useSimpleChat("au_flush"));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => { result.current.appendUserMessage("last-words"); });
    // 还在 200ms 防抖窗口内，正常路径尚未 save
    expect(mockedSave).not.toHaveBeenCalled();

    unmount();
    // 回退旧码（cleanup 只 clearTimeout）此处必挂：变更被静默丢弃
    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(mockedSave).toHaveBeenCalledWith(
      "au_flush",
      expect.arrayContaining([expect.objectContaining({ kind: "user", content: "last-words" })]),
    );
  });

  it("AU 切换 flush：未落盘变更写到旧 AU，不串到新 AU", async () => {
    mockedGet.mockResolvedValue(emptyChatFile("au_1"));
    mockedSave.mockResolvedValue();

    const { result, rerender } = renderHook(({ au }) => useSimpleChat(au), {
      initialProps: { au: "au_1" },
    });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => { result.current.appendUserMessage("for-au-1"); });
    rerender({ au: "au_2" });

    expect(mockedSave).toHaveBeenCalledWith(
      "au_1",
      expect.arrayContaining([expect.objectContaining({ content: "for-au-1" })]),
    );
    // 新 AU 不应收到旧 AU 的消息
    expect(mockedSave).not.toHaveBeenCalledWith(
      "au_2",
      expect.arrayContaining([expect.objectContaining({ content: "for-au-1" })]),
    );
  });

  it("无未落盘变更时卸载不触发写入（load 内容不被原样重写）", async () => {
    mockedGet.mockResolvedValue({
      version: 1, au_path: "au_clean", created_at: "t", updated_at: "t",
      messages: [{ id: "m1", timestamp: "t", kind: "user", content: "existing" }],
    });
    mockedSave.mockResolvedValue();

    const { result, unmount } = renderHook(() => useSimpleChat("au_clean"));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    // 静置超过防抖窗口：load 后没有任何变更，防抖也不应 fire
    await sleep(300);
    unmount();

    expect(mockedSave).not.toHaveBeenCalled();
  });

  it("load 失败时卸载 flush 同样禁写（沿用防空覆盖口径）", async () => {
    mockedGet.mockRejectedValue(new Error("disk full"));
    mockedSave.mockResolvedValue();

    const { result, unmount } = renderHook(() => useSimpleChat("au_errflush"));
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    act(() => { result.current.appendUserMessage("memory-only"); });
    unmount();

    expect(mockedSave).not.toHaveBeenCalled();
  });

  it("AU 快速切换：旧 load resolve 不会污染新 AU 的 state", async () => {
    let resolveOld: (file: ReturnType<typeof emptyChatFile>) => void = () => {};
    mockedGet.mockImplementationOnce(() => new Promise((r) => { resolveOld = r; }));
    mockedGet.mockResolvedValueOnce({
      version: 1, au_path: "au_new", created_at: "t", updated_at: "t",
      messages: [{ id: "newmsg", timestamp: "t", kind: "user", content: "fresh" }],
    });
    mockedSave.mockResolvedValue();

    const { result, rerender } = renderHook(({ au }) => useSimpleChat(au), {
      initialProps: { au: "au_old" },
    });
    expect(result.current.isLoaded).toBe(false);

    rerender({ au: "au_new" });
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: "newmsg" }),
    ]);

    // 旧 load 现在 resolve，不应覆盖新 AU
    await act(async () => {
      resolveOld({
        version: 1, au_path: "au_old", created_at: "t", updated_at: "t",
        messages: [{ id: "stale", timestamp: "t", kind: "user", content: "stale" }],
      });
      await sleep(20);
    });
    expect(result.current.messages.find((m) => m.id === "stale")).toBeUndefined();
  });
});
