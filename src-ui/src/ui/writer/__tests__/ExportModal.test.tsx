// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * TD-015 review fix #12：dispatchSave parity —— 章节文本导出与完整备份导出
 * 必须走同一条保存路由。这里验证两个按钮分别调用各自的 export fn，且在浏览器分支
 * 上都完成保存并 onClose（共用 dispatchSave）。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const exportChapters = vi.fn();
const exportAuBundle = vi.fn();

vi.mock("../../../api/engine-client", () => ({
  exportChapters: (...a: unknown[]) => exportChapters(...a),
  exportAuBundle: (...a: unknown[]) => exportAuBundle(...a),
  logCatch: () => {},
}));

vi.mock("../../../utils/platform", () => ({
  isTauri: () => false,
  isCapacitor: () => false, // 浏览器下载分支
}));

vi.mock("../../../hooks/useFeedback", async () => (await import("../../../test/mocks/feedback")).mockUseFeedback());

import { ExportModal } from "../ExportModal";

describe("ExportModal dispatchSave parity (review fix #12)", () => {
  beforeEach(() => {
    exportChapters.mockReset();
    exportAuBundle.mockReset();
    // jsdom 无 createObjectURL —— 桩掉，让浏览器下载分支能跑通到 onClose
    (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => "blob:x");
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
  });

  it("full-backup button calls exportAuBundle and closes via the shared save path", async () => {
    exportAuBundle.mockResolvedValue({
      blob: new Blob(["{}"], { type: "application/json" }),
      filename: "x.ffbundle.json",
    });
    const onClose = vi.fn();
    render(<ExportModal isOpen onClose={onClose} auPath="/data/aus/a" />);

    fireEvent.click(screen.getByText("导出完整备份"));

    await waitFor(() => expect(exportAuBundle).toHaveBeenCalledWith("/data/aus/a"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(exportChapters).not.toHaveBeenCalled();
  });

  it("chapter export button calls exportChapters through the same save path", async () => {
    exportChapters.mockResolvedValue({ blob: new Blob(["text"], { type: "text/plain" }), filename: "x.md" });
    const onClose = vi.fn();
    render(<ExportModal isOpen onClose={onClose} auPath="/data/aus/a" />);

    fireEvent.click(screen.getByText("确认导出"));

    await waitFor(() => expect(exportChapters).toHaveBeenCalled());
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
