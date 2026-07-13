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

vi.mock("../../hooks/useFeedback", async () => (await import("../../test/mocks/feedback")).mockUseFeedback());

vi.mock("../../utils/platform", () => ({
  isCapacitor: () => false, // 桌面：渲染「选文件夹」入口
  isTauri: () => false,
}));

import { RestoreBundleModal } from "../RestoreBundleModal";

function auRootBundle(over: Partial<AuBundle["manifest"]> = {}): AuBundle {
  return {
    manifest: {
      bundle_version: "1.0.0",
      exported_at: "t",
      au_name: "",
      fandom: "",
      chapter_count: 2,
      file_count: 3,
      excluded_dirs: [],
      ...over,
    },
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
        files: [rawFile("ch0001.md", "myAU/chapters/main/ch0001.md"), rawFile("project.yaml", "myAU/project.yaml")],
      },
    });

    await waitFor(() => expect(bundleFromRawFiles).toHaveBeenCalled());
    const collected = bundleFromRawFiles.mock.calls[0][0] as Array<{ relpath: string }>;
    expect(collected.map((c) => c.relpath).sort()).toEqual(["chapters/main/ch0001.md", "project.yaml"]);
  });

  it("恢复成功后进入完成态，展示「补全记忆」引导、不立即关闭（最后一公里）", async () => {
    bundleFromRawFiles.mockReturnValue(auRootBundle());
    restoreAuBundle.mockResolvedValue({ skipped: [], chapterCount: 2 });
    const { container } = renderModal();

    // 选原始文件夹 → bundle 就位
    const rawInput = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
    fireEvent.change(rawInput, { target: { files: [rawFile("project.yaml", "myAU/project.yaml")] } });
    await waitFor(() => expect(bundleFromRawFiles).toHaveBeenCalled());

    // 选合集 + 填名 + 恢复
    fireEvent.change(container.querySelector("select")!, { target: { value: "yuanchuang" } });
    const nameInput = container.querySelector('input[type="text"], input:not([type])') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "迁回的文" } });
    fireEvent.click(screen.getByText("恢复"));

    // 完成态：出现补全记忆引导，且不再有「恢复」提交按钮（未自动关）
    await waitFor(() => expect(screen.getByText(/一键补全记忆/)).toBeInTheDocument());
    expect(screen.getByText(/补全旧章记忆/)).toBeInTheDocument();
    expect(screen.queryByText("恢复")).toBeNull();
  });

  it("完成态「去补全记忆」按钮：带新建 AU 路径回调 onGoBackfill 并关窗（R3 低危：引导原本无按钮）", async () => {
    bundleFromRawFiles.mockReturnValue(auRootBundle());
    restoreAuBundle.mockResolvedValue({ skipped: [], chapterCount: 2, auPath: "/data/fandoms/yuanchuang/aus/qianhui" });
    const onGoBackfill = vi.fn();
    const onClose = vi.fn();
    const { container } = render(
      <RestoreBundleModal
        isOpen
        onClose={onClose}
        fandoms={[{ name: "原创", dir_name: "yuanchuang" }]}
        dataDir="/data"
        onComplete={() => {}}
        onGoBackfill={onGoBackfill}
      />,
    );

    const rawInput = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
    fireEvent.change(rawInput, { target: { files: [rawFile("project.yaml", "myAU/project.yaml")] } });
    await waitFor(() => expect(bundleFromRawFiles).toHaveBeenCalled());
    fireEvent.change(container.querySelector("select")!, { target: { value: "yuanchuang" } });
    fireEvent.change(container.querySelector('input[type="text"], input:not([type])') as HTMLInputElement, {
      target: { value: "迁回的文" },
    });
    fireEvent.click(screen.getByText("恢复"));

    await waitFor(() => expect(screen.getByText("去补全记忆")).toBeInTheDocument());
    fireEvent.click(screen.getByText("去补全记忆"));
    expect(onGoBackfill).toHaveBeenCalledWith("/data/fandoms/yuanchuang/aus/qianhui");
    expect(onClose).toHaveBeenCalled();
  });

  it("不传 onGoBackfill 时完成态只有文字引导，不渲染直达按钮（可选 prop 向后兼容）", async () => {
    bundleFromRawFiles.mockReturnValue(auRootBundle());
    restoreAuBundle.mockResolvedValue({ skipped: [], chapterCount: 2, auPath: "/data/fandoms/yuanchuang/aus/x" });
    const { container } = renderModal();

    const rawInput = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
    fireEvent.change(rawInput, { target: { files: [rawFile("project.yaml", "myAU/project.yaml")] } });
    await waitFor(() => expect(bundleFromRawFiles).toHaveBeenCalled());
    fireEvent.change(container.querySelector("select")!, { target: { value: "yuanchuang" } });
    fireEvent.change(container.querySelector('input[type="text"], input:not([type])') as HTMLInputElement, {
      target: { value: "无按钮" },
    });
    fireEvent.click(screen.getByText("恢复"));

    await waitFor(() => expect(screen.getByText(/一键补全记忆/)).toBeInTheDocument());
    expect(screen.queryByText("去补全记忆")).toBeNull();
  });

  it("部分恢复（skipped>0）→ 完成态如实透出跳过告警，不被正向引导盖过（对抗审②）", async () => {
    bundleFromRawFiles.mockReturnValue(auRootBundle());
    restoreAuBundle.mockResolvedValue({ skipped: ["a.md", "b.md"], chapterCount: 2 });
    const { container } = renderModal();

    const rawInput = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;
    fireEvent.change(rawInput, { target: { files: [rawFile("project.yaml", "myAU/project.yaml")] } });
    await waitFor(() => expect(bundleFromRawFiles).toHaveBeenCalled());
    fireEvent.change(container.querySelector("select")!, { target: { value: "yuanchuang" } });
    fireEvent.change(container.querySelector('input[type="text"], input:not([type])') as HTMLInputElement, {
      target: { value: "半迁回" },
    });
    fireEvent.click(screen.getByText("恢复"));

    // 完成态同时含跳过告警（2 个）+ 补记忆引导
    await waitFor(() => expect(screen.getByText(/2 个文件被跳过/)).toBeInTheDocument());
    expect(screen.getByText(/一键补全记忆/)).toBeInTheDocument();
  });

  it("rejects a non-AU-root selection (no project.yaml/state.yaml, 0 chapters) with a clear error", async () => {
    bundleFromRawFiles.mockReturnValue({
      manifest: {
        bundle_version: "1.0.0",
        exported_at: "t",
        au_name: "",
        fandom: "",
        chapter_count: 0,
        file_count: 1,
        excluded_dirs: [],
      },
      files: { "au1/random.txt": "x" }, // 用户选了上一层，结构都歪在 au1/ 下
    });
    const { container } = renderModal();
    const rawInput = container.querySelectorAll('input[type="file"]')[1] as HTMLInputElement;

    fireEvent.change(rawInput, { target: { files: [rawFile("random.txt", "wrongdir/au1/random.txt")] } });

    // 显示「这不是文的根目录」提示，且没有进入恢复
    await waitFor(() => expect(screen.getByText(/project\.yaml/)).toBeInTheDocument());
    expect(restoreAuBundle).not.toHaveBeenCalled();
  });
});
