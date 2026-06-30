// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { BackfillSummaryModal } from "../BackfillSummaryModal";
import { FeedbackProvider } from "../../../hooks/useFeedback";

// 保留真实 engine-client（FeedbackProvider 依赖 ApiError 等），只覆盖补摘要这两个 api。
vi.mock("../../../api/engine-client", async (importActual) => {
  const actual = await importActual<any>();
  return {
    ...actual,
    countChaptersMissingSummary: vi.fn(),
    backfillChapterSummaries: vi.fn(),
  };
});

import { countChaptersMissingSummary, backfillChapterSummaries } from "../../../api/engine-client";

const baseAvail = {
  missingChapters: [1, 2, 3],
  totalConfirmed: 5,
  embeddingConfigured: true,
  llmConfigured: true,
};

function renderModal() {
  return render(
    <FeedbackProvider>
      <BackfillSummaryModal auPath="/au" isOpen onClose={() => {}} />
    </FeedbackProvider>,
  );
}

describe("BackfillSummaryModal", () => {
  beforeEach(() => {
    (countChaptersMissingSummary as Mock).mockReset();
    (backfillChapterSummaries as Mock).mockReset();
  });

  it("confirm phase: shows the missing count and a Start button when configured", async () => {
    (countChaptersMissingSummary as Mock).mockResolvedValue(baseAvail);
    renderModal();
    expect(await screen.findByText("发现 3 章还没有摘要。")).toBeTruthy();
    expect(screen.getByText("开始补全")).toBeTruthy();
  });

  it("blocks with a config hint when embedding/LLM is not configured", async () => {
    (countChaptersMissingSummary as Mock).mockResolvedValue({ ...baseAvail, embeddingConfigured: false });
    renderModal();
    await waitFor(() =>
      expect(screen.getByText("需要先在上面配置好写作模型和 embedding（向量检索），才能生成摘要。")).toBeTruthy(),
    );
    expect(screen.queryByText("开始补全")).toBeNull(); // 前置条件不满足 → 不让点开始
  });

  it("says nothing to do when no chapters are missing", async () => {
    (countChaptersMissingSummary as Mock).mockResolvedValue({ ...baseAvail, missingChapters: [] });
    renderModal();
    await waitFor(() => expect(screen.getByText("所有已定稿章节都已经有摘要，无需补全。")).toBeTruthy());
    expect(screen.queryByText("开始补全")).toBeNull();
  });

  it("Start → done: runs the backfill and reports success", async () => {
    (countChaptersMissingSummary as Mock).mockResolvedValue(baseAvail);
    (backfillChapterSummaries as Mock).mockResolvedValue({ total: 3, generated: 3, failed: 0, aborted: false });
    renderModal();
    fireEvent.click(await screen.findByText("开始补全"));
    await waitFor(() => expect(screen.getByText("补全完成：成功生成 3 章摘要。")).toBeTruthy());
    expect(backfillChapterSummaries as Mock).toHaveBeenCalledWith("/au", expect.any(Function), expect.any(Object));
  });
});
