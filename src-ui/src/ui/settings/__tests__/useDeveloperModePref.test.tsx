// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useDeveloperModePref 回归测试（2026-09-09 实测抓获的真 bug）：
 * 弹窗常驻挂载，关闭状态下挂载时机 settings=null —— hydrate 若照常
 * setDebugCaptureEnabled(isDeveloperMode(null)=false)，会把 bootstrap 刚
 * 同步的引擎捕获开关误关（用户视角：开关持久化是开的，但捕获永远不工作）。
 * 判据：settings 未加载（null）时绝不碰引擎开关；加载后才同步真实值。
 */

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isDebugCaptureEnabled, setDebugCaptureEnabled } from "@ficforge/engine";
import { useDeveloperModePref } from "../useDeveloperModePref";
import type { SettingsInfo } from "../../../api/engine-client";

vi.mock("../../../api/engine-client", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../api/engine-client")>();
  return { ...original, saveAppPreferences: vi.fn(async () => {}) };
});

vi.mock("../../../hooks/useFeedback", () => ({
  useFeedback: () => ({ showError: vi.fn(), showToast: vi.fn(), showSuccess: vi.fn() }),
}));

function makeSettings(developerMode: boolean): SettingsInfo {
  return { app: { developer_mode: developerMode } } as unknown as SettingsInfo;
}

describe("useDeveloperModePref", () => {
  beforeEach(() => {
    setDebugCaptureEnabled(false);
  });

  it("settings=null 挂载时不碰引擎开关（回归：不覆盖 bootstrap 同步的 true）", () => {
    setDebugCaptureEnabled(true); // 模拟 bootstrap 已按持久化 settings 同步为开
    renderHook(() => useDeveloperModePref(true, null, 0));
    expect(isDebugCaptureEnabled()).toBe(true); // 挂载后仍是 true，未被 null 误判覆盖
  });

  it("settings 加载后 hydrate：dev mode on → 引擎开关开；off → 关", () => {
    const { result, rerender } = renderHook(
      ({ settings, loadKey }: { settings: SettingsInfo | null; loadKey: number }) =>
        useDeveloperModePref(true, settings, loadKey),
      { initialProps: { settings: null, loadKey: 0 } },
    );
    expect(result.current.enabled).toBe(false);

    rerender({ settings: makeSettings(true), loadKey: 1 });
    expect(result.current.enabled).toBe(true);
    expect(isDebugCaptureEnabled()).toBe(true);

    rerender({ settings: makeSettings(false), loadKey: 2 });
    expect(result.current.enabled).toBe(false);
    expect(isDebugCaptureEnabled()).toBe(false);
  });
});
