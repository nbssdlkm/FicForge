// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useWriterChapterActions — undo in-flight 防重入（审计 M24）。
 *
 * undo 是 10 步级联回滚。旧代码进 handleUndoConfirmed 就先关弹窗、再 await，期间弹窗
 * confirm 按钮未 disabled，快速双击 / 关闭前的第二次点击能并发进入第二次回滚，多撤一章。
 * 修复：isUndoing 在飞标志 + 早退保护 + 成功后才关弹窗（弹窗侧接 loading）。
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/engine-client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/engine-client")>(
    "../../../api/engine-client",
  );
  return { ...actual, undoChapter: vi.fn(), confirmChapter: vi.fn(), deleteDrafts: vi.fn() };
});

import * as engineClient from "../../../api/engine-client";
import { useWriterChapterActions } from "../useWriterChapterActions";
import { useActiveRequestGuard } from "../../../hooks/useActiveRequestGuard";

const mocked = vi.mocked(engineClient);
const AU = "/data/fandoms/F/aus/A1";

function makeOptions(overrides: Partial<Parameters<typeof useWriterChapterActions>[0]> = {}) {
  const noop = () => {};
  return {
    auPath: AU,
    state: { current_chapter: 3 } as never,
    drafts: [] as never,
    activeDraftIndex: 0,
    chapterTitle: "",
    focusSelection: [] as string[],
    skipFactsPrompt: true,
    loadGuard: undefined as never, // 由 renderHook 内注入真 guard
    clearDraftState: noop,
    replaceDraftSummaries: noop,
    loadData: async () => {},
    focusInstructionInput: noop,
    onChaptersChanged: noop,
    onCloseFinalizeConfirm: noop,
    onCloseDiscardConfirm: noop,
    onCloseUndoConfirm: vi.fn(),
    onOpenFactsPrompt: noop,
    showSuccess: noop,
    showToast: noop,
    showError: noop,
    t: (k: string) => k,
    ...overrides,
  };
}

describe("useWriterChapterActions undo 防重入（M24）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("undo 在飞时第二次调用被早退拦下 → undoChapter 只调一次", async () => {
    // undoChapter 挂起直到手动放行，制造"在飞"窗口。
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    mocked.undoChapter.mockImplementation(async () => { await gate; });

    const onCloseUndoConfirm = vi.fn();
    const { result } = renderHook(() => {
      const loadGuard = useActiveRequestGuard(AU);
      return useWriterChapterActions(makeOptions({ loadGuard, onCloseUndoConfirm }));
    });

    // 并发触发两次（模拟双击）。第一次占标志，第二次应早退。
    let p1!: Promise<void>;
    let p2!: Promise<void>;
    await act(async () => {
      p1 = result.current.handleUndoConfirmed();
      p2 = result.current.handleUndoConfirmed();
      await Promise.resolve();
    });

    // 在飞状态置起
    expect(result.current.isUndoing).toBe(true);
    // 关键判别：undoChapter 只被调一次（回退旧码 = 两次并发回滚）
    expect(mocked.undoChapter).toHaveBeenCalledTimes(1);

    await act(async () => {
      release();
      await Promise.all([p1, p2]);
    });

    // 收尾：标志复位、弹窗只在成功路径关一次
    expect(result.current.isUndoing).toBe(false);
    expect(onCloseUndoConfirm).toHaveBeenCalledTimes(1);
  });

  it("undo 成功后才关弹窗（成功前弹窗保持打开，配合 loading 锁按钮）", async () => {
    mocked.undoChapter.mockResolvedValue(undefined as never);
    const onCloseUndoConfirm = vi.fn();
    const { result } = renderHook(() => {
      const loadGuard = useActiveRequestGuard(AU);
      return useWriterChapterActions(makeOptions({ loadGuard, onCloseUndoConfirm }));
    });

    await act(async () => {
      await result.current.handleUndoConfirmed();
    });

    expect(mocked.undoChapter).toHaveBeenCalledTimes(1);
    expect(onCloseUndoConfirm).toHaveBeenCalledTimes(1);
    expect(result.current.isUndoing).toBe(false);
  });
});
