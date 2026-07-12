// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * TD-013：TurnCard 类型 pill 组 —— 4 类型可见、chapter_continue 禁用而非隐藏、
 * 点击切换、uncertain 标「待定」。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TurnCard } from "../TurnCard";
import type { ClassifiedTurn } from "../../../api/engine-client";

function makeTurn(over: Partial<ClassifiedTurn> = {}): ClassifiedTurn {
  return {
    index: 0,
    role: "assistant",
    content: "正文内容很长".repeat(40),
    charCount: 240,
    assignedType: "chapter",
    assignedChapter: 1,
    classification: "chapter",
    reason: { type: "long_reply", charCount: 240, threshold: 100 },
    ...over,
  } as ClassifiedTurn;
}

describe("TurnCard pill selector (TD-013)", () => {
  it("renders all four type pills (setting + skip discoverable, not hidden in a dropdown)", () => {
    render(<TurnCard turn={makeTurn()} currentChapterNum={1} hasPreviousChapter onChangeType={() => {}} />);
    expect(screen.getByText("设定")).toBeTruthy();
    expect(screen.getByText("跳过")).toBeTruthy();
  });

  it("disables (not hides) chapter_continue when there is no previous chapter", () => {
    render(<TurnCard turn={makeTurn()} currentChapterNum={1} hasPreviousChapter={false} onChangeType={() => {}} />);
    const continueBtn = screen.getByText(/续/).closest("button");
    expect(continueBtn).toBeTruthy();
    expect((continueBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it("enables chapter_continue when a previous chapter exists", () => {
    render(<TurnCard turn={makeTurn()} currentChapterNum={2} hasPreviousChapter onChangeType={() => {}} />);
    const continueBtn = screen.getByText(/续/).closest("button") as HTMLButtonElement;
    expect(continueBtn.disabled).toBe(false);
  });

  it("calls onChangeType with the clicked type", () => {
    const onChange = vi.fn();
    render(<TurnCard turn={makeTurn()} currentChapterNum={1} hasPreviousChapter onChangeType={onChange} />);
    fireEvent.click(screen.getByText("设定"));
    expect(onChange).toHaveBeenCalledWith(0, "setting");
  });

  it("shows the uncertain badge when the turn is classified uncertain", () => {
    render(
      <TurnCard
        turn={makeTurn({
          classification: "uncertain",
          assignedType: "skip",
          reason: { type: "uncertain", charCount: 90 },
        })}
        currentChapterNum={1}
        hasPreviousChapter
        onChangeType={() => {}}
      />,
    );
    expect(screen.getByText("待定")).toBeTruthy();
  });
});
