// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Facts 轻量提取。参见 PRD §6.7。
 * 用户确认章节后，可选让 AI 从新章节中提取事实条目。
 */

import { count_tokens, ensureTokenizer } from "../tokenizer/index.js";
import { getPrompts } from "../prompts/index.js";
import type { LLMProvider } from "../llm/provider.js";

// ---------------------------------------------------------------------------
// 数据结构
// ---------------------------------------------------------------------------

export interface ExtractedFact {
  content_raw: string;
  content_clean: string;
  characters: string[];
  fact_type: string;
  narrative_weight: string;
  status: string;
  chapter: number;
  timeline: string;
  source: string;
}

// ---------------------------------------------------------------------------
// 角色名 + 别名注入
// ---------------------------------------------------------------------------

function buildCharacterInfoBlock(
  cast_registry: { characters?: string[] },
  character_aliases: Record<string, string[]> | null,
  language = "zh",
): string {
  const P = getPrompts(language as "zh" | "en");
  const charNames = cast_registry.characters ?? [];
  if (charNames.length === 0 && !character_aliases) return "";

  const lines: string[] = [P.FACTS_KNOWN_CHARS_HEADER];
  for (const name of charNames) {
    const aliases = character_aliases?.[name] ?? [];
    if (aliases.length > 0) {
      lines.push(P.FACTS_ALIAS_FORMAT.replace("{name}", name).replace("{aliases}", aliases.join(", ")));
    } else {
      lines.push(`- ${name}`);
    }
  }
  lines.push(P.FACTS_USE_MAIN_NAME);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// 构建 user message
// ---------------------------------------------------------------------------

function buildUserMessage(
  chapter_text: string,
  chapter_num: number,
  existing_facts: { content_clean?: string }[],
  cast_registry: { characters?: string[] },
  character_aliases: Record<string, string[]> | null,
  language = "zh",
): string {
  const P = getPrompts(language as "zh" | "en");

  let existingSummary = "";
  if (existing_facts.length > 0) {
    const items = existing_facts.slice(0, 20).map((f) => f.content_clean ?? String(f));
    existingSummary = items.map((item) => `- ${item}`).join("\n");
  }

  const parts = [
    P.FACTS_USER_CHAPTER_INTRO
      .replace("{chapter_num}", String(chapter_num))
      .replace("{chapter_text}", chapter_text),
  ];

  if (existingSummary) {
    parts.push(P.FACTS_USER_EXISTING_HINT.replace("{existing_summary}", existingSummary));
  }

  parts.push(buildCharacterInfoBlock(cast_registry, character_aliases, language));
  parts.push(P.FACTS_USER_EXTRACT_COMMAND);

  return parts.join("");
}

function buildBatchUserMessage(
  chapters: { chapter_num: number; content: string }[],
  existing_facts: { content_clean?: string }[],
  cast_registry: { characters?: string[] },
  character_aliases: Record<string, string[]> | null,
  language = "zh",
): string {
  const P = getPrompts(language as "zh" | "en");

  let existingSummary = "";
  if (existing_facts.length > 0) {
    const items = existing_facts.slice(0, 20).map((f) => f.content_clean ?? String(f));
    existingSummary = items.map((item) => `- ${item}`).join("\n");
  }

  const parts = [P.FACTS_USER_BATCH_INTRO];
  for (const ch of chapters) {
    parts.push(
      P.FACTS_USER_BATCH_CHAPTER
        .replace("{chapter_num}", String(ch.chapter_num))
        .replace("{content}", ch.content),
    );
  }

  if (existingSummary) {
    parts.push(P.FACTS_USER_BATCH_EXISTING_HINT.replace("{existing_summary}", existingSummary));
  }

  parts.push(buildCharacterInfoBlock(cast_registry, character_aliases, language));
  parts.push(P.FACTS_USER_BATCH_COMMAND);

  return parts.join("");
}

// ---------------------------------------------------------------------------
// 解析 LLM 输出
// ---------------------------------------------------------------------------

export function parseLLMOutput(text: string): Record<string, unknown>[] {
  text = text.trim();

  // 剥离 markdown 代码块
  const codeBlock = text.match(/```(?:json)?\s*\n?(.*?)\n?```/s);
  if (codeBlock) {
    text = codeBlock[1].trim();
  }

  try {
    const result = JSON.parse(text);
    if (Array.isArray(result)) return result as Record<string, unknown>[];
    return [];
  } catch {
    // fallback
  }

  // 剥离不完整的 code block markers
  let cleaned = text.replace(/^```(?:json)?\s*\n?/, "").trim();
  cleaned = cleaned.replace(/\n?```\s*$/, "").trim();
  try {
    const result = JSON.parse(cleaned);
    if (Array.isArray(result)) return result as Record<string, unknown>[];
    return [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// 别名归一化（大小写不敏感，适用于 LLM 提取结果）
// ---------------------------------------------------------------------------

function normalizeExtractedCharacters(
  characters: string[],
  character_aliases: Record<string, string[]> | null,
): string[] {
  if (!character_aliases) return characters;

  const aliasMap = new Map<string, string>();
  for (const [mainName, aliases] of Object.entries(character_aliases)) {
    aliasMap.set(mainName.toLowerCase(), mainName);
    for (const alias of aliases) {
      aliasMap.set(alias.toLowerCase(), mainName);
    }
  }

  const result: string[] = [];
  const seen = new Set<string>();
  for (const name of characters) {
    const main = aliasMap.get(name.toLowerCase()) ?? aliasMap.get(name) ?? name;
    if (!seen.has(main)) {
      result.push(main);
      seen.add(main);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// 分块
// ---------------------------------------------------------------------------

function splitTextForExtraction(
  text: string,
  max_tokens: number,
  llm_config: unknown,
): string[] {
  const tc = count_tokens(text, llm_config as { mode?: string });
  if (tc.count <= max_tokens) return [text];

  const paragraphs = text.split("\n");
  const mid = Math.floor(paragraphs.length / 2);

  const chunk1 = paragraphs.slice(0, mid + 2).join("\n");
  const chunk2 = paragraphs.slice(Math.max(0, mid - 2)).join("\n");

  return [chunk1, chunk2];
}

// ---------------------------------------------------------------------------
// raw → ExtractedFact
// ---------------------------------------------------------------------------

function rawToExtracted(
  raw: Record<string, unknown>,
  chapter_num: number,
  character_aliases: Record<string, string[]> | null,
): ExtractedFact | null {
  const contentClean = (raw.content_clean as string) ?? "";
  if (!contentClean || contentClean.length < 5) return null;

  let characters = (raw.characters as string[]) ?? [];
  if (Array.isArray(characters)) {
    characters = normalizeExtractedCharacters(characters, character_aliases);
  }

  return {
    content_raw: (raw.content_raw as string) ?? contentClean,
    content_clean: contentClean,
    characters,
    fact_type: (raw.type as string) ?? (raw.fact_type as string) ?? "plot_event",
    narrative_weight: (raw.narrative_weight as string) ?? "medium",
    status: (raw.status as string) ?? "active",
    chapter: (raw.chapter as number) ?? chapter_num,
    timeline: (raw.timeline as string) ?? "现在线",
    source: "extract_auto",
  };
}

// ---------------------------------------------------------------------------
// 主函数：单章提取
// ---------------------------------------------------------------------------

const MAX_FACTS_PER_CHAPTER = 5;

export interface ExtractFactsOptions {
  max_chunk_tokens?: number;
  language?: string;
  signal?: AbortSignal;
}

export async function extract_facts_from_chapter(
  chapter_text: string,
  chapter_num: number,
  existing_facts: { content_clean?: string }[],
  cast_registry: { characters?: string[] },
  character_aliases: Record<string, string[]> | null,
  llm_provider: LLMProvider,
  llm_config: unknown,
  opts?: ExtractFactsOptions,
): Promise<ExtractedFact[]> {
  const max_chunk_tokens = opts?.max_chunk_tokens ?? 4000;
  const language = opts?.language ?? "zh";
  const signal = opts?.signal;

  await ensureTokenizer();
  const P = getPrompts(language as "zh" | "en");

  if (!chapter_text.trim()) return [];

  const chunks = splitTextForExtraction(chapter_text, max_chunk_tokens, llm_config);
  const allRaw: Record<string, unknown>[] = [];

  for (const chunkText of chunks) {
    if (signal?.aborted) break;

    const messages = [
      { role: "system" as const, content: P.FACTS_SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: buildUserMessage(
          chunkText, chapter_num, existing_facts,
          cast_registry, character_aliases, language,
        ),
      },
    ];

    try {
      const response = await llm_provider.generate({
        messages,
        max_tokens: 2000,
        temperature: 0.3,
        top_p: 0.95,
        signal,
      });
      const parsed = parseLLMOutput(response.content);
      allRaw.push(...parsed);
    } catch {
      // LLM 调用失败，跳过
    }
  }

  const results: ExtractedFact[] = [];
  for (const raw of allRaw) {
    const fact = rawToExtracted(raw, chapter_num, character_aliases);
    if (fact) results.push(fact);
  }

  return results.slice(0, MAX_FACTS_PER_CHAPTER);
}

// ---------------------------------------------------------------------------
// 批量提取
// ---------------------------------------------------------------------------

export async function extract_facts_batch(
  chapters: { chapter_num: number; content: string }[],
  existing_facts: { content_clean?: string }[],
  cast_registry: { characters?: string[] },
  character_aliases: Record<string, string[]> | null,
  llm_provider: LLMProvider,
  language = "zh",
  signal?: AbortSignal,
): Promise<ExtractedFact[]> {
  const P = getPrompts(language as "zh" | "en");

  if (chapters.length === 0) return [];
  if (signal?.aborted) return [];

  const messages = [
    { role: "system" as const, content: P.FACTS_BATCH_SYSTEM_PROMPT },
    {
      role: "user" as const,
      content: buildBatchUserMessage(
        chapters, existing_facts, cast_registry, character_aliases, language,
      ),
    },
  ];

  let allRaw: Record<string, unknown>[];
  try {
    const response = await llm_provider.generate({
      messages,
      max_tokens: 4000,
      temperature: 0.3,
      top_p: 0.95,
      signal,
    });
    allRaw = parseLLMOutput(response.content);
  } catch {
    return [];
  }

  const chapterNums = new Set(chapters.map((ch) => ch.chapter_num));
  const results: ExtractedFact[] = [];
  for (const raw of allRaw) {
    let chNum = (raw.chapter as number) ?? 0;
    if (!chapterNums.has(chNum)) {
      chNum = chapters[chapters.length - 1].chapter_num;
    }
    const fact = rawToExtracted(raw, chNum, character_aliases);
    if (fact) results.push(fact);
  }

  return results;
}
