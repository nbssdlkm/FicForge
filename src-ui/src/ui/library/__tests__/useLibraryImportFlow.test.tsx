// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useLibraryImportFlow 导入流程编排测试（盲审长期债③：「导入 → 缺 fandom →
 * 中途建 fandom → 回导入」的断点续流是新手导入的主路径，此前零测试）。
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLibraryImportFlow } from "../useLibraryImportFlow";
import { createAu } from "../../../api/engine-client";

vi.mock("../../../api/engine-client", () => ({
  createAu: vi.fn(),
}));

function setup() {
  const loadFandoms = vi.fn(async () => {});
  const onNavigate = vi.fn();
  const onError = vi.fn();
  const onOpenFandomModal = vi.fn();
  const hook = renderHook(() =>
    useLibraryImportFlow({ dataDir: "/data", loadFandoms, onNavigate, onError, onOpenFandomModal }),
  );
  return { hook, loadFandoms, onNavigate, onError, onOpenFandomModal };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createAu).mockResolvedValue({ path: "/data/fandoms/HP/aus/新AU" } as never);
});

describe("useLibraryImportFlow · 建 fandom 断点续流", () => {
  it("requestCreateFandomFromImport：关导入 modal、开 fandom modal；建完回流预选新 fandom", () => {
    const { hook, onOpenFandomModal } = setup();
    act(() => hook.result.current.openImportPicker());
    expect(hook.result.current.isImportModalOpen).toBe(true);

    act(() => hook.result.current.requestCreateFandomFromImport());
    expect(hook.result.current.isImportModalOpen).toBe(false);
    expect(onOpenFandomModal).toHaveBeenCalledTimes(1);

    act(() => hook.result.current.handleCreatedFandom({ name: "哈利波特", dir_name: "HP" }));
    expect(hook.result.current.isImportModalOpen).toBe(true);
    expect(hook.result.current.importSelectedFandom).toEqual({ name: "哈利波特", dir: "HP" });
  });

  it("resume 是一次性的：第二次建 fandom 不再重开导入 modal", () => {
    const { hook } = setup();
    act(() => hook.result.current.requestCreateFandomFromImport());
    act(() => hook.result.current.handleCreatedFandom({ name: "A", dir_name: "A" }));
    act(() => hook.result.current.closeImportFlow());

    act(() => hook.result.current.handleCreatedFandom({ name: "B", dir_name: "B" }));
    expect(hook.result.current.isImportModalOpen).toBe(false);
  });

  it("非导入语境建 fandom（无 resume 标记）：no-op", () => {
    const { hook } = setup();
    act(() => hook.result.current.handleCreatedFandom({ name: "A", dir_name: "A" }));
    expect(hook.result.current.isImportModalOpen).toBe(false);
    expect(hook.result.current.importSelectedFandom).toBeNull();
  });

  it("cancelPendingImportResume：用户取消建 fandom 后不再回流", () => {
    const { hook } = setup();
    act(() => hook.result.current.requestCreateFandomFromImport());
    act(() => hook.result.current.cancelPendingImportResume());
    act(() => hook.result.current.handleCreatedFandom({ name: "A", dir_name: "A" }));
    expect(hook.result.current.isImportModalOpen).toBe(false);
  });
});

describe("useLibraryImportFlow · 导入中建 AU", () => {
  it("成功：createAu 用 fandom 名 + trim 后 AU 名 + dataDir 拼路径；建完选中新 AU 路径", async () => {
    const { hook, loadFandoms } = setup();
    act(() => hook.result.current.selectImportFandom({ name: "哈利波特", dir: "HP" }));
    act(() => hook.result.current.setImportNewAuName("  新AU  "));

    await act(() => hook.result.current.handleCreateImportAu("HP"));

    expect(createAu).toHaveBeenCalledWith("哈利波特", "新AU", "/data/fandoms/HP");
    expect(loadFandoms).toHaveBeenCalledTimes(1);
    expect(hook.result.current.importAuPath).toBe("/data/fandoms/HP/aus/新AU");
    // 建完回到「已选 AU」形态：fandom 选择与名字输入清空
    expect(hook.result.current.importSelectedFandom).toBeNull();
    expect(hook.result.current.importNewAuName).toBe("");
    expect(hook.result.current.importCreatingAu).toBe(false);
  });

  it("失败：onError、选择态保留（可改名重试）、creating 复位", async () => {
    vi.mocked(createAu).mockRejectedValueOnce(new Error("INVALID_NAME"));
    const { hook, onError } = setup();
    act(() => hook.result.current.selectImportFandom({ name: "哈利波特", dir: "HP" }));
    act(() => hook.result.current.setImportNewAuName("坏名字"));

    await act(() => hook.result.current.handleCreateImportAu("HP"));

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "INVALID_NAME" }));
    expect(hook.result.current.importSelectedFandom).toEqual({ name: "哈利波特", dir: "HP" });
    expect(hook.result.current.importNewAuName).toBe("坏名字");
    expect(hook.result.current.importAuPath).toBe("");
    expect(hook.result.current.importCreatingAu).toBe(false);
  });

  it("空名字或未选 fandom：no-op", async () => {
    const { hook } = setup();
    act(() => hook.result.current.setImportNewAuName("   "));
    await act(() => hook.result.current.handleCreateImportAu("HP"));

    act(() => hook.result.current.setImportNewAuName("名字"));
    // importSelectedFandom 仍是 null
    await act(() => hook.result.current.handleCreateImportAu("HP"));

    expect(createAu).not.toHaveBeenCalled();
  });
});

describe("useLibraryImportFlow · 完成导航", () => {
  it("handleImportComplete：先取走 auPath 再重置流程，导航仍拿到正确路径（缺省去 writer）", async () => {
    const { hook, onNavigate } = setup();
    act(() => hook.result.current.setImportAuPath("/data/fandoms/HP/aus/A1"));

    act(() => hook.result.current.handleImportComplete());

    expect(onNavigate).toHaveBeenCalledWith("writer", "/data/fandoms/HP/aus/A1");
    expect(hook.result.current.isImportModalOpen).toBe(false);
    expect(hook.result.current.importAuPath).toBe("");
  });

  it("handleImportComplete 指定 target：按指定页导航", () => {
    const { hook, onNavigate } = setup();
    act(() => hook.result.current.setImportAuPath("/aus/A1"));
    act(() => hook.result.current.handleImportComplete("chat"));
    expect(onNavigate).toHaveBeenCalledWith("chat", "/aus/A1");
  });

  it("openImportPicker：重开时清掉上次残留选择", () => {
    const { hook } = setup();
    act(() => hook.result.current.selectImportFandom({ name: "旧", dir: "OLD" }));
    act(() => hook.result.current.setImportAuPath("/stale"));

    act(() => hook.result.current.openImportPicker());

    expect(hook.result.current.importSelectedFandom).toBeNull();
    expect(hook.result.current.importAuPath).toBe("");
    expect(hook.result.current.isImportModalOpen).toBe(true);
  });
});
