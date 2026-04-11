// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, vi } from "vitest";
import {
  splitChapters,
  trySplitByStandardHeaders,
  trySplitByNumericHeaders,
  splitByCharCount,
  buildRegexFromPattern,
  llmDetectChapterPattern,
  type ChapterPatternResult,
} from "../chapter_splitter.js";
import type { LLMProvider } from "../../llm/provider.js";

// ---------------------------------------------------------------------------
// trySplitByStandardHeaders (搬移自原 import_pipeline 测试)
// ---------------------------------------------------------------------------

describe("trySplitByStandardHeaders", () => {
  it("splits by Chinese chapter markers", () => {
    const text = "第一章 黄昏\n内容1\n\n第二章 黎明\n内容2";
    const result = trySplitByStandardHeaders(text);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0].title).toContain("第一章");
    expect(result![0].content).toContain("内容1");
    expect(result![1].title).toContain("第二章");
  });

  it("splits by English Chapter markers", () => {
    const text = "Chapter 1 Introduction\nContent 1\n\nChapter 2 Rising\nContent 2";
    const result = trySplitByStandardHeaders(text);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(2);
    expect(result![0].title).toContain("Chapter 1");
  });

  it("preserves preamble in first chapter", () => {
    const text = "前言内容\n\n第一章 开始\n正文内容";
    const result = trySplitByStandardHeaders(text);
    expect(result![0].content).toContain("前言内容");
  });

  it("returns null for text without standard markers", () => {
    expect(trySplitByStandardHeaders("普通文本内容")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// trySplitByNumericHeaders (搬移自原 import_pipeline 测试)
// ---------------------------------------------------------------------------

describe("trySplitByNumericHeaders", () => {
  it("splits by sequential integer titles", () => {
    const text = "1\n内容一\n\n2\n内容二\n\n3\n内容三";
    const result = trySplitByNumericHeaders(text);
    expect(result).not.toBeNull();
    expect(result).toHaveLength(3);
    expect(result![0].chapter_num).toBe(1);
  });

  it("returns null for non-sequential numbers", () => {
    const text = "1\n内容\n\n5\n内容\n\n9\n内容";
    expect(trySplitByNumericHeaders(text)).toBeNull();
  });

  it("returns null for fewer than 2 matches", () => {
    const text = "1\n内容";
    expect(trySplitByNumericHeaders(text)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// splitByCharCount
// ---------------------------------------------------------------------------

describe("splitByCharCount", () => {
  it("#15: auto-splits long text without titles", () => {
    const text = ("这是一段很长的文本。" + "A".repeat(200) + "\n\n").repeat(20);
    const result = splitByCharCount(text);
    expect(result.length).toBeGreaterThan(1);
    expect(result[0].title).toContain("自动分段");
  });

  it("single short text returns one chapter", () => {
    const result = splitByCharCount("短文本内容。");
    expect(result).toHaveLength(1);
  });

  it("empty text returns empty array", () => {
    expect(splitByCharCount("")).toEqual([]);
    expect(splitByCharCount("   ")).toEqual([]);
  });

  it("respects custom size parameter", () => {
    const text = "A".repeat(1000);
    const result = splitByCharCount(text, 300);
    expect(result.length).toBeGreaterThan(1);
  });
});

// ---------------------------------------------------------------------------
// buildRegexFromPattern
// ---------------------------------------------------------------------------

describe("buildRegexFromPattern", () => {
  it("#12: builds regex for **N.title** pattern", () => {
    const pattern: ChapterPatternResult = {
      found: true,
      prefix: "**",
      number_style: "arabic",
      separator: ".",
      suffix: "**",
      examples: ["**1.黎明前**", "**2.暗流**", "**3.交锋**"],
    };
    const regex = buildRegexFromPattern(pattern);
    expect(regex).not.toBeNull();
    expect(regex!.test("**1.黎明前**")).toBe(true);
    regex!.lastIndex = 0;
    expect(regex!.test("**2.暗流**")).toBe(true);
    regex!.lastIndex = 0;
    expect(regex!.test("普通文本")).toBe(false);
  });

  it("builds regex for ### Title pattern (no number)", () => {
    const pattern: ChapterPatternResult = {
      found: true,
      prefix: "### ",
      number_style: "none",
      separator: "",
      suffix: "",
      examples: ["### Rose and Thorn", "### Broken Wings"],
    };
    const regex = buildRegexFromPattern(pattern);
    expect(regex).not.toBeNull();
    expect(regex!.test("### Rose and Thorn")).toBe(true);
  });

  it("builds regex for Chinese number pattern", () => {
    const pattern: ChapterPatternResult = {
      found: true,
      prefix: "【",
      number_style: "chinese",
      separator: "】",
      suffix: "",
      examples: ["【一】黎明", "【二】暗流"],
    };
    const regex = buildRegexFromPattern(pattern);
    expect(regex).not.toBeNull();
    regex!.lastIndex = 0;
    expect(regex!.test("【一】黎明")).toBe(true);
  });

  it("builds regex for Roman numeral pattern", () => {
    const pattern: ChapterPatternResult = {
      found: true,
      prefix: "",
      number_style: "roman",
      separator: ". ",
      suffix: "",
      examples: ["I. Introduction", "II. Rising Action"],
    };
    const regex = buildRegexFromPattern(pattern);
    expect(regex).not.toBeNull();
    expect(regex!.test("I. Introduction")).toBe(true);
    regex!.lastIndex = 0;
    expect(regex!.test("II. Rising Action")).toBe(true);
  });

  it("returns null for found=false", () => {
    expect(buildRegexFromPattern({ found: false, prefix: "", number_style: "arabic", separator: "", suffix: "", examples: [] })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// splitChapters (integration)
// ---------------------------------------------------------------------------

describe("splitChapters", () => {
  it("#14: standard headers take priority", async () => {
    const text = "第一章 开始\n正文1\n\n第二章 发展\n正文2";
    const result = await splitChapters(text);
    expect(result.method).toBe("standard_headers");
    expect(result.chapters).toHaveLength(2);
  });

  it("numeric headers are second priority", async () => {
    const text = "1\n内容一\n\n2\n内容二\n\n3\n内容三";
    const result = await splitChapters(text);
    expect(result.method).toBe("numeric_headers");
    expect(result.chapters).toHaveLength(3);
  });

  it("falls back to auto_split when no patterns match", async () => {
    const text = ("无标题文本。" + "A".repeat(200) + "\n\n").repeat(20);
    const result = await splitChapters(text);
    expect(result.method).toBe("auto_split");
    expect(result.chapters.length).toBeGreaterThan(1);
  });

  it("empty text returns empty with method=empty", async () => {
    const result = await splitChapters("");
    expect(result.method).toBe("empty");
    expect(result.chapters).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// llmDetectChapterPattern (with mock provider)
// ---------------------------------------------------------------------------

describe("llmDetectChapterPattern", () => {
  it("#12/#13: detects pattern from LLM response", async () => {
    const mockProvider: LLMProvider = {
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          found: true,
          prefix: "**",
          number_style: "arabic",
          separator: ".",
          suffix: "**",
          examples: ["**1.黎明前**", "**2.暗流**", "**3.交锋**"],
        }),
        model: "mock",
        input_tokens: null,
        output_tokens: null,
        finish_reason: "stop",
      }),
      generateStream: vi.fn(),
    };

    const text = "**1.黎明前**\n正文1\n\n**2.暗流**\n正文2\n\n**3.交锋**\n正文3";
    const result = await llmDetectChapterPattern(text, mockProvider);
    expect(result).not.toBeNull();
    expect(result!.found).toBe(true);
    expect(result!.prefix).toBe("**");
  });

  it("returns null when LLM says found=false", async () => {
    const mockProvider: LLMProvider = {
      generate: vi.fn().mockResolvedValue({
        content: '{"found": false}',
        model: "mock",
        input_tokens: null,
        output_tokens: null,
        finish_reason: "stop",
      }),
      generateStream: vi.fn(),
    };

    const result = await llmDetectChapterPattern("some text", mockProvider);
    expect(result).toBeNull();
  });

  it("returns null when LLM returns invalid JSON", async () => {
    const mockProvider: LLMProvider = {
      generate: vi.fn().mockResolvedValue({
        content: "I'm not sure what format this is",
        model: "mock",
        input_tokens: null,
        output_tokens: null,
        finish_reason: "stop",
      }),
      generateStream: vi.fn(),
    };

    const result = await llmDetectChapterPattern("some text", mockProvider);
    expect(result).toBeNull();
  });

  it("returns null when LLM throws error", async () => {
    const mockProvider: LLMProvider = {
      generate: vi.fn().mockRejectedValue(new Error("API error")),
      generateStream: vi.fn(),
    };

    const result = await llmDetectChapterPattern("some text", mockProvider);
    expect(result).toBeNull();
  });

  it("returns null when examples don't match the regex", async () => {
    const mockProvider: LLMProvider = {
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          found: true,
          prefix: "##",
          number_style: "arabic",
          separator: " ",
          suffix: "",
          examples: ["Chapter One", "Chapter Two"], // won't match ##\d+
        }),
        model: "mock",
        input_tokens: null,
        output_tokens: null,
        finish_reason: "stop",
      }),
      generateStream: vi.fn(),
    };

    const result = await llmDetectChapterPattern("some text", mockProvider);
    expect(result).toBeNull();
  });

  it("AI-assisted split integrates with splitChapters", async () => {
    const mockProvider: LLMProvider = {
      generate: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          found: true,
          prefix: "**",
          number_style: "arabic",
          separator: ".",
          suffix: "**",
          examples: ["**1.黎明前**", "**2.暗流**"],
        }),
        model: "mock",
        input_tokens: null,
        output_tokens: null,
        finish_reason: "stop",
      }),
      generateStream: vi.fn(),
    };

    const text = "前言\n\n**1.黎明前**\n正文1\n\n**2.暗流**\n正文2\n\n**3.交锋**\n正文3";
    const result = await splitChapters(text, { useAiAssist: true, llmProvider: mockProvider });
    expect(result.method).toBe("ai_detected");
    expect(result.chapters).toHaveLength(3);
    expect(result.chapters[0].title).toContain("黎明前");
  });
});
