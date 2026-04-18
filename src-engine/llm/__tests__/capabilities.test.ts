// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Capabilities 矩阵快照测试 —— 守住 UI/引擎间的能力契约。
 *
 * 规则：
 * - api 所有平台可用
 * - ollama 所有平台可用（移动端/Web 带 hintKey 提示填局域网地址）
 * - local 目前都不可用：桌面标 coming_soon（UI 会渲染但禁用），
 *   移动/Web 标 desktop_only（UI 不渲染）
 */

import { describe, it, expect } from "vitest";
import {
  getGenerationModeAvailability,
  getEmbeddingModeAvailability,
  listGenerationModes,
} from "../capabilities.js";

describe("getGenerationModeAvailability", () => {
  it("Tauri 桌面：api/ollama 可用，local coming_soon", () => {
    const m = getGenerationModeAvailability("tauri");
    expect(m.api.available).toBe(true);
    expect(m.ollama.available).toBe(true);
    expect(m.ollama.hintKey).toBeUndefined();
    expect(m.local.available).toBe(false);
    expect(m.local.reason).toBe("coming_soon");
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
  it("Tauri 返回 api/ollama/local 三项（local 渲染但 disabled）", () => {
    const list = listGenerationModes("tauri");
    expect(list.map((m) => m.mode)).toEqual(["api", "ollama", "local"]);
    expect(list[2].availability.available).toBe(false);
    expect(list[2].availability.reason).toBe("coming_soon");
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
  it("Tauri：api 可用；local 先标 coming_soon（sidecar 消费未接入，见 TD-005）", () => {
    const m = getEmbeddingModeAvailability("tauri");
    expect(m.api.available).toBe(true);
    expect(m.local.available).toBe(false);
    expect(m.local.reason).toBe("coming_soon");
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
