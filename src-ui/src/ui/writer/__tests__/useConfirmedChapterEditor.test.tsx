// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useConfirmedChapterEditor 测试（盲审长期债③：已定稿章「查看历史 + 原地编辑」
 * 是用户正文的破坏性写路径，此前零测试）。
 *
 * 重点失败路径：保存失败必须保留编辑态（用户改动不丢）、历史章加载失败清空
 * 查看态、非法 viewChapter（>= 当前章）不发请求。
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useConfirmedChapterEditor } from "../useConfirmedChapterEditor";
import {
  getChapterContent,
  getState,
  updateChapterContent,
  type StateInfo,
} from "../../../api/engine-client";

vi.mock("../../../api/engine-client", () => ({
  getChapterContent: vi.fn(),
  getState: vi.fn(),
  updateChapterContent: vi.fn(),
}));

const AU = "/data/fandoms/F/aus/A1";
const STATE = { au_id: "a1", current_chapter: 5 } as unknown as StateInfo;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(overrides: Partial<Parameters<typeof useConfirmedChapterEditor>[0]> = {}) {
  const callbacks = {
    onClearViewChapter: vi.fn(),
    onStateChange: vi.fn(),
    onDirtyBannerReset: vi.fn(),
    onShowSuccess: vi.fn(),
    onShowError: vi.fn(),
  };
  const hook = renderHook(
    (props: Partial<Parameters<typeof useConfirmedChapterEditor>[0]>) =>
      useConfirmedChapterEditor({
        auPath: AU,
        viewChapter: null,
        state: STATE,
        fallbackContent: "",
        t: (key: string) => key,
        ...callbacks,
        ...overrides,
        ...props,
      }),
    { initialProps: {} },
  );
  return { hook, ...callbacks };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getChapterContent).mockResolvedValue("第三章正文" as never);
  vi.mocked(getState).mockResolvedValue(STATE);
  vi.mocked(updateChapterContent).mockResolvedValue(undefined as never);
});

describe("useConfirmedChapterEditor · 历史章查看", () => {
  it("viewChapter < current_chapter：拉取正文进入查看态", async () => {
    const { hook } = setup({ viewChapter: 3 });

    await waitFor(() => expect(hook.result.current.isViewingHistory).toBe(true));
    expect(getChapterContent).toHaveBeenCalledWith(AU, 3);
    expect(hook.result.current.viewingHistoryContent).toBe("第三章正文");
    expect(hook.result.current.viewingHistoryNum).toBe(3);
  });

  it("对象形返回（{content}）也能取到正文", async () => {
    vi.mocked(getChapterContent).mockResolvedValue({ content: "对象形正文" } as never);
    const { hook } = setup({ viewChapter: 3 });

    await waitFor(() => expect(hook.result.current.viewingHistoryContent).toBe("对象形正文"));
  });

  it("viewChapter >= current_chapter：不发请求、查看态保持空", async () => {
    const { hook } = setup({ viewChapter: 5 });

    expect(getChapterContent).not.toHaveBeenCalled();
    expect(hook.result.current.isViewingHistory).toBe(false);
  });

  it("正文加载失败：已建立的查看态被清空，不留上一章的陈旧内容/章号", async () => {
    // 对抗审 LOW：断言不能锚在初始 null（那样删掉 catch 整段也恒绿）。
    // 先成功查看第 3 章建立非空态，再切到会失败的第 2 章，断言从非空清到空。
    vi.mocked(getChapterContent).mockImplementation(async (_au: string, num: number) => {
      if (num === 2) throw new Error("ENOENT");
      return "第三章正文" as never;
    });
    const { hook } = setup({ viewChapter: 3 });
    await waitFor(() => expect(hook.result.current.viewingHistoryNum).toBe(3));

    hook.rerender({ viewChapter: 2 });

    await waitFor(() => expect(hook.result.current.viewingHistoryContent).toBeNull());
    expect(hook.result.current.viewingHistoryNum).toBeNull();
    expect(hook.result.current.isViewingHistory).toBe(false);
  });

  it("切章竞态：前一章的迟到响应被 cancelled 守卫丢弃，不覆盖当前章", async () => {
    const slow3 = deferred<string>();
    vi.mocked(getChapterContent).mockImplementation((_au: string, num: number) => {
      if (num === 3) return slow3.promise as never;
      return Promise.resolve("第二章正文") as never;
    });
    const { hook } = setup({ viewChapter: 3 });

    // 第 3 章还挂着 → 切到第 2 章；第 2 章先落位
    hook.rerender({ viewChapter: 2 });
    await waitFor(() => expect(hook.result.current.viewingHistoryNum).toBe(2));

    // 第 3 章此刻才到：effect 已 cleanup，必须整体丢弃
    await act(async () => {
      slow3.resolve("第三章迟到正文");
    });
    expect(hook.result.current.viewingHistoryNum).toBe(2);
    expect(hook.result.current.viewingHistoryContent).toBe("第二章正文");
  });

  it("clearHistoryView：清空查看态并回调 onClearViewChapter", async () => {
    const { hook, onClearViewChapter } = setup({ viewChapter: 3 });
    await waitFor(() => expect(hook.result.current.isViewingHistory).toBe(true));

    act(() => hook.result.current.clearHistoryView());

    expect(hook.result.current.isViewingHistory).toBe(false);
    expect(onClearViewChapter).toHaveBeenCalledTimes(1);
  });
});

