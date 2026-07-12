// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * TD-013 全量审阅 HIGH：「待定→全跳过/全设定」批量键**不得覆盖用户已手动定成章节的轮次**。
 * 否则用户保留的一章会被悄悄抹掉 + 后续章号前挪。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../../hooks/useFeedback", async () => (await import("../../../test/mocks/feedback")).mockUseFeedback());

import { ChapterArrangeStep } from "../ChapterArrangeStep";
import type { FileAnalysis, ClassifiedTurn } from "../../../api/engine-client";

function turn(over: Partial<ClassifiedTurn>): ClassifiedTurn {
  return {
    index: 0,
    role: "assistant",
    content: "内容",
    charCount: 100,
    assignedType: "skip",
    assignedChapter: null,
    classification: "uncertain",
    reason: { type: "uncertain", charCount: 100 },
    ...over,
  } as ClassifiedTurn;
}

function analysis(turns: ClassifiedTurn[]): FileAnalysis {
  return {
    filename: "chat.txt",
    mode: "chat",
    chatFormat: "Telegram",
    turns,
    stats: { totalChars: 200, estimatedChapters: 1, settingsCount: 0, skippedCount: 1 },
  } as FileAnalysis;
}

describe("ChapterArrangeStep uncertain-batch (TD-013 full review HIGH)", () => {
  it("待定→全跳过 does NOT revert a turn the user manually promoted to chapter", () => {
    const onUpdate = vi.fn();
    // turn0：用户把一条 uncertain 手动定成了「章节」（要保留）；turn1：仍是默认 skip 的 uncertain
    const a = analysis([
      turn({ index: 0, assignedType: "chapter", assignedChapter: 1, classification: "uncertain" }),
      turn({ index: 1, assignedType: "skip", classification: "uncertain" }),
    ]);

    render(
      <ChapterArrangeStep
        analyses={[a]}
        thresholds={{ chapterMinChars: 50, skipMaxChars: 20 } as never}
        onUpdateAnalyses={onUpdate}
        onNext={() => {}}
        onBack={() => {}}
      />,
    );

    // 展开文件（点文件名头）→ 露出批量按钮
    fireEvent.click(screen.getByText("chat.txt"));
    fireEvent.click(screen.getByText("待定 → 全跳过"));

    expect(onUpdate).toHaveBeenCalled();
    const updated = onUpdate.mock.calls[onUpdate.mock.calls.length - 1][0] as FileAnalysis[];
    const turns = updated[0].turns!;
    expect(turns[0].assignedType).toBe("chapter"); // 用户保留的章没被抹掉
    expect(turns[1].assignedType).toBe("skip"); // 仍待定的被批量跳过
  });
});
