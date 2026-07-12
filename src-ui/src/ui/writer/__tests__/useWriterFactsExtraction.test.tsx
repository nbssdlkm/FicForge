// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useWriterFactsExtraction — 笔记归属（审计⑧）。
 *
 * 提取是对单章 lastConfirmedChapter 跑的，所有候选都归该章。归属必须用这个确定章号，
 * 而不是 LLM 候选里可能幻觉的 candidate.chapter —— 否则笔记会错挂到别的章，
 * 污染 archival「距当前章距离」判据与时间线。对齐 backfill 的「不信任 LLM chapter」口径。
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../hooks/useFeedback", () => ({
  useFeedback: () => ({ showError: vi.fn(), showSuccess: vi.fn(), showToast: vi.fn() }),
}));

vi.mock("../../../api/engine-client", async () => {
  const actual = await vi.importActual<typeof import("../../../api/engine-client")>("../../../api/engine-client");
  return {
    ...actual,
    extractFacts: vi.fn(),
    addFactsBatch: vi.fn(),
    extractedEnrichment: vi.fn(() => ({})),
  };
});

import * as engineClient from "../../../api/engine-client";
import { PartialAddFactsError, type BatchFactInput } from "../../../api/engine-client";
import { useWriterFactsExtraction } from "../useWriterFactsExtraction";

const mocked = vi.mocked(engineClient);
const AU = "/data/fandoms/F/aus/A1";

/** 从 addFactsBatch 的某次调用取回传入的 BatchFactInput[]（第二参）。 */
function batchInputsOfCall(call: number): BatchFactInput[] {
  return mocked.addFactsBatch.mock.calls[call][1] as BatchFactInput[];
}

describe("useWriterFactsExtraction 笔记归属（审计⑧）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.extractedEnrichment.mockReturnValue({});
    mocked.addFactsBatch.mockResolvedValue({ added: 1, skipped: 0, writtenIndices: [0] });
  });

  it("归属用提取所处理的确定章号（12），忽略 candidate.chapter 里的幻觉章号（3）", async () => {
    // 提取自第 12 章，但 LLM 给某候选幻觉了 chapter=3
    mocked.extractFacts.mockResolvedValue({
      facts: [
        {
          content_raw: "r",
          content_clean: "主角觉醒",
          characters: [],
          fact_type: "plot_event",
          narrative_weight: "high",
          status: "active",
          chapter: 3,
        },
      ],
    } as unknown as Awaited<ReturnType<typeof engineClient.extractFacts>>);

    const { result } = renderHook(() => useWriterFactsExtraction(AU));

    await act(async () => {
      await result.current.handleOpenExtractReview(12);
    });

    // 展示一致性：候选被规范化到提取章 12（ExtractReviewModal 展示的来源章不再是幻觉 3）
    expect(result.current.extractedCandidates[0].chapter).toBe(12);

    await act(async () => {
      await result.current.handleSaveExtracted(12);
    });

    expect(mocked.addFactsBatch).toHaveBeenCalledTimes(1);
    // 单锁批量：整批一次调用；归属为提取章 12，而不是候选里的幻觉 3
    const inputs = batchInputsOfCall(0);
    expect(inputs).toHaveLength(1);
    expect(inputs[0].chapterNum).toBe(12);
    expect(inputs[0].data).toEqual(expect.objectContaining({ content_clean: "主角觉醒" }));
  });

  it("M25: 半成功重试不重复落库 —— 首轮批量写到第 2 条抛错，重试只补剩余，不重存前面已存的", async () => {
    mocked.extractFacts.mockResolvedValue({
      facts: [
        {
          content_raw: "r1",
          content_clean: "候选甲",
          characters: [],
          fact_type: "plot_event",
          narrative_weight: "high",
          status: "active",
          chapter: 5,
        },
        {
          content_raw: "r2",
          content_clean: "候选乙",
          characters: [],
          fact_type: "plot_event",
          narrative_weight: "high",
          status: "active",
          chapter: 5,
        },
        {
          content_raw: "r3",
          content_clean: "候选丙",
          characters: [],
          fact_type: "plot_event",
          narrative_weight: "high",
          status: "active",
          chapter: 5,
        },
      ],
    } as unknown as Awaited<ReturnType<typeof engineClient.extractFacts>>);

    const { result } = renderHook(() => useWriterFactsExtraction(AU));
    await act(async () => {
      await result.current.handleOpenExtractReview(5);
    });

    // 首轮：批量写入第 1 条成功后第 2 条抛错 → PartialAddFactsError(writtenIndices=[0])，只存了甲，
    // modal 保持打开、候选不清。
    mocked.addFactsBatch.mockRejectedValueOnce(new PartialAddFactsError([0], new Error("disk full")));
    await act(async () => {
      await result.current.handleSaveExtracted(5);
    });
    expect(mocked.addFactsBatch).toHaveBeenCalledTimes(1);
    // 首轮批量传入 3 条候选
    expect(batchInputsOfCall(0)).toHaveLength(3);
    expect(result.current.isExtractReviewOpen).toBe(true); // 半成功 → modal 不关
    expect(result.current.extractedCandidates).toHaveLength(3); // 候选原封不动

    // 重试：甲已登记 → pending 只剩乙、丙 → 批量只传 2 条。
    mocked.addFactsBatch.mockResolvedValueOnce({ added: 2, skipped: 0, writtenIndices: [0, 1] });
    await act(async () => {
      await result.current.handleSaveExtracted(5);
    });
    expect(mocked.addFactsBatch).toHaveBeenCalledTimes(2);
    // 关键判别：重试的批量只含乙、丙，甲不重存 —— 回退逐条旧码会重存甲。
    const retriedContents = batchInputsOfCall(1).map((i) => (i.data as { content_clean: string }).content_clean);
    expect(retriedContents).toEqual(expect.arrayContaining(["候选乙", "候选丙"]));
    expect(retriedContents).not.toContain("候选甲");
    expect(result.current.isExtractReviewOpen).toBe(false); // 全部落库 → 关闭
  });

  it("目标章被并发 undo 撤销（batch skipped）→ 不假报成功、清理并关闭", async () => {
    mocked.extractFacts.mockResolvedValue({
      facts: [
        {
          content_raw: "r",
          content_clean: "会被撤销的笔记",
          characters: [],
          fact_type: "plot_event",
          narrative_weight: "high",
          status: "active",
          chapter: 7,
        },
      ],
    } as unknown as Awaited<ReturnType<typeof engineClient.extractFacts>>);

    const { result } = renderHook(() => useWriterFactsExtraction(AU));
    await act(async () => {
      await result.current.handleOpenExtractReview(7);
    });
    // 批量返回 added=0 + skipped=1（章 7 被并发 undo 删）
    mocked.addFactsBatch.mockResolvedValueOnce({ added: 0, skipped: 1, writtenIndices: [] });
    await act(async () => {
      await result.current.handleSaveExtracted(7);
    });
    expect(mocked.addFactsBatch).toHaveBeenCalledTimes(1);
    // 未写任何笔记但流程干净收尾（modal 关、候选清）
    expect(result.current.isExtractReviewOpen).toBe(false);
    expect(result.current.extractedCandidates).toHaveLength(0);
  });
});
