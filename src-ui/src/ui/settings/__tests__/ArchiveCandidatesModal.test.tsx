// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ArchiveCandidatesModal } from "../ArchiveCandidatesModal";
import { FeedbackProvider } from "../../../hooks/useFeedback";

vi.mock("../../../api/engine-client", async (importActual) => {
  const actual = await importActual<any>();
  return { ...actual, findArchivalCandidates: vi.fn(), archiveFacts: vi.fn() };
});

import { findArchivalCandidates, archiveFacts } from "../../../api/engine-client";

const candidate = (id: string, chapter: number) => ({
  id, content_raw: id, content_clean: `旧笔记 ${id}`, characters: [],
  status: "active", type: "plot_event", narrative_weight: "low", chapter, timeline: "",
});

function renderModal() {
  return render(
    <FeedbackProvider>
      <ArchiveCandidatesModal auPath="/au" isOpen onClose={() => {}} />
    </FeedbackProvider>,
  );
}

describe("ArchiveCandidatesModal", () => {
  beforeEach(() => {
    (findArchivalCandidates as Mock).mockReset();
    (archiveFacts as Mock).mockReset();
  });

  it("lists candidates and offers to archive all by default", async () => {
    (findArchivalCandidates as Mock).mockResolvedValue([candidate("f1", 1), candidate("f2", 2)]);
    renderModal();
    expect(await screen.findByText("旧笔记 f1")).toBeTruthy();
    expect(screen.getByText("旧笔记 f2")).toBeTruthy();
    // 默认全选 → 按钮显示「收起选中（2）」
    expect(screen.getByText("收起选中（2）")).toBeTruthy();
  });

  it("shows an empty state when nothing qualifies", async () => {
    (findArchivalCandidates as Mock).mockResolvedValue([]);
    renderModal();
    await waitFor(() => expect(screen.getByText("没有可整理的旧笔记")).toBeTruthy());
    expect(screen.queryByText(/收起选中/)).toBeNull();
  });

  it("archives the selected subset and reports the count", async () => {
    (findArchivalCandidates as Mock).mockResolvedValue([candidate("f1", 1), candidate("f2", 2)]);
    (archiveFacts as Mock).mockResolvedValue(["f1", "f2"]);
    renderModal();
    fireEvent.click(await screen.findByText("收起选中（2）"));
    await waitFor(() => expect(screen.getByText("已收起 2 条旧笔记。")).toBeTruthy());
    expect(archiveFacts as Mock).toHaveBeenCalledWith("/au", ["f1", "f2"]);
  });

  it("unchecking a candidate shrinks the confirmed subset", async () => {
    (findArchivalCandidates as Mock).mockResolvedValue([candidate("f1", 1), candidate("f2", 2)]);
    (archiveFacts as Mock).mockResolvedValue(["f1"]);
    renderModal();
    await screen.findByText("旧笔记 f1");
    fireEvent.click(screen.getAllByRole("checkbox")[1]); // 取消勾选 f2
    expect(screen.getByText("收起选中（1）")).toBeTruthy();
    fireEvent.click(screen.getByText("收起选中（1）"));
    await waitFor(() => expect(archiveFacts as Mock).toHaveBeenCalledWith("/au", ["f1"]));
  });
});
