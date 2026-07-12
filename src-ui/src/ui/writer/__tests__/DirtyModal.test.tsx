// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * DirtyModal 解除路径的半成功透出（盲审 2026-07-11 + B1 对抗审 LOW）：
 * 引擎 resolve_dirty_chapter 现在逐条尽力应用 fact 变更并把失败清单随结果带回 ——
 * UI 必须把「章节已解除但 N 条变更未应用」明示给用户，而不是静默丢或伪装整体失败。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { feedbackMock } from "../../../test/mocks/feedback";

const resolveDirtyChapter = vi.fn();
const listFacts = vi.fn();
const extractFacts = vi.fn();
const addFact = vi.fn();

vi.mock("../../../api/engine-client", () => ({
  resolveDirtyChapter: (...a: unknown[]) => resolveDirtyChapter(...a),
  listFacts: (...a: unknown[]) => listFacts(...a),
  extractFacts: (...a: unknown[]) => extractFacts(...a),
  addFact: (...a: unknown[]) => addFact(...a),
  extractedEnrichment: () => ({}),
  logCatch: () => {},
}));

vi.mock("../../../hooks/useFeedback", async () => (await import("../../../test/mocks/feedback")).mockUseFeedback());
const { showError } = feedbackMock;

import { DirtyModal } from "../DirtyModal";

function renderModal(onResolved = vi.fn(), onClose = vi.fn()) {
  render(<DirtyModal isOpen onClose={onClose} auPath="fandoms/F/aus/A" chapterNum={3} onResolved={onResolved} />);
  return { onResolved, onClose };
}

describe("DirtyModal — failed_fact_changes 透出", () => {
  beforeEach(() => {
    resolveDirtyChapter.mockReset();
    listFacts.mockReset().mockResolvedValue([]);
    extractFacts.mockReset().mockResolvedValue({ candidates: [] });
    addFact.mockReset();
    showError.mockReset();
  });

  it("全部变更应用成功：不弹告警，正常 onClose + onResolved", async () => {
    resolveDirtyChapter.mockResolvedValue({
      chapter_num: 3,
      is_latest: true,
      content_hash: "h",
      failed_fact_changes: [],
    });
    const { onResolved, onClose } = renderModal();

    fireEvent.click(await screen.findByText("确认修改，更新状态"));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onResolved).toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
  });

  it("部分 fact 变更失败：仍关窗刷新，但明示「N 条变更未应用」", async () => {
    resolveDirtyChapter.mockResolvedValue({
      chapter_num: 3,
      is_latest: true,
      content_hash: "h",
      failed_fact_changes: [
        { fact_id: "f1", action: "update", error: "io" },
        { fact_id: "f2", action: "deprecate", error: "io" },
      ],
    });
    const { onClose } = renderModal();

    fireEvent.click(await screen.findByText("确认修改，更新状态"));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(showError).toHaveBeenCalledTimes(1);
    const err = showError.mock.calls[0][0] as Error;
    expect(err.message).toContain("2");
    expect(err.message).toContain("未应用");
  });

  it("兼容旧形态结果（无 failed_fact_changes 字段）不误弹告警", async () => {
    resolveDirtyChapter.mockResolvedValue({ chapter_num: 3, is_latest: true, content_hash: "h" });
    const { onClose } = renderModal();

    fireEvent.click(await screen.findByText("确认修改，更新状态"));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(showError).not.toHaveBeenCalled();
  });
});
