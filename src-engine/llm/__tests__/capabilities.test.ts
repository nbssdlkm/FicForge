// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Capabilities 矩阵快照测试 —— 守住 UI/引擎间的能力契约。
 *
 * 规则：
 * - api 所有平台可用
 * - ollama 所有平台可用（移动端/Web 带 hintKey 提示填局域网地址）
 * - local 三端都不可用：sidecar 退役后桌面标 platform_unsupported（UI 不渲染），
 *   移动/Web 标 desktop_only（UI 不渲染）。本地模型走 ollama。
 */

import { describe, it, expect } from "vitest";
import {
  getGenerationModeAvailability,
  getEmbeddingModeAvailability,
  listGenerationModes,
} from "../capabilities.js";

describe("getGenerationModeAvailability", () => {
  it("Tauri 桌面：api/ollama 可用，local platform_unsupported（sidecar 退役）", () => {
    const m = getGenerationModeAvailability("tauri");
    expect(m.api.available).toBe(true);
    expect(m.ollama.available).toBe(true);
    expect(m.ollama.hintKey).toBeUndefined();
    expect(m.local.available).toBe(false);
    expect(m.local.reason).toBe("platform_unsupported");
  });

  it("Capacitor 移动端：api/ollama 可用（ollama 带远程提示），local desktop_only", () => {
    const m = getGenerationModeAvailability("capacitor");
    expect(m.api.available).toBe(true);
    expect(m.ollama.available).toBe(true);
    expect(m.ollama.hintKey).toBe("settings.ollama.mobileRemoteHint");
    expect(m.local.available).toBe(false);
    expect(m.local.reason).toBe("desktop_only");
  });

  it("Web：api/ollama 可用，local desktop_only", () => {
    const m = getGenerationModeAvailability("web");
    expect(m.api.available).toBe(true);
    expect(m.ollama.available).toBe(true);
    expect(m.ollama.hintKey).toBe("settings.ollama.mobileRemoteHint");
    expect(m.local.available).toBe(false);
    expect(m.local.reason).toBe("desktop_only");
  });
});

describe("listGenerationModes", () => {
  it("Tauri 不渲染 local（sidecar 退役后 platform_unsupported）", () => {
    const list = listGenerationModes("tauri");
    expect(list.map((m) => m.mode)).toEqual(["api", "ollama"]);
  });

  it("Capacitor 不渲染 local（desktop_only）", () => {
    const list = listGenerationModes("capacitor");
    expect(list.map((m) => m.mode)).toEqual(["api", "ollama"]);
  });

  it("Web 不渲染 local（desktop_only）", () => {
    const list = listGenerationModes("web");
    expect(list.map((m) => m.mode)).toEqual(["api", "ollama"]);
  });
});

describe("getEmbeddingModeAvailability", () => {
  it("Tauri：api 可用；local platform_unsupported（sidecar 退役，embedding 走云端）", () => {
    const m = getEmbeddingModeAvailability("tauri");
    expect(m.api.available).toBe(true);
    expect(m.local.available).toBe(false);
    expect(m.local.reason).toBe("platform_unsupported");
  });

  it("移动端 / Web：只支持 api（Python 运行时不可用）", () => {
    for (const p of ["capacitor", "web"] as const) {
      const m = getEmbeddingModeAvailability(p);
      expect(m.api.available).toBe(true);
      expect(m.local.available).toBe(false);
      expect(m.local.reason).toBe("desktop_only");
    }
  });
});
