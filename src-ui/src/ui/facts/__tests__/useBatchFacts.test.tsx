// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useBatchFacts 批量状态变更测试（盲审长期债③：批量改 fact 状态是批量
 * 数据变更路径，失败分支此前零测试）。
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useBatchFacts } from "../useBatchFacts";
import { batchUpdateFactStatus, type FactInfo } from "../../../api/engine-client";

vi.mock("../../../api/engine-client", () => ({
  batchUpdateFactStatus: vi.fn(),
}));

const showError = vi.fn();
const showSuccess = vi.fn();
vi.mock("../../../hooks/useFeedback", () => ({
  useFeedback: () => ({ showError, showSuccess, showToast: vi.fn() }),
}));

vi.mock("../../../i18n/useAppTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../i18n/labels", () => ({
  getEnumLabel: (_domain: string, value: string) => value,
}));

const AU = "/data/fandoms/F/aus/A1";

function makeFact(id: string): FactInfo {
  return { id, content_clean: id, characters: [], status: "active", chapter: 1 } as unknown as FactInfo;
}

const FACTS = [makeFact("f1"), makeFact("f2"), makeFact("f3")];

function setup() {
  const onUpdated = vi.fn(async () => {});
  const hook = renderHook(() => useBatchFacts(AU, FACTS, onUpdated));
  return { hook, onUpdated };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(batchUpdateFactStatus).mockResolvedValue({ updated: 2 } as never);
});

describe("useBatchFacts · 选择", () => {
  it("toggleSelect：加选/取消对称", () => {
    const { hook } = setup();
    act(() => hook.result.current.toggleSelect("f1"));
    expect(hook.result.current.selectedIds.has("f1")).toBe(true);
    act(() => hook.result.current.toggleSelect("f1"));
    expect(hook.result.current.selectedIds.has("f1")).toBe(false);
  });

  it("toggleSelectAll：未全选 → 全选；已全选 → 清空", () => {
    const { hook } = setup();
    act(() => hook.result.current.toggleSelectAll());
    expect(hook.result.current.selectedIds.size).toBe(3);
    act(() => hook.result.current.toggleSelectAll());
    expect(hook.result.current.selectedIds.size).toBe(0);
  });
});

describe("useBatchFacts · handleBatchStatus", () => {
  it("成功：批量提交选中 ids → 成功提示 → 清空选择 + 关菜单 + 触发重载", async () => {
    const { hook, onUpdated } = setup();
    act(() => hook.result.current.toggleSelect("f1"));
    act(() => hook.result.current.toggleSelect("f3"));
    act(() => hook.result.current.setBatchMenuOpen(true));

    await act(() => hook.result.current.handleBatchStatus("resolved"));

    expect(batchUpdateFactStatus).toHaveBeenCalledWith(AU, ["f1", "f3"], "resolved");
    expect(showSuccess).toHaveBeenCalled();
    expect(hook.result.current.selectedIds.size).toBe(0);
    expect(hook.result.current.batchMenuOpen).toBe(false);
    expect(onUpdated).toHaveBeenCalledTimes(1);
    expect(hook.result.current.batchProcessing).toBe(false);
  });

  it("失败：showError、选择保留（用户可重试）、不触发重载、processing 复位", async () => {
    vi.mocked(batchUpdateFactStatus).mockRejectedValueOnce(new Error("disk full"));
    const { hook, onUpdated } = setup();
    act(() => hook.result.current.toggleSelect("f2"));

    await act(() => hook.result.current.handleBatchStatus("archived"));

    expect(showError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "disk full" }),
      "error_messages.unknown",
    );
    expect(hook.result.current.selectedIds.has("f2")).toBe(true);
    expect(onUpdated).not.toHaveBeenCalled();
    expect(hook.result.current.batchProcessing).toBe(false);
  });

  it("确认弹窗随提交即刻清空（防重复确认）", async () => {
    const { hook } = setup();
    act(() => hook.result.current.setBatchConfirm("resolved"));
    await act(() => hook.result.current.handleBatchStatus("resolved"));
    expect(hook.result.current.batchConfirm).toBeNull();
  });
});
