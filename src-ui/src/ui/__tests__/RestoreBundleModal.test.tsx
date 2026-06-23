// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * TD-015 review fix #7：RestoreBundleModal 最脆弱的输入面 —— 原始文件夹导入的
 * relpath 剥段 + 「选错上层文件夹」的 AU-root 校验。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { AuBundle } from "@ficforge/engine";

const bundleFromRawFiles = vi.fn();
const restoreAuBundle = vi.fn();
const parseAuBundle = vi.fn();

vi.mock("../../api/engine-client", () => ({
  bundleFromRawFiles: (...a: unknown[]) => bundleFromRawFiles(...a),
  restoreAuBundle: (...a: unknown[]) => restoreAuBundle(...a),
  parseAuBundle: (...a: unknown[]) => parseAuBundle(...a),
  logCatch: () => {},
}));

vi.mock("../../hooks/useFeedback", () => ({
  useFeedback: () => ({ showToast: vi.fn(), showError: vi.fn(), showSuccess: vi.fn() }),
}));

vi.mock("../../utils/platform", () => ({
  isCapacitor: () => false,   // 桌面：渲染「选文件夹」入口
  isTauri: () => false,
}));

import { RestoreBundleModal } from "../RestoreBundleModal";

function auRootBundle(over: Partial<AuBundle["manifest"]> = {}): AuBundle {
  return {
    manifest: { bundle_version: "1.0.0", exported_at: "t", au_name: "", fandom: "", chapter_count: 2, file_count: 3, excluded_dirs: [], ...over },
    files: { "project.yaml": "name: x", "chapters/main/ch0001.md": "a", "chapters/main/ch0002.md": "b" },
  };
}

function rawFile(name: string, relPath: string): File {
  const f = new File(["content"], name, { type: "text/plain" });
  Object.defineProperty(f, "webkitRelativePath", { value: relPath });
  return f;
}

function renderModal() {
  return render(
    <RestoreBundleModal
      isOpen
      onClose={() => {}}
      fandoms={[{ name: "原创", dir_name: "yuanchuang" }]}
      dataDir="/data"
      onComplete={() => {}}
    />,
  );
}

describe("RestoreBundleModal raw-folder import (review fix #7)", () => {
  beforeEach(() => {
    bundleFromRawFiles.mockReset();
    restoreAuBundle.mockReset();
    parseAuBundle.mockReset();
  });

  it("strips exactly the selected-folder segment from webkitRelativePath before bundling", async () => {
    bundleFromRawFiles.mockReturnValue(auRootBundle());
    const { container } = renderModal();
    const rawInput = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;

    fireEvent.change(rawInput, {
      target: {
        files: [
          rawFile("ch0001.md", "myAU/chapters/main/ch0001.md"),
          rawFile("project.yaml", "myAU/project.yaml"),
        ],
      },
    });

    await waitFor(() => expect(bundleFromRawFiles).toHaveBeenCalled());
    const collected = bundleFromRawFiles.mock.calls[0][0] as Array<{ relpath: string }>;
    expect(collected.map((c) => c.relpath).sort()).toEqual(
      ["chapters/main/ch0001.md", "project.yaml"],
    );
  });

  it("rejects a non-AU-root selection (no project.yaml/state.yaml, 0 chapters) with a clear error", async () => {
    bundleFromRawFiles.mockReturnValue({
      manifest: { bundle_version: "1.0.0", exported_at: "t", au_name: "", fandom: "", chapter_count: 0, file_count: 1, excluded_dirs: [] },
      files: { "au1/random.txt": "x" },     // 用户选了上一层，结构都歪在 au1/ 下
    });
    const { container } = renderModal();
    const rawInput = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;

    fireEvent.change(rawInput, { target: { files: [rawFile("random.txt", "wrongdir/au1/random.txt")] } });

    // 显示「这不是文的根目录」提示，且没有进入恢复
    await waitFor(() => expect(screen.getByText(/project\.yaml/)).toBeTruthy());
    expect(restoreAuBundle).not.toHaveBeenCalled();
  });
});