describe("useConfirmedChapterEditor · 编辑与保存", () => {
  it("startEditingConfirmed：无任何内容源时 no-op", () => {
    const { hook } = setup();
    act(() => hook.result.current.startEditingConfirmed());
    expect(hook.result.current.editingConfirmed).toBe(false);
  });

  it("startEditingConfirmed：以历史章正文为编辑起点；cancel 全部还原", async () => {
    const { hook } = setup({ viewChapter: 3 });
    await waitFor(() => expect(hook.result.current.isViewingHistory).toBe(true));

    act(() => hook.result.current.startEditingConfirmed());
    expect(hook.result.current.editingConfirmed).toBe(true);
    expect(hook.result.current.editingContent).toBe("第三章正文");
    expect(hook.result.current.editingOriginalContent).toBe("第三章正文");

    act(() => hook.result.current.cancelEditingConfirmed());
    expect(hook.result.current.editingConfirmed).toBe(false);
    expect(hook.result.current.editingContent).toBe("");
  });

  it("保存成功：落盘 → 刷 state → 展示新正文 → 退出编辑态 + 成功提示", async () => {
    const newState = { au_id: "a1", current_chapter: 5 } as unknown as StateInfo;
    vi.mocked(getState).mockResolvedValue(newState);
    const { hook, onStateChange, onDirtyBannerReset, onShowSuccess } = setup({ viewChapter: 3 });
    await waitFor(() => expect(hook.result.current.isViewingHistory).toBe(true));

    act(() => hook.result.current.startEditingConfirmed());
    act(() => hook.result.current.setEditingContent("改写后的第三章"));
    await act(() => hook.result.current.saveEditingConfirmed());

    expect(updateChapterContent).toHaveBeenCalledWith(AU, 3, "改写后的第三章");
    expect(onStateChange).toHaveBeenCalledWith(newState);
    expect(onDirtyBannerReset).toHaveBeenCalledTimes(1);
    expect(onShowSuccess).toHaveBeenCalledWith("writer.editSaveSuccess");
    expect(hook.result.current.viewingHistoryContent).toBe("改写后的第三章");
    expect(hook.result.current.editingConfirmed).toBe(false);
    expect(hook.result.current.savingEdit).toBe(false);
  });

  it("保存失败：onShowError 触发、编辑态与用户改动保留（可重试）、saving 复位", async () => {
    vi.mocked(updateChapterContent).mockRejectedValue(new Error("EACCES"));
    const { hook, onShowError, onStateChange } = setup({ viewChapter: 3 });
    await waitFor(() => expect(hook.result.current.isViewingHistory).toBe(true));

    act(() => hook.result.current.startEditingConfirmed());
    act(() => hook.result.current.setEditingContent("会失败的改动"));
    await act(() => hook.result.current.saveEditingConfirmed());

    expect(onShowError).toHaveBeenCalledWith(expect.objectContaining({ message: "EACCES" }), "error_messages.unknown");
    expect(onStateChange).not.toHaveBeenCalled();
    // 用户改动必须还在
    expect(hook.result.current.editingConfirmed).toBe(true);
    expect(hook.result.current.editingContent).toBe("会失败的改动");
    expect(hook.result.current.savingEdit).toBe(false);
  });

  it("未在查看历史章（viewingHistoryNum=null）：保存 no-op 不落盘", async () => {
    const { hook } = setup({ fallbackContent: "最新章内容" });

    act(() => hook.result.current.startEditingConfirmed());
    expect(hook.result.current.editingConfirmed).toBe(true);

    await act(() => hook.result.current.saveEditingConfirmed());
    expect(updateChapterContent).not.toHaveBeenCalled();
  });
});
