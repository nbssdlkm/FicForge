// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * title_generator 边界测试（盲审 2026-07-09：此前零测试——
 * 去引号、超长拒绝、catch→null 兜底、空正文短路均无覆盖）。
 */

import { describe, expect, it } from "vitest";
import { generateChapterTitle } from "../title_generator.js";
import { createMockLLMProvider } from "./mock_llm_provider.js";

describe("generateChapterTitle", () => {
  it("正常路径：返回 trim 后的标题，prompt 带正文片段", async () => {
    const provider = createMockLLMProvider({ content: "  风起长安  " });
    const title = await generateChapterTitle("正文".repeat(100), "zh", provider);
    expect(title).toBe("风起长安");
    expect(provider.calls).toHaveLength(1);
    const prompt = String(provider.calls[0].messages[0].content);
    expect(prompt).toContain("正文");
  });

  it("剥除包裹引号（中英文引号/书名号）", async () => {
    for (const raw of ['"风起长安"', "「风起长安」", "『风起长安』", "'风起长安'"]) {
      const provider = createMockLLMProvider({ content: raw });
      expect(await generateChapterTitle("内容", "zh", provider)).toBe("风起长安");
    }
  });

  it("空正文 / 纯空白正文：不调 LLM 直接 null", async () => {
    const provider = createMockLLMProvider({ content: "不该被用到" });
    expect(await generateChapterTitle("", "zh", provider)).toBeNull();
    expect(await generateChapterTitle("   \n  ", "zh", provider)).toBeNull();
    expect(provider.calls).toHaveLength(0);
  });

  it("LLM 返回空串 / 超过 30 字：拒绝为 null（不落垃圾标题）", async () => {
    expect(await generateChapterTitle("内容", "zh", createMockLLMProvider({ content: "  " }))).toBeNull();
    expect(await generateChapterTitle("内容", "zh", createMockLLMProvider({ content: "字".repeat(31) }))).toBeNull();
    // 恰好 30 字在界内
    expect(await generateChapterTitle("内容", "zh", createMockLLMProvider({ content: "字".repeat(30) }))).toBe(
      "字".repeat(30),
    );
  });

  it("LLM 抛错（网络/超时/key 无效）：兜底 null 不冒泡", async () => {
    const provider = createMockLLMProvider({ error: new Error("ECONNRESET") });
    await expect(generateChapterTitle("内容", "zh", provider)).resolves.toBeNull();
  });

  it("正文只取前 500 字进 prompt", async () => {
    const provider = createMockLLMProvider({ content: "标题" });
    const long = "甲".repeat(600);
    await generateChapterTitle(long, "zh", provider);
    const prompt = String(provider.calls[0].messages[0].content);
    expect(prompt).toContain("甲".repeat(500));
    expect(prompt).not.toContain("甲".repeat(501));
  });

  it("语言路由：en 用英文 prompt", async () => {
    const provider = createMockLLMProvider({ content: "Storm Over the City" });
    await generateChapterTitle("content here", "en", provider);
    const prompt = String(provider.calls[0].messages[0].content);
    expect(prompt).toContain("Give this chapter a title");
  });
});
