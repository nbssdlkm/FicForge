// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * isAbortError 是全引擎「取消」分类的单一判据（B1 对抗审 MEDIUM：核心行为变更无回归防线）。
 * 鸭子类型语义是刻意的：跨 realm（webview/worker）抛出的普通对象 {name:"AbortError"}
 * 必须与 DOMException 一致地被识别为取消 —— 谁把它"简化"回 instanceof 判据，这里会红。
 */

import { describe, expect, it } from "vitest";
import { createAbortError, isAbortError } from "../abort_error.js";

describe("isAbortError — 鸭子类型单一判据", () => {
  it("识别 DOMException AbortError（浏览器 fetch abort 形态）", () => {
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
  });

  it("识别 name 被改写为 AbortError 的普通 Error（embedding provider 旧形态）", () => {
    const e = new Error("cancelled");
    e.name = "AbortError";
    expect(isAbortError(e)).toBe(true);
  });

  it("识别跨 realm 的普通对象 {name:'AbortError'}（instanceof 判据识别不了 —— 本次收敛的动机）", () => {
    expect(isAbortError({ name: "AbortError" })).toBe(true);
  });

  it("普通错误 / 非 abort 名 / 原始值一律 false", () => {
    expect(isAbortError(new Error("boom"))).toBe(false);
    expect(isAbortError(new DOMException("x", "TimeoutError"))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
    expect(isAbortError("AbortError")).toBe(false);
    expect(isAbortError({ name: "SomethingElse" })).toBe(false);
  });

  it("createAbortError 的产物被 isAbortError 识别（构造与判据闭环）", () => {
    expect(isAbortError(createAbortError())).toBe(true);
    expect(isAbortError(createAbortError("custom message"))).toBe(true);
    expect(createAbortError().name).toBe("AbortError");
  });
});
