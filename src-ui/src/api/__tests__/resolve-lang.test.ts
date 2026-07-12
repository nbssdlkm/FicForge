// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * resolveLang（严格语言归一：非 "en" 一律 "zh"）单测（E2 遗留补测）。
 *
 * 该函数是 API 层「settings.app.language → 语言码」的单一真相源，取代此前散布的
 * `=== "en" ? "en" : "zh"`（严格）与 `|| "zh"`（宽松、非法值漏到 prompt 层）两种口径。
 * 四态：zh / en / 非法值 / 缺失（undefined / null / 无 app / 无 language）。
 */

import { describe, expect, it } from "vitest";
import { resolveLang } from "../resolve-lang";

describe("resolveLang", () => {
  it("language='en' → 'en'", () => {
    expect(resolveLang({ app: { language: "en" } })).toBe("en");
  });

  it("language='zh' → 'zh'", () => {
    expect(resolveLang({ app: { language: "zh" } })).toBe("zh");
  });

  it("非法值（如 'fr' / '' / 大写 'EN'）→ 严格归一为 'zh'", () => {
    expect(resolveLang({ app: { language: "fr" } })).toBe("zh");
    expect(resolveLang({ app: { language: "" } })).toBe("zh");
    expect(resolveLang({ app: { language: "EN" } })).toBe("zh");
  });

  it("缺失（undefined / null / 无 app / 无 language）→ 'zh'", () => {
    expect(resolveLang(undefined)).toBe("zh");
    expect(resolveLang(null)).toBe("zh");
    expect(resolveLang({})).toBe("zh");
    expect(resolveLang({ app: {} })).toBe("zh");
  });
});
