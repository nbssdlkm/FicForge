// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { FactAnnotationChips } from "../FactAnnotationChips";
import { FactCard } from "../FactCard";

// M3 批一：知情标注 chips —— FactCard / ExtractReviewModal / DirtyModal 共用的单一真相源组件。
// 展示口径与引擎注入端一致：all / null / 空名单不出章。

describe("FactAnnotationChips", () => {
  it("known_to=reader_only → 「仅读者知」info 章", () => {
    render(<FactAnnotationChips fact={{ known_to: "reader_only" }} />);
    expect(screen.getByText("仅读者知")).toBeTruthy();
  });

  it("known_to 名单 → 「仅王妃、稳婆知道」；hidden_from → 「瞒着王爷」", () => {
    render(<FactAnnotationChips fact={{ known_to: ["王妃", "稳婆"], hidden_from: ["王爷"] }} />);
    expect(screen.getByText("仅王妃、稳婆知道")).toBeTruthy();
    expect(screen.getByText("瞒着王爷")).toBeTruthy();
  });

  it("all / null / 空名单 → 不渲染任何章（无信息量，与注入端同口径）", () => {
    const { container } = render(
      <>
        <FactAnnotationChips fact={{ known_to: "all" }} />
        <FactAnnotationChips fact={{ known_to: null, hidden_from: [] }} />
        <FactAnnotationChips fact={{}} />
      </>,
    );
    expect(container.textContent).toBe("");
  });

  it("历史脏数据：known_to 裸字符串按单人名单展示", () => {
    render(<FactAnnotationChips fact={{ known_to: "皇帝" as unknown as "all" }} />);
    expect(screen.getByText("仅皇帝知道")).toBeTruthy();
  });

  it("story_time_tag 预留位：默认不显示，showStoryTimeTag 开启后显示（批三启用）", () => {
    const { rerender } = render(<FactAnnotationChips fact={{ story_time_tag: "Y1 冬末" }} />);
    expect(screen.queryByText("Y1 冬末")).toBeNull();
    rerender(<FactAnnotationChips fact={{ story_time_tag: "Y1 冬末" }} showStoryTimeTag />);
    expect(screen.getByText("Y1 冬末")).toBeTruthy();
  });
});

describe("FactCard 集成知情标注", () => {
  const baseFact = {
    id: "f1",
    content_clean: "王妃的胎儿并非王爷血脉",
    status: "active",
    weight: "high",
    chapter: 3,
    characters: ["王妃"],
  };

  it("卡片第一行渲染知情 chips", () => {
    render(<FactCard fact={{ ...baseFact, known_to: ["王妃"], hidden_from: ["王爷"] }} />);
    expect(screen.getByText("仅王妃知道")).toBeTruthy();
    expect(screen.getByText("瞒着王爷")).toBeTruthy();
  });

  it("无标注的卡片不出知情章", () => {
    render(<FactCard fact={baseFact} />);
    expect(screen.queryByText(/仅.*知道/)).toBeNull();
    expect(screen.queryByText(/瞒着/)).toBeNull();
  });
});
