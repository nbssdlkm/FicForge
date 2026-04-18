// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { resolveFontStack, SYSTEM_FONT_ID } from "../stacks.js";
import { SYSTEM_FONT_STACK } from "../manifest.js";

/** Manifest 中已知的字体 id 和对应 family（避免测试和 manifest 改动解耦不一致）。 */
const LATIN_ID = "source-serif-4";
const LATIN_FAMILY = "Source Serif 4";
const CJK_ID = "lxgw-wenkai-screen";
const CJK_FAMILY = "LXGW WenKai Screen";

describe("resolveFontStack — both system", () => {
  it("returns pure SYSTEM_FONT_STACK for ui role", () => {
    expect(resolveFontStack(SYSTEM_FONT_ID, SYSTEM_FONT_ID, "ui")).toBe(SYSTEM_FONT_STACK);
  });

  it("returns pure SYSTEM_FONT_STACK for reading role", () => {
    // reading role + 全 system → 同样是 SYSTEM_FONT_STACK（设计：全 system 走最干净路径）
    expect(resolveFontStack(SYSTEM_FONT_ID, SYSTEM_FONT_ID, "reading")).toBe(SYSTEM_FONT_STACK);
  });
});

describe("resolveFontStack — single font selected", () => {
  it("latin only: latin family first, system fallback after", () => {
    const stack = resolveFontStack(LATIN_ID, SYSTEM_FONT_ID, "ui");
    expect(stack.startsWith(`"${LATIN_FAMILY}"`)).toBe(true);
    expect(stack).toContain(SYSTEM_FONT_STACK);
  });

  it("cjk only: cjk family first, system fallback after", () => {
    const stack = resolveFontStack(SYSTEM_FONT_ID, CJK_ID, "ui");
    expect(stack.startsWith(`"${CJK_FAMILY}"`)).toBe(true);
    expect(stack).toContain(SYSTEM_FONT_STACK);
  });

  it("reading role uses different fallback than ui role", () => {
    const uiStack = resolveFontStack(LATIN_ID, SYSTEM_FONT_ID, "ui");
    const readingStack = resolveFontStack(LATIN_ID, SYSTEM_FONT_ID, "reading");
    expect(uiStack).not.toBe(readingStack);
    // reading fallback 含 serif 相关家族
    expect(readingStack).toContain("serif");
  });
});

describe("resolveFontStack — both fonts selected", () => {
  it("orders latin before cjk before fallback", () => {
    const stack = resolveFontStack(LATIN_ID, CJK_ID, "ui");
    const latinPos = stack.indexOf(`"${LATIN_FAMILY}"`);
    const cjkPos = stack.indexOf(`"${CJK_FAMILY}"`);
    expect(latinPos).toBeGreaterThanOrEqual(0);
    expect(cjkPos).toBeGreaterThanOrEqual(0);
    expect(latinPos).toBeLessThan(cjkPos);
  });

  it("deduplicates when the same font is selected for both slots", () => {
    // 同一个 id 填两边 —— stack 里 family 只应出现 1 次。
    const stack = resolveFontStack(LATIN_ID, LATIN_ID, "ui");
    const matches = stack.match(new RegExp(`"${LATIN_FAMILY}"`, "g"));
    expect(matches?.length ?? 0).toBe(1);
  });
});

describe("resolveFontStack — unknown ids", () => {
  it("unknown latin id is treated as system", () => {
    const stack = resolveFontStack("nonexistent-font", CJK_ID, "ui");
    expect(stack).not.toContain("nonexistent-font");
    expect(stack).toContain(`"${CJK_FAMILY}"`);
  });

  it("unknown cjk id is treated as system", () => {
    const stack = resolveFontStack(LATIN_ID, "nonexistent-font", "ui");
    expect(stack).not.toContain("nonexistent-font");
    expect(stack).toContain(`"${LATIN_FAMILY}"`);
  });

  it("both unknown → fallback (not SYSTEM_FONT_STACK, since ids were not 'system')", () => {
    const stack = resolveFontStack("nope-1", "nope-2", "reading");
    expect(stack).not.toContain("nope-");
    // 没有任何已知 family 加入 stack，走 reading fallback
    expect(stack).toContain("serif");
  });
});
