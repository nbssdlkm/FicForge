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
  const actual = await vi.importActual<typeof import("../../../api/engine-client")>(
    "../../../api/engine-client",
  );
  return {
    ...actual,
    extractFacts: vi.fn(),
    addFact: vi.fn(),
    extractedEnrichment: vi.fn(() => ({})),
  };
});

import * as engineClient from "../../../api/engine-client";
import { useWriterFactsExtraction } from "../useWriterFactsExtraction";

const mocked = vi.mocked(engineClient);
const AU = "/data/fandoms/F/aus/A1";

describe("useWriterFactsExtraction 笔记归属（审计⑧）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.extractedEnrichment.mockReturnValue({});
    mocked.addFact.mockResolvedValue({ fact_id: "f1" } as unknown as never);
  });

  it("归属用提取所处理的确定章号（12），忽略 candidate.chapter 里的幻觉章号（3）", async () => {
    // 提取自第 12 章，但 LLM 给某候选幻觉了 chapter=3
    mocked.extractFacts.mockResolvedValue({
      facts: [
        {
          content_raw: "r", content_clean: "主角觉醒",
          characters: [], fact_type: "plot_event",
          narrative_weight: "high", status: "active", chapter: 3,
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

    expect(mocked.addFact).toHaveBeenCalledTimes(1);
    // 归属为提取章 12，而不是候选里的幻觉 3
    expect(mocked.addFact).toHaveBeenCalledWith(
      AU, 12, expect.objectContaining({ content_clean: "主角觉醒" }),
    );
  });

  it("M25: 半成功重试不重复落库 —— 首轮存到第 2 条抛错，重试只补剩余，不重存前面已存的", async () => {
    mocked.extractFacts.mockResolvedValue({
      facts: [
        { content_raw: "r1", content_clean: "候选甲", characters: [], fact_type: "plot_event", narrative_weight: "high", status: "active", chapter: 5 },
        { content_raw: "r2", content_clean: "候选乙", characters: [], fact_type: "plot_event", narrative_weight: "high", status: "active", chapter: 5 },
        { content_raw: "r3", content_clean: "候选丙", characters: [], fact_type: "plot_event", narrative_weight: "high", status: "active", chapter: 5 },
      ],
    } as unknown as Awaited<ReturnType<typeof engineClient.extractFacts>>);

    const { result } = renderHook(() => useWriterFactsExtraction(AU));
    await act(async () => {
      await result.current.handleOpenExtractReview(5);
    });

    // 首轮：第 1 条成功、第 2 条抛错 → 只存了甲，modal 保持打开、候选不清。
    mocked.addFact
      .mockResolvedValueOnce({ fact_id: "fa" } as unknown as never)
      .mockRejectedValueOnce(new Error("disk full"));
    await act(async () => {
      await result.current.handleSaveExtracted(5);
    });
    expect(mocked.addFact).toHaveBeenCalledTimes(2); // 甲成功 + 乙失败（丙未触达）
    expect(result.current.isExtractReviewOpen).toBe(true); // 半成功 → modal 不关
    expect(result.current.extractedCandidates).toHaveLength(3); // 候选原封不动

    // 重试：甲已登记 → 跳过；只补乙、丙。
    mocked.addFact.mockClear();
    mocked.addFact.mockResolvedValue({ fact_id: "ok" } as unknown as never);
    await act(async () => {
      await result.current.handleSaveExtracted(5);
    });
    // 关键判别：重试只调 2 次（乙+丙），甲不重存 —— 回退旧码会调 3 次（甲重复）。
    expect(mocked.addFact).toHaveBeenCalledTimes(2);
    const retriedContents = mocked.addFact.mock.calls.map((c) => (c[2] as { content_clean: string }).content_clean);
    expect(retriedContents).toEqual(expect.arrayContaining(["候选乙", "候选丙"]));
    expect(retriedContents).not.toContain("候选甲");
    expect(result.current.isExtractReviewOpen).toBe(false); // 全部落库 → 关闭
  });
});
