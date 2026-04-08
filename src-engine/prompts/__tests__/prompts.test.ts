// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { getPrompts, REQUIRED_KEYS } from "../index.js";

describe("Prompt templates", () => {
  it("zh module has all required keys", () => {
    const zh = getPrompts("zh");
    for (const key of REQUIRED_KEYS) {
      expect(zh[key], `missing key: ${key}`).toBeDefined();
      expect(typeof zh[key], `key ${key} should be string`).toBe("string");
      expect(zh[key].length, `key ${key} should not be empty`).toBeGreaterThan(0);
    }
  });

  it("en module has all required keys", () => {
    const en = getPrompts("en");
    for (const key of REQUIRED_KEYS) {
      expect(en[key], `missing key: ${key}`).toBeDefined();
      expect(typeof en[key], `key ${key} should be string`).toBe("string");
      expect(en[key].length, `key ${key} should not be empty`).toBeGreaterThan(0);
    }
  });

  it("both modules have exactly the same keys", () => {
    const zh = getPrompts("zh");
    const en = getPrompts("en");
    const zhKeys = Object.keys(zh).sort();
    const enKeys = Object.keys(en).sort();
    expect(zhKeys).toEqual(enKeys);
  });

  it("template placeholders are consistent across languages", () => {
    const zh = getPrompts("zh");
    const en = getPrompts("en");

    // Extract {placeholder} patterns
    const placeholderRe = /\{(\w+)\}/g;

    for (const key of REQUIRED_KEYS) {
      const zhPlaceholders = [...zh[key].matchAll(placeholderRe)].map((m) => m[1]).sort();
      const enPlaceholders = [...en[key].matchAll(placeholderRe)].map((m) => m[1]).sort();
      expect(zhPlaceholders, `placeholders mismatch for ${key}`).toEqual(enPlaceholders);
    }
  });

  // Snapshot tests — ensure templates are not accidentally modified
  it("SYSTEM_NOVELIST zh snapshot", () => {
    const zh = getPrompts("zh");
    expect(zh.SYSTEM_NOVELIST).toBe("你是一位专业的小说作者。");
  });

  it("SYSTEM_NOVELIST en snapshot", () => {
    const en = getPrompts("en");
    expect(en.SYSTEM_NOVELIST).toBe("You are a professional fiction writer.");
  });

  it("total key count is 55", () => {
    expect(REQUIRED_KEYS.length).toBe(55);
  });

  // Critical prompt snapshots — prevent accidental content drift
  it("CONFLICT_RESOLUTION_RULES zh contains \u201c\u201d quotes", () => {
    const zh = getPrompts("zh");
    expect(zh.CONFLICT_RESOLUTION_RULES).toContain("\u201c上一章结尾\u201d");
    expect(zh.CONFLICT_RESOLUTION_RULES).toContain("\u201c当前剧情状态（事实表）\u201d");
  });

  it("GENERIC_RULES zh has chapter_length placeholder", () => {
    const zh = getPrompts("zh");
    expect(zh.GENERIC_RULES).toContain("{chapter_length}");
    expect(zh.GENERIC_RULES).toContain("{chapter_length_max}");
  });

  it("GENERIC_RULES en has chapter_length placeholder", () => {
    const en = getPrompts("en");
    expect(en.GENERIC_RULES).toContain("{chapter_length}");
    expect(en.GENERIC_RULES).toContain("{chapter_length_max}");
  });

  it("FACTS_SYSTEM_PROMPT zh starts with expected text", () => {
    const zh = getPrompts("zh");
    expect(zh.FACTS_SYSTEM_PROMPT).toMatch(/^你是一个专业的同人小说设定分析助手/);
    expect(zh.FACTS_SYSTEM_PROMPT).toContain("数量控制【最高优先级】");
    expect(zh.FACTS_SYSTEM_PROMPT).toContain("只输出 JSON");
  });

  it("FACTS_SYSTEM_PROMPT en starts with expected text", () => {
    const en = getPrompts("en");
    expect(en.FACTS_SYSTEM_PROMPT).toMatch(/^You are a professional fanfiction lore analysis assistant/);
    expect(en.FACTS_SYSTEM_PROMPT).toContain("Quantity control [HIGHEST PRIORITY]");
    expect(en.FACTS_SYSTEM_PROMPT).toContain("Output ONLY JSON");
  });

  it("SETTINGS_AU_SYSTEM_PROMPT has au_name/fandom_name placeholders", () => {
    const zh = getPrompts("zh");
    const en = getPrompts("en");
    expect(zh.SETTINGS_AU_SYSTEM_PROMPT).toContain("{au_name}");
    expect(zh.SETTINGS_AU_SYSTEM_PROMPT).toContain("{fandom_name}");
    expect(en.SETTINGS_AU_SYSTEM_PROMPT).toContain("{au_name}");
    expect(en.SETTINGS_AU_SYSTEM_PROMPT).toContain("{fandom_name}");
  });

  it("CHAPTER_TITLE_PROMPT zh/en have content placeholder", () => {
    const zh = getPrompts("zh");
    const en = getPrompts("en");
    expect(zh.CHAPTER_TITLE_PROMPT).toContain("{content}");
    expect(en.CHAPTER_TITLE_PROMPT).toContain("{content}");
    expect(zh.CHAPTER_TITLE_PROMPT).toContain("中文标题");
    expect(en.CHAPTER_TITLE_PROMPT).toContain("short title");
  });
});
