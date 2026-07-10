// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useLibraryOnboardingGate 测试（盲审长期债③：新手引导 vs API 警告的分流门，
 * 此前零测试）。
 *
 * 判据：已完成/已跳过引导 → 只可能弹 API 警告；未完成 → 只可能弹引导。
 * 失败路径不对称：未完成时拉配置失败 fail-open 弹引导（宁可多引导一次），
 * 已完成时拉配置失败静默（不用警告骚扰老用户）。
 */

import { renderHook, waitFor } from "@testing-library/react";
import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useLibraryOnboardingGate } from "../useLibraryOnboardingGate";
import { getSettingsSummary } from "../../../api/engine-client";
import { isOnboardingCompleted, isOnboardingDismissedForSession } from "../../onboarding/OnboardingFlow";

vi.mock("../../../api/engine-client", () => ({
  getSettingsSummary: vi.fn(),
}));

vi.mock("../../onboarding/OnboardingFlow", () => ({
  isOnboardingCompleted: vi.fn(() => false),
  isOnboardingDismissedForSession: vi.fn(() => false),
}));

vi.mock("../../../utils/ui-logger", () => ({
  catchAndLog: vi.fn(() => () => {}),
}));

function summary(hasUsableConnection: boolean) {
  return { default_llm: { has_usable_connection: hasUsableConnection } } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isOnboardingCompleted).mockReturnValue(false);
  vi.mocked(isOnboardingDismissedForSession).mockReturnValue(false);
});

describe("useLibraryOnboardingGate · 未完成引导", () => {
  it("无可用连接：弹引导，不弹 API 警告", async () => {
    vi.mocked(getSettingsSummary).mockResolvedValue(summary(false));
    const { result } = renderHook(() => useLibraryOnboardingGate());

    await waitFor(() => expect(result.current.showOnboarding).toBe(true));
    expect(result.current.showApiWarning).toBe(false);
  });

  it("已有可用连接（老用户新设备）：不打扰", async () => {
    vi.mocked(getSettingsSummary).mockResolvedValue(summary(true));
    const { result } = renderHook(() => useLibraryOnboardingGate());

    await act(async () => {});
    expect(result.current.showOnboarding).toBe(false);
    expect(result.current.showApiWarning).toBe(false);
  });

  it("拉配置失败：fail-open 弹引导（新装环境引擎可能未 ready）", async () => {
    vi.mocked(getSettingsSummary).mockRejectedValue(new Error("engine not ready"));
    const { result } = renderHook(() => useLibraryOnboardingGate());

    await waitFor(() => expect(result.current.showOnboarding).toBe(true));
  });
});

describe("useLibraryOnboardingGate · 已完成/已跳过引导", () => {
  it("已完成 + 无可用连接：弹 API 警告（不再弹引导）；dismiss 后关闭", async () => {
    vi.mocked(isOnboardingCompleted).mockReturnValue(true);
    vi.mocked(getSettingsSummary).mockResolvedValue(summary(false));
    const { result } = renderHook(() => useLibraryOnboardingGate());

    await waitFor(() => expect(result.current.showApiWarning).toBe(true));
    expect(result.current.showOnboarding).toBe(false);

    act(() => result.current.dismissApiWarning());
    expect(result.current.showApiWarning).toBe(false);
  });

  it("本会话跳过引导：与已完成同路径（弹警告不弹引导）", async () => {
    vi.mocked(isOnboardingDismissedForSession).mockReturnValue(true);
    vi.mocked(getSettingsSummary).mockResolvedValue(summary(false));
    const { result } = renderHook(() => useLibraryOnboardingGate());

    await waitFor(() => expect(result.current.showApiWarning).toBe(true));
    expect(result.current.showOnboarding).toBe(false);
  });

  it("已完成 + 有可用连接：全静默", async () => {
    vi.mocked(isOnboardingCompleted).mockReturnValue(true);
    vi.mocked(getSettingsSummary).mockResolvedValue(summary(true));
    const { result } = renderHook(() => useLibraryOnboardingGate());

    await act(async () => {});
    expect(result.current.showApiWarning).toBe(false);
    expect(result.current.showOnboarding).toBe(false);
  });

  it("已完成 + 拉配置失败：静默（catchAndLog 吞掉，不误弹警告）", async () => {
    vi.mocked(isOnboardingCompleted).mockReturnValue(true);
    vi.mocked(getSettingsSummary).mockRejectedValue(new Error("transient"));
    const { result } = renderHook(() => useLibraryOnboardingGate());

    await act(async () => {});
    expect(result.current.showApiWarning).toBe(false);
    expect(result.current.showOnboarding).toBe(false);
  });
});
