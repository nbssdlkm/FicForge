// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 章节切分器。
 * 实现四级切分策略：标准正则 → 数字序列 → LLM 辅助 → 字数兜底。
 * 从原 import_pipeline.ts 搬移核心算法并扩展。
 */

import type { LLMProvider } from "../llm/provider.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SplitChapter {
  chapter_num: number;
  title: string;
  content: string;
}

export interface ChapterPatternResult {
  found: boolean;
  prefix: string;
  number_style: "arabic" | "chinese" | "roman" | "none";
  separator: string;
  suffix: string;
  examples: string[];
}

export interface SplitOptions {
  useAiAssist?: boolean;
  llmProvider?: LLMProvider;
}

export interface SplitResult {
  chapters: SplitChapter[];
  method: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STANDARD_PATTERNS = [
  /^第[一二三四五六七八九十百千\d]+章/mu,
  /^Chapter\s+\d+/imu,
  /^第[一二三四五六七八九十百千\d]+节/mu,
];

const INTEGER_PATTERN = /^\d{1,3}\s*$/gm;

const AUTO_SPLIT_SIZE = 3000;

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * 四级切分策略：
 * 1. 标准正则（第X章 / Chapter N / 第X节）
 * 2. 纯数字序列（1, 2, 3...）
 * 3. LLM 辅助（可选，用户开启 + 提供 provider）
 * 4. 按字数兜底（3000 字）
 */
export async function splitChapters(text: string, options?: SplitOptions): Promise<SplitResult> {
  if (!text.trim()) return { chapters: [], method: "empty" };

  // Priority 1: 标准正则
  const standard = trySplitByStandardHeaders(text);
  if (standard) return { chapters: standard, method: "standard_headers" };

  // Priority 2: 纯数字序列
  const numeric = trySplitByNumericHeaders(text);
  if (numeric) return { chapters: numeric, method: "numeric_headers" };

  // Priority 2.5: LLM 辅助（用户可选）
  if (options?.useAiAssist && options.llmProvider) {
    const pattern = await llmDetectChapterPattern(text, options.llmProvider);
    if (pattern) {
      const regex = buildRegexFromPattern(pattern);
      if (regex) {
        const aiChapters = splitByCustomRegex(text, regex);
        if (aiChapters && aiChapters.length >= 2) {
          return { chapters: aiChapters, method: "ai_detected" };
        }
      }
    }
  }

  // Priority 3: 按字数兜底
  return { chapters: splitByCharCount(text), method: "auto_split" };
}

// ---------------------------------------------------------------------------
// Priority 1: Standard headers
// ---------------------------------------------------------------------------

export function trySplitByStandardHeaders(text: string): SplitChapter[] | null {
  const matches: [number, string][] = [];
  for (const pat of STANDARD_PATTERNS) {
    const re = new RegExp(pat.source, pat.flags.includes("g") ? pat.flags : pat.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      matches.push([m.index, m[0]]);
    }
  }

  if (matches.length === 0) return null;

  // 去重：同一位置只保留第一个匹配
  matches.sort((a, b) => a[0] - b[0]);
  const deduped: [number, string][] = [];
  for (const m of matches) {
    if (deduped.length === 0 || m[0] !== deduped[deduped.length - 1][0]) {
      deduped.push(m);
    }
  }
  const finalMatches = deduped;

  const chapters: SplitChapter[] = [];
  const preContent = text.slice(0, finalMatches[0][0]).trim();

  for (let i = 0; i < finalMatches.length; i++) {
    const [start] = finalMatches[i];
    const lineEnd = text.indexOf("\n", start);
    const fullTitle = lineEnd === -1 ? text.slice(start).trim() : text.slice(start, lineEnd).trim();
    const contentStart = lineEnd === -1 ? text.length : lineEnd + 1;
    const contentEnd = i + 1 < finalMatches.length ? finalMatches[i + 1][0] : text.length;

    let content = text.slice(contentStart, contentEnd).trim();
    if (i === 0 && preContent) {
      content = content ? preContent + "\n\n" + content : preContent;
    }

    chapters.push({ chapter_num: i + 1, title: fullTitle, content });
  }

  return chapters.length > 0 ? chapters : null;
}

// ---------------------------------------------------------------------------
// Priority 2: Numeric headers
// ---------------------------------------------------------------------------

export function trySplitByNumericHeaders(text: string): SplitChapter[] | null {
  const re = new RegExp(INTEGER_PATTERN.source, "gm");
  const matches: [number, string][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    matches.push([m.index, m[0].trim()]);
  }

  if (matches.length < 2) return null;

  const nums = matches.map(([, title]) => Number(title));
  const isSequential = nums.every((n, i) => i === 0 || n === nums[i - 1] + 1);
  if (!isSequential) return null;

  const chapters: SplitChapter[] = [];
  const preContent = text.slice(0, matches[0][0]).trim();

  for (let i = 0; i < matches.length; i++) {
    const [start, titleText] = matches[i];
    const lineEnd = text.indexOf("\n", start);
    const contentStart = lineEnd === -1 ? text.length : lineEnd + 1;
    const contentEnd = i + 1 < matches.length ? matches[i + 1][0] : text.length;

    let content = text.slice(contentStart, contentEnd).trim();
    if (i === 0 && preContent) {
      content = content ? preContent + "\n\n" + content : preContent;
    }

    chapters.push({ chapter_num: i + 1, title: titleText, content });
  }

  return chapters.length > 0 ? chapters : null;
}

// ---------------------------------------------------------------------------
// Priority 2.5: LLM-assisted chapter pattern detection
// ---------------------------------------------------------------------------

/**
 * 用 LLM 检测非标准章节标题格式。
 * 采样前中后各 3000 字，让 LLM 返回结构化 JSON，代码端拼正则。
 */
export async function llmDetectChapterPattern(
  content: string,
  llmProvider: LLMProvider,
): Promise<ChapterPatternResult | null> {
  const sample = extractSamples(content, 3000);

  const prompt = `以下是一篇长文的三个片段（用 === 分隔）。
请分析这篇文章的章节标题格式规律。

用 JSON 回答（只返回 JSON，不要多余文字）：
{
  "found": true或false,
  "prefix": "标题前的固定文本，如 ** 或 ### 或 第",
  "number_style": "arabic 或 chinese 或 roman 或 none",
  "separator": "数字和标题名之间的分隔符，如 . 或 空格 或 章",
  "suffix": "标题后的固定文本，如 ** 或 空字符串",
  "examples": ["匹配到的前3个标题原文"]
}

如果找不到章节标题规律，返回 {"found": false}

===片段1===
${sample.begin}

===片段2===
${sample.middle}

===片段3===
${sample.end}`;

  try {
    const response = await llmProvider.generate({
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 500,
      top_p: 1,
    });

    const cleaned = response.content.trim().replace(/```json\s*|```\s*/g, "");
    const result: ChapterPatternResult = JSON.parse(cleaned);

    if (!result.found) return null;

    // 二次验证：拼出的正则必须能匹配 examples 中的至少 2 个
    const regex = buildRegexFromPattern(result);
    if (!regex) return null;

    let matchCount = 0;
    for (const ex of result.examples) {
      if (regex.test(ex)) matchCount++;
      // reset lastIndex for global regex
      regex.lastIndex = 0;
    }
    if (matchCount < Math.min(2, result.examples.length)) return null;

    return result;
  } catch {
    return null;
  }
}

function extractSamples(content: string, size: number): { begin: string; middle: string; end: string } {
  const len = content.length;
  const begin = content.slice(0, size);
  const middleStart = Math.max(0, Math.floor(len / 2) - Math.floor(size / 2));
  const middle = content.slice(middleStart, middleStart + size);
  const end = content.slice(Math.max(0, len - size));
  return { begin, middle, end };
}

/**
 * 根据 LLM 返回的结构化 pattern 拼接正则。
 * 返回 null 表示无法构建有效正则。
 */
export function buildRegexFromPattern(pattern: ChapterPatternResult): RegExp | null {
  if (!pattern.found) return null;

  // 防护：number_style = "none" 时 prefix 和 suffix 不能同时为空（否则生成 ^.+$）
  if (pattern.number_style === "none" && !pattern.prefix.trim() && !pattern.suffix.trim()) return null;
  // 防护：即使有编号，也需要至少有 prefix 或 suffix 或 separator 来锚定
  if (!pattern.prefix.trim() && !pattern.suffix.trim() && !pattern.separator.trim() && pattern.number_style === "none") return null;

  try {
    const prefix = escapeRegex(pattern.prefix);
    const suffix = escapeRegex(pattern.suffix);
    const sep = escapeRegex(pattern.separator);

    let numberPart: string;
    switch (pattern.number_style) {
      case "arabic": numberPart = "\\d+"; break;
      case "chinese": numberPart = "[一二三四五六七八九十百千万零]+"; break;
      case "roman": numberPart = "[IVXLCDMivxlcdm]+"; break;
      case "none": numberPart = ""; break;
      default: return null;
    }

    // prefix + number + separator + 标题文字（可选） + suffix
    let regexStr: string;
    if (numberPart) {
      // 有编号：prefix + number + separator + 标题文字（可选）+ suffix
      if (suffix) {
        regexStr = `^${prefix}${numberPart}${sep}.+?${suffix}$`;
      } else {
        regexStr = `^${prefix}${numberPart}${sep}.*$`;
      }
    } else {
      // 无编号：prefix + 标题文字 + suffix
      if (suffix) {
        regexStr = `^${prefix}.+?${suffix}$`;
      } else {
        regexStr = `^${prefix}.+$`;
      }
    }

    return new RegExp(regexStr, "gm");
  } catch {
    return null;
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Split by custom regex (used after LLM detection)
// ---------------------------------------------------------------------------

function splitByCustomRegex(text: string, regex: RegExp): SplitChapter[] | null {
  // Reset regex state
  const re = new RegExp(regex.source, regex.flags);
  const matches: [number, string][] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    matches.push([m.index, m[0]]);
  }

  if (matches.length < 2) return null;

  // 密度检查：匹配超过总行数 20% 则正则太宽泛，放弃
  const totalLines = text.split("\n").length;
  if (matches.length > totalLines * 0.2) return null;

  const chapters: SplitChapter[] = [];
  const preContent = text.slice(0, matches[0][0]).trim();

  for (let i = 0; i < matches.length; i++) {
    const [start, matchText] = matches[i];
    const lineEnd = text.indexOf("\n", start);
    const fullTitle = lineEnd === -1 ? text.slice(start).trim() : text.slice(start, lineEnd).trim();
    const contentStart = lineEnd === -1 ? text.length : lineEnd + 1;
    const contentEnd = i + 1 < matches.length ? matches[i + 1][0] : text.length;

    let content = text.slice(contentStart, contentEnd).trim();
    if (i === 0 && preContent) {
      content = content ? preContent + "\n\n" + content : preContent;
    }

    chapters.push({
      chapter_num: i + 1,
      title: fullTitle || matchText,
      content,
    });
  }

  return chapters.length >= 2 ? chapters : null;
}

// ---------------------------------------------------------------------------
// Priority 3: Auto-split by character count
// ---------------------------------------------------------------------------

export function splitByCharCount(text: string, size: number = AUTO_SPLIT_SIZE): SplitChapter[] {
  const stripped = text.trim();
  if (!stripped) return [];

  if (stripped.length <= size) {
    return [{ chapter_num: 1, title: "自动分段 1", content: stripped }];
  }

  const chapters: SplitChapter[] = [];
  let remaining = stripped;
  let segNum = 0;

  while (remaining) {
    segNum++;
    if (remaining.length <= size) {
      chapters.push({ chapter_num: segNum, title: `自动分段 ${segNum}`, content: remaining.trim() });
      break;
    }

    const searchStart = Math.max(0, size - 500);
    const searchEnd = Math.min(remaining.length, size + 500);
    const searchRegion = remaining.slice(searchStart, searchEnd);

    let bestSplit = -1;
    const blankLineMatch = searchRegion.match(/\n\s*\n/);
    if (blankLineMatch && blankLineMatch.index !== undefined) {
      bestSplit = searchStart + blankLineMatch.index + blankLineMatch[0].length;
    }

    if (bestSplit === -1) {
      bestSplit = size;
    }

    const chunk = remaining.slice(0, bestSplit).trim();
    remaining = remaining.slice(bestSplit).trim();
    chapters.push({ chapter_num: segNum, title: `自动分段 ${segNum}`, content: chunk });
  }

  return chapters;
}
