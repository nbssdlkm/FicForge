// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BottomNavBar } from "../BottomNavBar";

// BottomNavBar is gated purely on its `isSimple` PROP (the AuWorkspaceLayout mount snapshot),
// never a live useWritingMode() — so a mid-AU mode toggle cannot flip the mobile tab set
// independently of the desktop snapshot (Phase 2 spec §3.2 / mobile-parity invariant).
describe("BottomNavBar gating", () => {
  it("renders 4 tabs (no chat) in full mode", () => {
    render(<BottomNavBar activeTab="writer" isSimple={false} onTabChange={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(4);
    expect(screen.queryByText("对话")).toBeNull();
  });

  it("renders 5 tabs incl. chat in simple mode, with writer relabeled 阅读", () => {
    render(<BottomNavBar activeTab="chat" isSimple={true} onTabChange={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(5);
    expect(screen.getByText("对话")).toBeTruthy();
    expect(screen.getByText("阅读")).toBeTruthy();
  });
});
