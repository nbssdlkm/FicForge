// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * AI 章节标题生成器。
 * 当用户定稿时留空标题，调用 LLM 生成短标题。
 */

import type { LLMProvider } from "../llm/provider.js";

const ZH_PROMPT = `请为下面这段小说章节起一个标题。要求：
- 中文，最多10个字
- 不要加引号或标点
- 只输出标题，不要其他内容

章节内容：
`;

const EN_PROMPT = `Give this chapter a title. Requirements:
- English, max 6 words
- No quotes or punctuation
- Output only the title, nothing else

Chapter content:
`;

/**
 * 调用 LLM 为章节生成标题。
 * @param content 章节正文（只取前 500 字）
 * @param language 界面语言（"zh" | "en"）
 * @param provider LLM provider
 * @returns 生成的标题，失败返回 null
 */
export async function generateChapterTitle(
  content: string,
  language: string,
  provider: LLMProvider,
): Promise<string | null> {
  if (!content.trim()) return null;

  const snippet = content.slice(0, 500);
  const prompt = (language === "zh" ? ZH_PROMPT : EN_PROMPT) + snippet;

  try {
    const resp = await provider.generate({
      messages: [{ role: "user", content: prompt }],
      max_tokens: 30,
      temperature: 0.3,
      top_p: 1,
    });

    const title = resp.content?.trim()
      .replace(/^["'"「『]/, "")
      .replace(/["'"」』]$/, "")
      .trim();

    if (!title || title.length > 30) return null;
    return title;
  } catch {
    return null;
  }
}
