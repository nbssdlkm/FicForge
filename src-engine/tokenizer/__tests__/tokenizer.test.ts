// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { clear_tokenizer_cache, count_tokens } from "../index.js";

describe("count_tokens", () => {
  it("empty text returns 0", () => {
    const result = count_tokens("");
    expect(result.count).toBe(0);
    expect(result.is_estimate).toBe(false);
  });

  it("English text tokenization", () => {
    const result = count_tokens("Hello, world! This is a test.");
    expect(result.count).toBeGreaterThan(0);
    expect(result.is_estimate).toBe(false);
  });

  it("Chinese text tokenization", () => {
    const result = count_tokens("你好世界，这是一个测试。");
    expect(result.count).toBeGreaterThan(0);
    expect(result.is_estimate).toBe(false);
  });

  it("long text produces reasonable token count", () => {
    const text = "这是一段测试文本。".repeat(100);
    const result = count_tokens(text);
    expect(result.count).toBeGreaterThan(100);
    expect(result.count).toBeLessThan(1500);
    expect(result.is_estimate).toBe(false);
  });

  it("accepts llm_config parameter", () => {
    const result = count_tokens("test", { mode: "api" });
    expect(result.count).toBeGreaterThan(0);
  });

  it("clear_tokenizer_cache does not throw", () => {
    expect(() => clear_tokenizer_cache()).not.toThrow();
  });
});

describe("cross-language parity: matches Python tiktoken cl100k_base output", () => {
  // Golden values from: python3 -c "from core.domain.tokenizer import count_tokens; ..."
  it("Hello world → 2 tokens", () => {
    expect(count_tokens("Hello world").count).toBe(2);
  });

  it("你好世界 → 5 tokens", () => {
    expect(count_tokens("你好世界").count).toBe(5);
  });

  it("mixed text → 22 tokens", () => {
    expect(count_tokens("FicForge 是面向同人写手的 AI 辅助续写工具。").count).toBe(22);
  });

  it("English sentence → 10 tokens", () => {
    expect(count_tokens("The quick brown fox jumps over the lazy dog.").count).toBe(10);
  });

  it("Chinese chapter title → 11 tokens", () => {
    expect(count_tokens("第一章：黄昏的告别").count).toBe(11);
  });

  it("empty → 0 tokens", () => {
    expect(count_tokens("").count).toBe(0);
  });
});
