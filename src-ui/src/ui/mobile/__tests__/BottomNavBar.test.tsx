// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BottomNavBar } from "../BottomNavBar";

// 融合后无写作模式分叉：底栏恒为统一 5-tab 集合
// （chapters / writer / chat / settings / manage），不再有 isSimple prop。
describe("BottomNavBar (融合统一底栏)", () => {
  it("恒渲染 5 个 tab，含「对话」(chat)；writer 不再被改标成「阅读」", () => {
    render(<BottomNavBar activeTab="chat" onTabChange={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(5);
    // 对话 tab 恒在（chat），用 defaultValue 兜底文案断言。
    expect(screen.getByText("对话")).toBeInTheDocument();
    // 旧 simple 模式把 writer tab 改标「阅读」(SimpleReadingView)；融合后 writer = 完整 WriterLayout，不再有「阅读」。
    expect(screen.queryByText("阅读")).toBeNull();
  });

  it("activeTab=writer 时也是 5 tab（与 chat 同一集合，无模式分叉）", () => {
    render(<BottomNavBar activeTab="writer" onTabChange={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(5);
    expect(screen.getByText("对话")).toBeInTheDocument();
  });
});
