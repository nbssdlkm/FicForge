// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 章节文本切块。参见 PRD §5.2。
 *
 * 切分规则：
 * - frontmatter 剥离（safeMatter，仅剥真章节 frontmatter）
 * - 按段落切（空行或 ## 标题为边界）
 * - 切分点在句号/叹号/问号处
 * - < 100 字合并到相邻段
 * - > 600 字先按句号切分再组合
 * - Overlap 用"最后一整句"
 */

import { KNOWN_CHAPTER_META_KEYS } from "../domain/chapter.js";
import { safeMatter } from "../domain/frontmatter.js";
import { scanCharactersInChapter } from "../domain/character_scanner.js";

/** 切块结果。 */
export interface ChunkData {
  content: string;
  chapter_num: number;
  chunk_index: number;
  branch_id: string;
  characters: string[];
  metadata: Record<string, unknown>;
}

/** 角色名册（与 Project.cast_registry 兼容）。 */
export interface CastRegistryLike {
  characters?: string[];
}

/** 句子结束标点。 */
const SENTENCE_END = /[。！？…\n]/g;

/**
 * 单块「出场角色」标签判据（TD-020：与状态扫描同源 scanCharactersInChapter，
 * 供表后通篇只用别名的文字段也能记到主名）。存量库的 metadata 重扫
 * （RagManager.rescanChunkCharacters）与新建块共用此判据，禁两处各写。
 */
export function scanChunkCharacters(
  content: string,
  cast_registry: CastRegistryLike | null | undefined,
  character_aliases: Record<string, string[]> | null | undefined,
  chapter_num: number,
): string[] {
  if (!cast_registry?.characters?.length) return [];
  return Object.keys(scanCharactersInChapter(content, cast_registry, character_aliases ?? null, chapter_num));
}

/**
 * 将章节文本切块（PRD §5.2）。
 */
export function splitChapterIntoChunks(
  text: string,
  chapter_num: number,
  max_size = 500,
  overlap_sentences = 1,
  cast_registry?: CastRegistryLike | null,
  character_aliases?: Record<string, string[]> | null,
): ChunkData[] {
  // 剥离 frontmatter（审计 B-2）：输入通常已是 content-only 正文（rag_manager 传
  // get_content_only 结果），这里的剥离只是对「误传整文件」的防御。裸 matter()
  // 会把 `---` 开头的首场景吞成 frontmatter（该场景永不进向量索引），非法 YAML
  // 形态则直接抛错（indexChapter 失败）—— safeMatter 只在有真章节 frontmatter
  // 时才剥，其余整文进分块。
  const parsed = safeMatter(text, KNOWN_CHAPTER_META_KEYS);
  const body = parsed.content.trim();

  if (!body) return [];

  // 按段落切（空行或 ## 标题为边界）
  const rawParagraphs = body.split(/\n\s*\n|(?=^##\s)/m);
  const paragraphs = rawParagraphs.map((p) => p.trim()).filter(Boolean);

  // < 100 字合并到相邻段
  const merged = mergeShortParagraphs(paragraphs, 100);

  // > 600 字按句号切分再组合
  const expanded: string[] = [];
  for (const para of merged) {
    if (para.length > 600) {
      expanded.push(...splitLongParagraph(para, max_size));
    } else {
      expanded.push(para);
    }
  }

  // 按 max_size 组合成 chunks
  let chunksText = combineIntoChunks(expanded, max_size);

  // 添加 overlap
  if (overlap_sentences > 0 && chunksText.length > 1) {
    chunksText = addOverlap(chunksText, overlap_sentences);
  }

  // 构建 ChunkData（含逐块角色扫描；判据单源 scanChunkCharacters，认别名）
  return chunksText.map((content, i) => {
    const characters = scanChunkCharacters(content, cast_registry, character_aliases, chapter_num);
    return {
      content,
      chapter_num,
      chunk_index: i,
      branch_id: "main",
      characters,
      metadata: {},
    };
  });
}

function mergeShortParagraphs(paragraphs: string[], minSize: number): string[] {
  if (paragraphs.length === 0) return [];
  const merged = [paragraphs[0]];
  for (let i = 1; i < paragraphs.length; i++) {
    if (merged[merged.length - 1].length < minSize) {
      merged[merged.length - 1] += "\n" + paragraphs[i];
    } else {
      merged.push(paragraphs[i]);
    }
  }
  // 最后一段也可能太短
  if (merged.length > 1 && merged[merged.length - 1].length < minSize) {
    merged[merged.length - 2] += "\n" + merged[merged.length - 1];
    merged.pop();
  }
  return merged;
}

function splitLongParagraph(para: string, maxSize: number): string[] {
  const sentences = splitSentences(para);
  const result: string[] = [];
  let current = "";
  for (const sent of sentences) {
    if (current && current.length + sent.length > maxSize) {
      result.push(current.trim());
      current = sent;
    } else {
      current += sent;
    }
  }
  if (current.trim()) {
    result.push(current.trim());
  }
  return result.length > 0 ? result : [para];
}

function splitSentences(text: string): string[] {
  const parts: string[] = [];
  let last = 0;
  const re = new RegExp(SENTENCE_END.source, "g");
  for (const m of text.matchAll(re)) {
    parts.push(text.slice(last, m.index + m[0].length));
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    parts.push(text.slice(last));
  }
  return parts.filter((p) => p.trim());
}

function combineIntoChunks(paragraphs: string[], maxSize: number): string[] {
  if (paragraphs.length === 0) return [];
  const chunks = [paragraphs[0]];
  for (let i = 1; i < paragraphs.length; i++) {
    if (chunks[chunks.length - 1].length + paragraphs[i].length + 1 <= maxSize) {
      chunks[chunks.length - 1] += "\n" + paragraphs[i];
    } else {
      chunks.push(paragraphs[i]);
    }
  }
  return chunks;
}

function addOverlap(chunks: string[], nSentences: number): string[] {
  const result = [chunks[0]];
  for (let i = 1; i < chunks.length; i++) {
    const prevSentences = splitSentences(chunks[i - 1]);
    const overlap = prevSentences.slice(-nSentences).join("");
    result.push(overlap ? overlap + chunks[i] : chunks[i]);
  }
  return result;
}
