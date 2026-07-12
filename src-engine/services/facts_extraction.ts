// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Facts 轻量提取。参见 PRD §6.7。
 * 用户确认章节后，可选让 AI 从新章节中提取事实条目。
 */

import { countTokens, ensureTokenizer } from "../tokenizer/index.js";
import { getPrompts } from "../prompts/index.js";
import {
  normalizeCharacters,
  sanitizeKnownTo,
  sanitizeHiddenFrom,
  sanitizeConfidence,
  reconcileKnowledge,
} from "../domain/fact_sanitize.js";
import type { LLMProvider } from "../llm/provider.js";
import { FactType, NarrativeWeight, SuspenseType, TimeKind } from "../domain/enums.js";
import type { FactFieldConfidence } from "../domain/fact.js";
import { logCatch } from "../logger/index.js";
import { isAbortError } from "../utils/abort_error.js";

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

  // M8-A 新增（全部可选；LLM 可不填）
  location?: string | null;
  story_time_tag?: string | null;
  story_time_order?: number | null;
  time_kind?: string | null; // LLM 输出字符串，rawToExtracted 时校验枚举
  action_verb?: string | null;
  caused_by?: string[]; // fact_id 引用；本轮只存，不校验引用有效性
  known_to?: "all" | "reader_only" | string[] | null;
  hidden_from?: string[];
  suspense_type?: string | null; // 同 time_kind
  // M9 新增：自动挂线（ReAct propose_thread_assignment 产出；单次调用路径恒空）。
  // 落库链已通（addFact 读 thread_ids → ops 快照 → dictToFact 还原），UI 端
  // ExtractedFactCandidate.thread_ids + extractedEnrichment 已就位转发。
  thread_ids?: string[];
  _confidence?: FactFieldConfidence;
}

// ---------------------------------------------------------------------------
// 角色名 + 别名注入
// ---------------------------------------------------------------------------

