// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * useMilestoneGuide（localStorage 里程碑「一次性引导」记忆）单测（R4 测试 L4：此前零测试）。
 *
 * shouldShow / dismiss 各含 try-catch 降级：localStorage 不可用（隐私模式 / 配额）时
 * shouldShow 必须放行（返回 true，宁多显不少显）、dismiss 静默吞错不崩。
 */

import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMilestoneGuide } from "../useMilestoneGuide";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("useMilestoneGuide", () => {
  it("默认未 dismiss → shouldShow=true", () => {
    const { result } = renderHook(() => useMilestoneGuide());
    expect(result.current.shouldShow("m1")).toBe(true);
  });

  it("dismiss 后 → shouldShow=false（落 localStorage），不同 id 互不影响", () => {
    const { result } = renderHook(() => useMilestoneGuide());
    result.current.dismiss("m1");
    expect(result.current.shouldShow("m1")).toBe(false);
    expect(result.current.shouldShow("m2")).toBe(true);
    // 键带前缀命名空间，避免撞其它 localStorage 键。
    expect(localStorage.getItem("ficforge.milestones.m1")).toBe("dismissed");
  });

  it("localStorage.getItem 抛错 → shouldShow 降级 true（不崩）", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage 不可用");
    });
    const { result } = renderHook(() => useMilestoneGuide());
    expect(result.current.shouldShow("m1")).toBe(true);
  });

  it("localStorage.setItem 抛错 → dismiss 静默吞错不抛", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("配额已满");
    });
    const { result } = renderHook(() => useMilestoneGuide());
    expect(() => result.current.dismiss("m1")).not.toThrow();
  });
});
