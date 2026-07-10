// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useLibraryMutations 破坏性操作测试（盲审 2026-07-09：deleteFandom/deleteAu
 * 及 create+导航+错误分支此前零测试——删除是数据破坏性路径，必须有失败路径覆盖）。
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLibraryMutations } from "../useLibraryMutations";
import { createAu, deleteAu, deleteFandom } from "../../../api/engine-client";

vi.mock("../../../api/engine-client", () => ({
  createFandom: vi.fn(async (name: string) => ({ name, dir_name: name })),
  createAu: vi.fn(async (_f: string, name: string, fandomPath: string) => ({ path: `${fandomPath}/aus/${name}` })),
  deleteFandom: vi.fn(async () => undefined),
  deleteAu: vi.fn(async () => undefined),
}));

function setup(overrides: Partial<Parameters<typeof useLibraryMutations>[0]> = {}) {
  const loadFandoms = vi.fn(async () => undefined);
  const onNavigate = vi.fn();
  const onError = vi.fn();
  const hook = renderHook(() =>
    useLibraryMutations({
      dataDir: "/data",
      loadFandoms,
      onNavigate,
      onError,
      ...overrides,
    }),
  );
  return { hook, loadFandoms, onNavigate, onError };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useLibraryMutations · 删除路径", () => {
  it("删 fandom：调 deleteFandom(fandomDir) → 清 target → 重载列表", async () => {
    const { hook, loadFandoms, onError } = setup();
    act(() => hook.result.current.openDeleteFandom("HP", "哈利波特"));
    expect(hook.result.current.deleteTarget).toMatchObject({ type: "fandom", fandomDir: "HP" });

    await act(() => hook.result.current.handleDelete());

    expect(deleteFandom).toHaveBeenCalledWith("HP");
    expect(hook.result.current.deleteTarget).toBeNull();
    expect(loadFandoms).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(hook.result.current.deleting).toBe(false);
  });

  it("删 AU：优先用 auDir（缺省回退 auName）", async () => {
    const { hook } = setup();
    act(() => hook.result.current.openDeleteAu("HP", "哈利波特", "au-dir", "我的AU"));
    await act(() => hook.result.current.handleDelete());
    expect(deleteAu).toHaveBeenCalledWith("HP", "au-dir");
  });

  it("删除失败：onError 收到错误、target 仍清空（防重复弹确认）、deleting 复位", async () => {
    vi.mocked(deleteFandom).mockRejectedValueOnce(new Error("EACCES"));
    const { hook, loadFandoms, onError } = setup();
    act(() => hook.result.current.openDeleteFandom("HP", "哈利波特"));

    await act(() => hook.result.current.handleDelete());

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "EACCES" }));
    expect(hook.result.current.deleteTarget).toBeNull();
    expect(hook.result.current.deleting).toBe(false);
    // 失败路径不重载列表（磁盘未变）
    expect(loadFandoms).not.toHaveBeenCalled();
  });

  it("无 target / 进行中重入：直接 no-op 不触发删除", async () => {
    const { hook } = setup();
    await act(() => hook.result.current.handleDelete());
    expect(deleteFandom).not.toHaveBeenCalled();
    expect(deleteAu).not.toHaveBeenCalled();
  });
});

describe("useLibraryMutations · 建 AU 导航", () => {
  it("成功：关 modal、清名字、导航到对话 tab（融合后主力入口）", async () => {
    const { hook, onNavigate } = setup();
    act(() => hook.result.current.openAuModal("哈利波特", "HP"));
    act(() => hook.result.current.setNewAuName("新AU"));

    await act(() => hook.result.current.handleCreateAu());

    expect(createAu).toHaveBeenCalledWith("哈利波特", "新AU", "/data/fandoms/HP");
    expect(onNavigate).toHaveBeenCalledWith("chat", "/data/fandoms/HP/aus/新AU");
    await waitFor(() => expect(hook.result.current.isAuModalOpen).toBe(false));
    expect(hook.result.current.newAuName).toBe("");
  });

  it("失败：onError 触发、modal 保持打开（用户可改名重试）、creating 复位", async () => {
    vi.mocked(createAu).mockRejectedValueOnce(new Error("INVALID_NAME"));
    const { hook, onNavigate, onError } = setup();
    act(() => hook.result.current.openAuModal("哈利波特", "HP"));
    act(() => hook.result.current.setNewAuName("坏名字"));

    await act(() => hook.result.current.handleCreateAu());

    expect(onError).toHaveBeenCalled();
    expect(onNavigate).not.toHaveBeenCalled();
    expect(hook.result.current.isAuModalOpen).toBe(true);
    expect(hook.result.current.creatingAu).toBe(false);
  });

  it("空名字：不发请求", async () => {
    const { hook } = setup();
    act(() => hook.result.current.openAuModal("哈利波特", "HP"));
    act(() => hook.result.current.setNewAuName("   "));
    await act(() => hook.result.current.handleCreateAu());
    expect(createAu).not.toHaveBeenCalled();
  });
});
