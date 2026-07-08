// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { BackfillMemoryModal } from "../BackfillMemoryModal";
import { FeedbackProvider } from "../../../hooks/useFeedback";

// 保留真实 engine-client（FeedbackProvider 依赖 ApiError 等），只覆盖补记忆这两个 api。
vi.mock("../../../api/engine-client", async (importActual) => {
  const actual = await importActual<any>();
  return {
    ...actual,
    scanChapterMemory: vi.fn(),
    backfillChapterMemory: vi.fn(),
  };
});

import { scanChapterMemory, backfillChapterMemory } from "../../../api/engine-client";

// ch1 有 2 条笔记、ch2/ch3 零笔记；ch2/ch3 缺摘要。
const baseScan = {
  totalConfirmed: 3,
  chaptersMissingSummary: [2, 3],
  chaptersZeroFacts: [2, 3],
  factCountByChapter: { 1: 2, 2: 0, 3: 0 },
  embeddingConfigured: true,
  llmConfigured: true,
};

function renderModal() {
  return render(
    <FeedbackProvider>
      <BackfillMemoryModal auPath="/au" isOpen onClose={() => {}} />
    </FeedbackProvider>,
  );
}

describe("BackfillMemoryModal", () => {
  beforeEach(() => {
    (scanChapterMemory as Mock).mockReset();
    (backfillChapterMemory as Mock).mockReset();
  });

  it("confirm 阶段:列出缺摘要 + 逐章笔记选择器(零笔记章默认勾选) + 开始按钮", async () => {
    (scanChapterMemory as Mock).mockResolvedValue(baseScan);
    renderModal();

    expect(await screen.findByText("缺摘要：2 章（将自动补齐）。")).toBeTruthy();
    // 三章都列出
    expect(screen.getByText("第 1 章")).toBeTruthy();
    expect(screen.getByText("第 3 章")).toBeTruthy();
    // 默认勾选 = 零笔记章 [2,3]；ch1(有笔记)不勾
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes).toHaveLength(3);
    expect(boxes[0].checked).toBe(false); // ch1
    expect(boxes[1].checked).toBe(true);  // ch2
    expect(boxes[2].checked).toBe(true);  // ch3
    expect(screen.getByText("开始补全")).toBeTruthy();
  });

  it("未配 embedding/LLM → needConfig,不让开始", async () => {
    (scanChapterMemory as Mock).mockResolvedValue({ ...baseScan, embeddingConfigured: false });
    renderModal();
    await waitFor(() =>
      expect(screen.getByText("需要先在上面配置好写作模型和 embedding（向量检索），才能补全记忆。")).toBeTruthy(),
    );
    expect(screen.queryByText("开始补全")).toBeNull();
  });

  it("勾选章传给 backfillChapterMemory;done 报告摘要 + 笔记数", async () => {
    (scanChapterMemory as Mock).mockResolvedValue(baseScan);
    (backfillChapterMemory as Mock).mockResolvedValue({
      total: 3, summariesGenerated: 2, factsChapters: 2, factsAdded: 5,
      indexed: 3, skipped: 0, failed: 0, aborted: false, factsOverCapCount: 0,
    });
    renderModal();

    fireEvent.click(await screen.findByText("开始补全"));

    await waitFor(() => expect(screen.getByText("补全完成：生成 2 章摘要，提取 5 条笔记。")).toBeTruthy());
    // overCap=0 → 不显示上限说明行
    expect(screen.queryByText(/因单章数量上限被略过/)).toBeNull();
    // 默认勾选 [2,3] 作为 factsChapters 传入
    expect(backfillChapterMemory as Mock).toHaveBeenCalledWith(
      "/au",
      { factsChapters: [2, 3] },
      expect.any(Function),
      expect.any(Object),
    );
  });

  // L16(审计第二轮):factsOverCapCount>0 时 done 区多显示一行软上限说明。
  it("L16:提取命中软上限时显示 overCapNote 行", async () => {
    (scanChapterMemory as Mock).mockResolvedValue(baseScan);
    (backfillChapterMemory as Mock).mockResolvedValue({
      total: 3, summariesGenerated: 2, factsChapters: 2, factsAdded: 5,
      indexed: 3, skipped: 0, failed: 0, aborted: false, factsOverCapCount: 4,
    });
    renderModal();
    fireEvent.click(await screen.findByText("开始补全"));
    await waitFor(() => expect(screen.getByText("补全完成：生成 2 章摘要，提取 5 条笔记。")).toBeTruthy());
    // 4 条被上限略过 → 显示说明行
    expect(screen.getByText(/有 4 条提取到的笔记因单章数量上限被略过/)).toBeTruthy();
  });

  it("勾选已有笔记的章 → 显示重复警告(透明,不阻止)", async () => {
    (scanChapterMemory as Mock).mockResolvedValue(baseScan);
    renderModal();
    await screen.findByText("第 1 章");
    const boxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    fireEvent.click(boxes[0]); // 选 ch1(有 2 条笔记)
    await waitFor(() => expect(screen.getByText(/已经有笔记了/)).toBeTruthy());
  });

  it("无缺摘要且全部有笔记 → nothingToDo + 开始按钮禁用", async () => {
    (scanChapterMemory as Mock).mockResolvedValue({
      totalConfirmed: 2,
      chaptersMissingSummary: [],
      chaptersZeroFacts: [],
      factCountByChapter: { 1: 1, 2: 1 },
      embeddingConfigured: true,
      llmConfigured: true,
    });
    renderModal();
    await waitFor(() => expect(screen.getByText("没有需要补全的内容。")).toBeTruthy());
    const start = screen.getByText("开始补全").closest("button") as HTMLButtonElement;
    expect(start.disabled).toBe(true);
  });

  it("全不选笔记后,factsChapters 为空(只补摘要+向量)", async () => {
    (scanChapterMemory as Mock).mockResolvedValue(baseScan);
    (backfillChapterMemory as Mock).mockResolvedValue({
      total: 2, summariesGenerated: 2, factsChapters: 0, factsAdded: 0,
      indexed: 2, skipped: 0, failed: 0, aborted: false,
    });
    renderModal();

    fireEvent.click(await screen.findByText("全不选"));
    fireEvent.click(await screen.findByText("开始补全")); // 仍可开始(有缺摘要)

    await waitFor(() =>
      expect(backfillChapterMemory as Mock).toHaveBeenCalledWith(
        "/au", { factsChapters: [] }, expect.any(Function), expect.any(Object),
      ),
    );
  });
});
