// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 导入流水线。参见 PRD §4.8。
 * 实现三级章节切分策略、格式解析和导入编排。
 */

import { createChapter } from "../domain/chapter.js";
import { scan_characters_in_chapter } from "../domain/character_scanner.js";
import { IndexStatus } from "../domain/enums.js";
import { createOpsEntry } from "../domain/ops_entry.js";
import { createState } from "../domain/state.js";
import { extract_last_scene_ending } from "../domain/text_utils.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import type { OpsRepository } from "../repositories/interfaces/ops.js";
import type { StateRepository } from "../repositories/interfaces/state.js";
import { compute_content_hash, generate_op_id, now_utc } from "../repositories/implementations/file_utils.js";

// ---------------------------------------------------------------------------
// 三级章节切分策略（PRD §4.8）
// ---------------------------------------------------------------------------

const STANDARD_PATTERNS = [
  /^第[一二三四五六七八九十百千\d]+章/mu,
  /^Chapter\s+\d+/imu,
  /^第[一二三四五六七八九十百千\d]+节/mu,
];

const INTEGER_PATTERN = /^\d{1,3}\s*$/gm;

const AUTO_SPLIT_SIZE = 3000;

export interface SplitChapter {
  chapter_num: number;
  title: string;
  content: string;
}

export function split_into_chapters(text: string): SplitChapter[] {
  if (!text.trim()) return [];

  const result = tryStandardSplit(text);
  if (result !== null) return result;

  const intResult = tryIntegerSplit(text);
  if (intResult !== null) return intResult;

  return autoSplit(text);
}

export function get_split_method(text: string): string {
  if (!text.trim()) return "auto_3000";
  if (tryStandardSplit(text) !== null) return "title";
  if (tryIntegerSplit(text) !== null) return "integer";
  return "auto_3000";
}

function tryStandardSplit(text: string): SplitChapter[] | null {
  const matches: [number, string][] = [];
  for (const pat of STANDARD_PATTERNS) {
    const re = new RegExp(pat.source, pat.flags.includes("g") ? pat.flags : pat.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      matches.push([m.index, m[0]]);
    }
  }

  if (matches.length === 0) return null;

  matches.sort((a, b) => a[0] - b[0]);

  const chapters: SplitChapter[] = [];
  const preContent = text.slice(0, matches[0][0]).trim();

  for (let i = 0; i < matches.length; i++) {
    const [start] = matches[i];
    const lineEnd = text.indexOf("\n", start);
    const fullTitle = lineEnd === -1 ? text.slice(start).trim() : text.slice(start, lineEnd).trim();
    const contentStart = lineEnd === -1 ? text.length : lineEnd + 1;
    const contentEnd = i + 1 < matches.length ? matches[i + 1][0] : text.length;

    let content = text.slice(contentStart, contentEnd).trim();
    if (i === 0 && preContent) {
      content = content ? preContent + "\n\n" + content : preContent;
    }

    chapters.push({ chapter_num: i + 1, title: fullTitle, content });
  }

  return chapters.length > 0 ? chapters : null;
}

function tryIntegerSplit(text: string): SplitChapter[] | null {
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

function autoSplit(text: string): SplitChapter[] {
  const stripped = text.trim();
  if (!stripped) return [];

  if (stripped.length <= AUTO_SPLIT_SIZE) {
    return [{ chapter_num: 1, title: "自动分段 1", content: stripped }];
  }

  const chapters: SplitChapter[] = [];
  let remaining = stripped;
  let segNum = 0;

  while (remaining) {
    segNum++;
    if (remaining.length <= AUTO_SPLIT_SIZE) {
      chapters.push({ chapter_num: segNum, title: `自动分段 ${segNum}`, content: remaining.trim() });
      break;
    }

    const searchStart = Math.max(0, AUTO_SPLIT_SIZE - 500);
    const searchEnd = Math.min(remaining.length, AUTO_SPLIT_SIZE + 500);
    const searchRegion = remaining.slice(searchStart, searchEnd);

    let bestSplit = -1;
    const blankLineMatch = searchRegion.match(/\n\s*\n/);
    if (blankLineMatch && blankLineMatch.index !== undefined) {
      bestSplit = searchStart + blankLineMatch.index + blankLineMatch[0].length;
    }

    if (bestSplit === -1) {
      bestSplit = AUTO_SPLIT_SIZE;
    }

    const chunk = remaining.slice(0, bestSplit).trim();
    remaining = remaining.slice(bestSplit).trim();
    chapters.push({ chapter_num: segNum, title: `自动分段 ${segNum}`, content: chunk });
  }

  return chapters;
}

// ---------------------------------------------------------------------------
// 格式解析器
// ---------------------------------------------------------------------------

export function parse_html(raw: string): string {
  // 去除 script/style 标签及内容
  let text = raw.replace(/<(script|style)[^>]*>.*?<\/\1>/gis, "");
  // <br> → 换行
  text = text.replace(/<br\s*\/?>/gi, "\n");
  // </p> </div> </h1-6> → 双换行
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, "\n\n");
  text = text.replace(/<(p|div|h[1-6]|li|tr|blockquote)[^>]*>/gi, "");
  // 去除其他标签
  text = text.replace(/<[^>]+>/g, "");
  // HTML 实体解码（基本实体）
  text = text.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
  // 合并多余空行
  text = text.replace(/\n{3,}/g, "\n\n");
  return text.trim();
}

