// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useFontManager — TD-011 回归测试。
 *
 * 核心不变量：下载进度的真相源在 FontsService 单例，而非组件 state。
 * 因此进度条能跨 Modal 生命周期存活 —— 下载中关闭再打开设置 Modal，重新挂载的
 * hook 先用 currentProgresses() 播种、再订阅增量，进度不丢、状态正确收敛。
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FontError, type FontDownloadEvent } from "@ficforge/engine";

// 一个真实存在于 manifest 的 downloadable 字体 id（getFontById 可解析）。
const DOWNLOADABLE_ID = "lxgw-wenkai-gb";

// 假 FontsService：用可控的 listener 集 + 可变 progresses/statuses 模拟单例。
const h = vi.hoisted(() => {
  type Progress = { loaded: number; total: number };
  const listeners = new Set<(event: FontDownloadEvent) => void>();
  const state: {
    progresses: Record<string, Progress>;
    statuses: Record<string, string>;
    totalSize: number;
    installImpl: ((id: string) => Promise<void>) | null;
  } = { progresses: {}, statuses: {}, totalSize: 0, installImpl: null };

  const fakeService = {
    statusOf: async (id: string) => state.statuses[id] ?? "not-installed",
    isDownloading: (id: string) => id in state.progresses,
    install: async (id: string) => {
      if (state.installImpl) await state.installImpl(id);
    },
    uninstall: async () => {},
    totalStorageSize: async () => state.totalSize,
    currentProgresses: () => ({ ...state.progresses }),
    subscribeDownloads: (listener: (event: FontDownloadEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  // 模拟 service 侧广播：先更新真相源，再通知订阅者（与真 service 顺序一致）。
  const emit = (event: FontDownloadEvent) => {
    if (event.type === "progress") state.progresses[event.id] = event.progress;
    else delete state.progresses[event.id];
    for (const listener of [...listeners]) listener(event);
  };

  return { fakeService, emit, state, listeners };
});

vi.mock("../../api/engine-fonts", () => ({
  getFontsService: () => h.fakeService,
}));

import { useFontManager } from "../useFontManager";

beforeEach(() => {
  h.state.progresses = {};
  h.state.statuses = {};
  h.state.totalSize = 0;
  h.state.installImpl = null;
  h.listeners.clear();
});

describe("useFontManager — progress persistence (TD-011)", () => {
  it("seeds in-flight progress from the service on mount (survives remount)", async () => {
    // 上一个 Modal 生命周期发起、仍在后台进行的下载。
    h.state.progresses[DOWNLOADABLE_ID] = { loaded: 5, total: 10 };

    const { result } = renderHook(() => useFontManager());

    // mount 即从 service 播种，无需等任何事件。
    await waitFor(() =>
      expect(result.current.progresses[DOWNLOADABLE_ID]).toEqual({ loaded: 5, total: 10 }),
    );
  });

  it("updates progress live from subscription events", async () => {
    const { result } = renderHook(() => useFontManager());
    await waitFor(() => expect(h.listeners.size).toBe(1));

    act(() => {
      h.emit({ type: "progress", id: DOWNLOADABLE_ID, progress: { loaded: 3, total: 12 } });
    });
    expect(result.current.progresses[DOWNLOADABLE_ID]).toEqual({ loaded: 3, total: 12 });

    act(() => {
      h.emit({ type: "progress", id: DOWNLOADABLE_ID, progress: { loaded: 8, total: 12 } });
    });
    expect(result.current.progresses[DOWNLOADABLE_ID]).toEqual({ loaded: 8, total: 12 });
  });

  it("clears progress and re-derives status when a background download settles", async () => {
    h.state.progresses[DOWNLOADABLE_ID] = { loaded: 6, total: 6 };
    const { result } = renderHook(() => useFontManager());
    await waitFor(() =>
      expect(result.current.progresses[DOWNLOADABLE_ID]).toBeDefined(),
    );

    // 后台下载完成 → service 状态翻转。
    h.state.statuses[DOWNLOADABLE_ID] = "installed";
    h.state.totalSize = 1234;
    act(() => {
      h.emit({ type: "settled", id: DOWNLOADABLE_ID });
    });

    await waitFor(() => {
      expect(result.current.progresses[DOWNLOADABLE_ID]).toBeUndefined();
      expect(result.current.statuses[DOWNLOADABLE_ID]).toBe("installed");
    });
    expect(result.current.totalSize).toBe(1234);
  });

  it("unsubscribes from the service on unmount", async () => {
    const { unmount } = renderHook(() => useFontManager());
    await waitFor(() => expect(h.listeners.size).toBe(1));

    unmount();
    expect(h.listeners.size).toBe(0);
  });

  it("cancelling a download (abort) returns to not-installed with no error, not 'error'", async () => {
    h.state.installImpl = async () => {
      throw new FontError("aborted", `Download aborted: ${DOWNLOADABLE_ID}`);
    };
    const { result } = renderHook(() => useFontManager());

    await act(async () => {
      await result.current.download(DOWNLOADABLE_ID);
    });

    expect(result.current.statuses[DOWNLOADABLE_ID]).toBe("not-installed");
    expect(result.current.errors[DOWNLOADABLE_ID]).toBeUndefined();
  });

  it("a settle-triggered refresh does NOT clobber an existing 'error' status", async () => {
    // A genuine (non-abort) failure puts the font in "error".
    h.state.installImpl = async () => {
      throw new FontError("network", "boom");
    };
    const { result } = renderHook(() => useFontManager());
    await act(async () => {
      await result.current.download(DOWNLOADABLE_ID);
    });
    expect(result.current.statuses[DOWNLOADABLE_ID]).toBe("error");
    expect(result.current.errors[DOWNLOADABLE_ID]).toContain("boom");

    // A later 'settled' event triggers refresh(), which re-derives statuses from
    // statusOf() — which can only ever return not-installed for a failed font.
    // The error-preservation merge must keep the "error" status intact (TD-011).
    await act(async () => {
      h.emit({ type: "settled", id: DOWNLOADABLE_ID });
    });
    await waitFor(() => expect(h.listeners.size).toBe(1));
    expect(result.current.statuses[DOWNLOADABLE_ID]).toBe("error");
  });

  it("cross-modal: a download that settles while UNMOUNTED has its STATUS re-derived on the next mount (via refresh/statusOf, no live event)", async () => {
    // 注：本测试守的是「重挂载时靠 refresh()->statusOf() 重新推导状态」这条路径，
    // **不是** progress 播种（settled 后进度本就空，无从播种；in-flight 播种由上面那个测试守）。
    // 第一个 Modal 生命周期：挂载并订阅，然后关闭(卸载) → 订阅者消失
    const first = renderHook(() => useFontManager());
    await waitFor(() => expect(h.listeners.size).toBe(1));
    first.unmount();
    expect(h.listeners.size).toBe(0);

    // 后台在「无订阅者」时 settle：service 状态变 installed、进度清空（没有 listener 收到事件）
    h.state.statuses[DOWNLOADABLE_ID] = "installed";
    delete h.state.progresses[DOWNLOADABLE_ID];

    // 重开 Modal（全新 hook 实例）→ mount 的 refresh()->statusOf() 把状态重新推导成 installed，
    // 不依赖任何实时订阅事件。这是 TD-011 跨 Modal「状态最终一致」的核心路径。
    const second = renderHook(() => useFontManager());
    await waitFor(() => expect(second.result.current.statuses[DOWNLOADABLE_ID]).toBe("installed"));
    expect(second.result.current.progresses[DOWNLOADABLE_ID]).toBeUndefined();
  });
});
