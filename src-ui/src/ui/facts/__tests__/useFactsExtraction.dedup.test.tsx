// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useFactsExtraction（Facts 页范围提取）半成功去重（对抗审发现 1）判别性测试。
 *
 * 范围提取跨多章，批量落库中途抛错时，已落盘的候选必须登记，重试只补余下——
 * 否则重试把已存条重新落一遍 = 重复剧情笔记。回退到「不消费 PartialAddFactsError.writtenIndices」
 * 会让重试携全部候选 → 判别断言挂。
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskEvent } from "@ficforge/engine";

vi.mock("../../../hooks/useFeedback", () => ({
  useFeedback: () => ({ showError: vi.fn(), showSuccess: vi.fn(), showToast: vi.fn() }),
}));

// 捕获 subscribeToTask 注册的事件回调，供测试手动派发 completed 事件。
let eventCb: ((id: string, event: TaskEvent) => void) | null = null;
const taskRunnerStub = {
  onEvent: vi.fn((cb: (id: string, event: TaskEvent) => void) => { eventCb = cb; return () => {}; }),
  getActiveTasks: vi.fn(() => []),
  getCompletedTasks: vi.fn(() => []),
  removeCompleted: vi.fn(),
  cancel: vi.fn(),
};

vi.mock("../../../api/engine-client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/engine-client")>(
    "../../../api/engine-client",
  );
  return {
    ...actual,
    getEngine: vi.fn(() => ({ taskRunner: taskRunnerStub })),
    submitFactsExtraction: vi.fn(async () => "task-1"),
    addFactsBatch: vi.fn(),
    extractedEnrichment: vi.fn(() => ({})),
  };
});

import * as engineClient from "../../../api/engine-client";
import { PartialAddFactsError, type BatchFactInput } from "../../../api/engine-client";
import { useFactsExtraction } from "../useFactsExtraction";

const mocked = vi.mocked(engineClient);
const AU = "/data/fandoms/F/aus/A1";

function candidate(chapter: number, content: string) {
  return {
    content_raw: content, content_clean: content, characters: [],
    fact_type: "plot_event", narrative_weight: "medium", status: "active", chapter,
  } as unknown as import("../../../api/engine-client").ExtractedFactCandidate;
}

function batchInputsOfCall(call: number): BatchFactInput[] {
  return mocked.addFactsBatch.mock.calls[call][1] as BatchFactInput[];
}

describe("useFactsExtraction 半成功去重（发现 1）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventCb = null;
    mocked.extractedEnrichment.mockReturnValue({});
  });

  it("首轮批量半成功 → 重试只补未存候选，不重复落库", async () => {
    const onSaved = vi.fn(async () => {});
    const { result } = renderHook(() => useFactsExtraction(AU, { current_chapter: 4 } as never, onSaved));

    // 触发一轮范围提取并让其「完成」，派发 3 个跨章候选（自动全选）。
    act(() => { result.current.setExtractRange([1, 3]); });
    await act(async () => { await result.current.handleExtractConfirm(); });
    act(() => {
      eventCb?.("task-1", {
        type: "completed",
        result: { facts: [candidate(1, "甲"), candidate(2, "乙"), candidate(3, "丙")] },
      } as unknown as TaskEvent);
    });
    await waitFor(() => expect(result.current.extractModalOpen).toBe(true));

    // 首轮：批量写入下标 0（甲）后抛错 → PartialAddFactsError(writtenIndices=[0])。
    mocked.addFactsBatch.mockRejectedValueOnce(new PartialAddFactsError([0], new Error("disk full")));
    await act(async () => { await result.current.handleSaveExtracted(); });
    expect(mocked.addFactsBatch).toHaveBeenCalledTimes(1);
    expect(batchInputsOfCall(0)).toHaveLength(3); // 首轮传全部 3 条
    expect(result.current.extractModalOpen).toBe(true); // 半成功 → modal 不关

    // 重试：甲已登记 → pending 只剩乙、丙 → 批量只传 2 条。
    mocked.addFactsBatch.mockResolvedValueOnce({ added: 2, skipped: 0, writtenIndices: [0, 1] });
    await act(async () => { await result.current.handleSaveExtracted(); });
    expect(mocked.addFactsBatch).toHaveBeenCalledTimes(2);
    const retried = batchInputsOfCall(1).map((i) => (i.data as { content_clean: string }).content_clean);
    // 关键判别：重试不含甲（否则重复落库）
    expect(retried).toEqual(expect.arrayContaining(["乙", "丙"]));
    expect(retried).not.toContain("甲");
    expect(result.current.extractModalOpen).toBe(false); // 全部落库 → 关闭
  });
});