// ---------------------------------------------------------------------------
// 导入编排
// ---------------------------------------------------------------------------

export interface ImportResult {
  total_chapters: number;
  split_method: string;
  characters_found: string[];
  state_initialized: boolean;
}

export interface ImportChaptersParams {
  au_id: string;
  chapters: SplitChapter[];
  chapter_repo: ChapterRepository;
  state_repo: StateRepository;
  ops_repo: OpsRepository;
  cast_registry?: { characters?: string[] };
  character_aliases?: Record<string, string[]> | null;
  split_method?: string;
}

export async function import_chapters(params: ImportChaptersParams): Promise<ImportResult> {
  const {
    au_id, chapters,
    chapter_repo, state_repo, ops_repo,
    cast_registry = { characters: [] },
    character_aliases = null,
    split_method = "auto_3000",
  } = params;

  const timestamp = now_utc();

  // 步骤 1：写入章节文件
  for (const chData of chapters) {
    const contentHash = await compute_content_hash(chData.content);
    const chapter = createChapter({
      au_id,
      chapter_num: chData.chapter_num,
      content: chData.content,
      chapter_id: `ch_${crypto.randomUUID().slice(0, 8)}`,
      revision: 1,
      confirmed_at: timestamp,
      content_hash: contentHash,
      provenance: "imported",
    });
    await chapter_repo.save(chapter);
  }

  // 步骤 3：全量角色扫描
  const charactersLastSeen: Record<string, number> = {};
  for (const chData of chapters) {
    const scanned = scan_characters_in_chapter(chData.content, cast_registry, character_aliases, chData.chapter_num);
    for (const [name, chNum] of Object.entries(scanned)) {
      if (!(name in charactersLastSeen) || chNum > charactersLastSeen[name]) {
        charactersLastSeen[name] = chNum;
      }
    }
  }

  // 步骤 2：初始化 state.yaml
  const lastChapterNum = chapters.length > 0 ? Math.max(...chapters.map((c) => c.chapter_num)) : 0;
  const lastContent = chapters.length > 0 ? chapters[chapters.length - 1].content : "";
  const lastSceneEnding = extract_last_scene_ending(lastContent, 50);

  const state = createState({
    au_id,
    current_chapter: lastChapterNum + 1,
    last_scene_ending: lastSceneEnding,
    characters_last_seen: charactersLastSeen,
    index_status: IndexStatus.STALE,
  });
  await state_repo.save(state);

  // 步骤 5：写入 ops.jsonl
  await ops_repo.append(au_id, createOpsEntry({
    op_id: generate_op_id(),
    op_type: "import_project",
    target_id: au_id,
    timestamp,
    payload: {
      chapter_range: chapters.length > 0
        ? [Math.min(...chapters.map((c) => c.chapter_num)), lastChapterNum]
        : [0, 0],
      total_chapters: chapters.length,
      characters_found: Object.keys(charactersLastSeen),
      state_snapshot: {
        current_chapter: state.current_chapter,
        last_scene_ending: state.last_scene_ending,
        characters_last_seen: state.characters_last_seen,
      },
    },
  }));

  return {
    total_chapters: chapters.length,
    split_method,
    characters_found: Object.keys(charactersLastSeen),
    state_initialized: true,
  };
}
