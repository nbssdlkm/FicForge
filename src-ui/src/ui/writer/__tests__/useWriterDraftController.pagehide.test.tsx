// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useWriterDraftController — pagehide flush（R1-6）。
 *
 * 草稿手改走 1.5s 防抖保存；关标签页 / PWA 进后台被回收 / SW 更新刷新时组件 cleanup
 * 不保证执行，防抖窗口内的最后一笔会静默丢。判别契约：
 *   1. pagehide 事件 → 有未落盘草稿改动时立即 saveDraft
 *   2. 无未落盘改动时 pagehide 不写（有未落盘才写）
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/engine-client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/engine-client")>(
    "../../../api/engine-client",
  );
  return {
    ...actual,
    listDrafts: vi.fn(),
    getDraft: vi.fn(),
    saveDraft: vi.fn(),
  };
});

import * as engineClient from "../../../api/engine-client";
import { useWriterDraftController } from "../useWriterDraftController";
import type { StateInfo } from "../../../api/engine-client";

const mocked = vi.mocked(engineClient);
const AU = "/fandoms/F/aus/A";

const state = {
  au_id: AU,
  current_chapter: 1,
  chapter_focus: [],
  chapters_dirty: [],
  last_confirmed_chapter_focus: [],
  chapter_titles: {},
} as unknown as StateInfo;

function renderWithOneDraft() {
  mocked.listDrafts.mockResolvedValue([
    { draft_label: "a", chapter_num: 1, draft_id: "ch0001_draft_a.md" },
  ] as unknown as Awaited<ReturnType<typeof engineClient.listDrafts>>);
  mocked.getDraft.mockResolvedValue({
    variant: "a",
    content: "初稿内容",
    generated_with: null,
  } as unknown as Awaited<ReturnType<typeof engineClient.getDraft>>);
  mocked.saveDraft.mockResolvedValue(undefined as never);

  return renderHook(() => useWriterDraftController({ auPath: AU, state }));
}

describe("useWriterDraftController pagehide flush（R1-6）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("pagehide → 防抖窗口内的草稿改动立即落盘", async () => {
    const { result } = renderWithOneDraft();
    await waitFor(() => expect(result.current.drafts).toHaveLength(1));

    act(() => {
      result.current.handleCurrentDraftChange("用户手改后的内容");
    });
    // 还在 1.5s 防抖窗口内，正常路径尚未 save
    expect(mocked.saveDraft).not.toHaveBeenCalled();

    // 关标签页 / 进后台：cleanup 不保证执行，pagehide 兜底
    act(() => { window.dispatchEvent(new Event("pagehide")); });

    await waitFor(() => expect(mocked.saveDraft).toHaveBeenCalledTimes(1));
    expect(mocked.saveDraft).toHaveBeenCalledWith(AU, 1, "a", "用户手改后的内容");
  });

  it("pagehide → 无未落盘改动时不写（有未落盘才写）", async () => {
    const { result } = renderWithOneDraft();
    await waitFor(() => expect(result.current.drafts).toHaveLength(1));

    act(() => { window.dispatchEvent(new Event("pagehide")); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(mocked.saveDraft).not.toHaveBeenCalled();
  });
});