export function buildCharacterInfoBlock(
  cast_registry: { characters?: string[] },
  character_aliases: Record<string, string[]> | null,
  language = "zh",
): string {
  const P = getPrompts(language as "zh" | "en");
  const charNames = cast_registry.characters ?? [];
  // 名单以 cast_registry 为准（用户可在 AU 设置里剔除角色）：registry 为空时即使有
  // 别名表也返回空串——否则渲出「只有表头和指令、零角色名」的残段（别名表接通前
  // 表恒为 null，此边角从未触发过）。
  if (charNames.length === 0) return "";

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
    P.FACTS_USER_CHAPTER_INTRO.replace("{chapter_num}", String(chapter_num)).replace("{chapter_text}", chapter_text),
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
      P.FACTS_USER_BATCH_CHAPTER.replace("{chapter_num}", String(ch.chapter_num)).replace("{content}", ch.content),
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
// 分块
// ---------------------------------------------------------------------------

function splitTextForExtraction(text: string, max_tokens: number, llm_config: unknown): string[] {
  const tc = countTokens(text, llm_config as { mode?: string });
  if (tc.count <= max_tokens) return [text];

  const paragraphs = text.split("\n");
  const mid = Math.floor(paragraphs.length / 2);

  const chunk1 = paragraphs.slice(0, mid + 2).join("\n");
  const chunk2 = paragraphs.slice(Math.max(0, mid - 2)).join("\n");

  return [chunk1, chunk2];
}

// ---------------------------------------------------------------------------
// 枚举集合（rawToExtracted 用于校验 LLM 输出）
// ---------------------------------------------------------------------------

const TIME_KIND_SET = new Set(Object.values(TimeKind) as string[]);
const SUSPENSE_SET = new Set(Object.values(SuspenseType) as string[]);

// ---------------------------------------------------------------------------
// raw → ExtractedFact
// ---------------------------------------------------------------------------

/**
 * 将 LLM 原始 JSON 行转为 ExtractedFact。
 * 已导出供 M8-A 单元测试（T4）直接调用。
 */
export function rawToExtracted(
  raw: Record<string, unknown>,
  chapter_num: number,
  character_aliases: Record<string, string[]> | null,
): ExtractedFact | null {
  const contentClean = (raw.content_clean as string) ?? "";
  if (!contentClean || contentClean.length < 5) return null;

  let characters = (raw.characters as string[]) ?? [];
  if (Array.isArray(characters)) {
    characters = normalizeCharacters(characters, character_aliases);
  }

  // M8-A 新字段
  const timeKindRaw = raw.time_kind as string | undefined;
  const suspenseRaw = raw.suspense_type as string | undefined;

  // known_to / hidden_from / _confidence：单一真相源消毒（domain/fact_sanitize，M3 批一）。
  // LLM 垃圾形状（数字/对象等）→ null / [] / undefined，逐字段容错不退整条。
  const knownToRes = sanitizeKnownTo(raw.known_to, character_aliases);
  const hiddenFromRes = sanitizeHiddenFrom(raw.hidden_from, character_aliases);
  // 跨字段矛盾在提取入口即化解（对抗审 MED-3：LLM 可能同名同标两边）
  const knowledge = reconcileKnowledge(
    knownToRes.ok ? knownToRes.value : null,
    hiddenFromRes.ok ? hiddenFromRes.value : [],
  );
  const confidenceRes = sanitizeConfidence(raw._confidence);

  return {
    content_raw: (raw.content_raw as string) ?? contentClean,
    content_clean: contentClean,
    characters,
    fact_type: (raw.type as string) ?? (raw.fact_type as string) ?? FactType.PLOT_EVENT,
    narrative_weight: (raw.narrative_weight as string) ?? NarrativeWeight.MEDIUM,
    status: (raw.status as string) ?? "active",
    chapter: (raw.chapter as number) ?? chapter_num,
    timeline: (raw.timeline as string) ?? "现在线",
    source: "extract_auto",
    // M8-A 新字段
    location: (raw.location as string | undefined) ?? null,
    story_time_tag: (raw.story_time_tag as string | undefined) ?? null,
    story_time_order: typeof raw.story_time_order === "number" ? raw.story_time_order : null,
    time_kind: timeKindRaw && TIME_KIND_SET.has(timeKindRaw) ? timeKindRaw : null,
    action_verb: (raw.action_verb as string | undefined) ?? null,
    caused_by: Array.isArray(raw.caused_by) ? (raw.caused_by as string[]) : [],
    known_to: knowledge.known_to,
    hidden_from: knowledge.hidden_from,
    suspense_type: suspenseRaw && SUSPENSE_SET.has(suspenseRaw) ? suspenseRaw : null,
    _confidence: confidenceRes.ok ? confidenceRes.value : undefined,
  };
}

// ---------------------------------------------------------------------------
// 主函数：单章提取
// ---------------------------------------------------------------------------

/** LLM prompt 约定每条 chunk 最多返回的 fact 数。仅作安全网，正常情况下 LLM 自限。 */
const MAX_FACTS_PER_CHUNK = 5;

export interface ExtractFactsOptions {
  max_chunk_tokens?: number;
  language?: string;
  signal?: AbortSignal;
}

export async function extractFactsFromChapter(
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
  const allResults: ExtractedFact[] = [];

  for (const chunkText of chunks) {
    if (signal?.aborted) break;

    const messages = [
      { role: "system" as const, content: P.FACTS_ENRICH_SYSTEM_PROMPT },
      {
        role: "user" as const,
        content: buildUserMessage(chunkText, chapter_num, existing_facts, cast_registry, character_aliases, language),
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
      // 每 chunk 独立 cap，防止 LLM 单 chunk 返回过多
      for (const raw of parsed.slice(0, MAX_FACTS_PER_CHUNK)) {
        const fact = rawToExtracted(raw, chapter_num, character_aliases);
        if (fact) allResults.push(fact);
      }
    } catch (err) {
      // LLM 调用失败，跳过该 chunk —— 但不能静默（盲审 R3 M13：与 chapter_summary /
      // retrospective 的 logCatch 纪律一致，否则用户排障看不到「记忆抽取的 LLM 链挂了」）。
      // abort 是用户主动取消，不算错误、不刷日志。
      if (!isAbortError(err)) {
        logCatch("facts_extraction", `chapter ${chapter_num} chunk 抽取 LLM 调用失败，跳过该 chunk`, err);
      }
    }
  }

  // 每 chunk 已由 MAX_FACTS_PER_CHUNK 独立 cap，splitTextForExtraction 最多 2 chunk，
  // 因此总事实数上界 = 2 × 5 = 10，无需额外的总安全网。
  return allResults;
}

// ---------------------------------------------------------------------------
// 批量提取
// ---------------------------------------------------------------------------

export async function extractFactsBatch(
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
      content: buildBatchUserMessage(chapters, existing_facts, cast_registry, character_aliases, language),
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
  } catch (err) {
    // 批量抽取 LLM 失败：返回空但不静默（盲审 R3 M13）。abort 除外。
    if (!isAbortError(err)) {
      logCatch("facts_extraction", "批量事实抽取 LLM 调用失败，返回空", err);
    }
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
