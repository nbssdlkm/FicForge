// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useLibraryData（合集列表加载 + 失败降级）单测（R4 测试 L4：此前零测试）。
 *
 * loadFandoms 成功 → 填 fandoms、loading=false；失败 → showError 提示、loading=false、
 * fandoms 不动（保留旧值，不被清空）。dogfood 共享 mock 工厂（test/mocks/feedback + i18n）。
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLibraryData } from "../useLibraryData";
import { listFandoms } from "../../api/engine-client";
import { feedbackMock } from "../../test/mocks/feedback";

vi.mock("../../api/engine-client", () => ({ listFandoms: vi.fn() }));
vi.mock("../useFeedback", async () => (await import("../../test/mocks/feedback")).mockUseFeedback());
vi.mock("../../i18n/useAppTranslation", async () => (await import("../../test/mocks/i18n")).mockUseAppTranslation());

beforeEach(() => {
  vi.clearAllMocks();
});

describe("useLibraryData", () => {
  it("初始态：loading=true、fandoms=[]（不自动加载）", () => {
    const { result } = renderHook(() => useLibraryData());
    expect(result.current.loading).toBe(true);
    expect(result.current.fandoms).toEqual([]);
    expect(listFandoms).not.toHaveBeenCalled();
  });

  it("loadFandoms 成功 → 填充 fandoms + loading=false", async () => {
    vi.mocked(listFandoms).mockResolvedValue([{ name: "原创", dir_name: "yuanchuang" }] as never);
    const { result } = renderHook(() => useLibraryData());
    await act(async () => {
      await result.current.loadFandoms();
    });
    expect(result.current.fandoms).toEqual([{ name: "原创", dir_name: "yuanchuang" }]);
    expect(result.current.loading).toBe(false);
    expect(feedbackMock.showError).not.toHaveBeenCalled();
  });

  it("loadFandoms 失败 → showError + loading=false + fandoms 不动", async () => {
    vi.mocked(listFandoms).mockRejectedValue(new Error("读盘失败"));
    const { result } = renderHook(() => useLibraryData());
    await act(async () => {
      await result.current.loadFandoms();
    });
    expect(feedbackMock.showError).toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.fandoms).toEqual([]);
  });
});
