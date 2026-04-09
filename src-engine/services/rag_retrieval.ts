// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * RAG 检索服务。参见 PRD §4.1 P4 RAG 召回。
 * 从向量引擎检索相关设定和历史章节片段，格式化后注入上下文组装器 P4 层。
 */

import { count_tokens } from "../tokenizer/index.js";
import { getPrompts } from "../prompts/index.js";
import type { VectorRepository, SearchResult } from "../repositories/interfaces/vector.js";
import type { EmbeddingProvider } from "../llm/embedding_provider.js";

// ---------------------------------------------------------------------------
// build_rag_query
// ---------------------------------------------------------------------------

export function build_rag_query(
  focus_texts: string[],
  last_scene_ending: string,
  user_input: string,
): string {
  const parts: string[] = [];

  for (const ft of focus_texts) {
    if (ft.trim()) parts.push(ft.trim());
  }

  if (last_scene_ending.trim()) {
    parts.push(last_scene_ending.trim());
  }

  if (user_input.trim()) {
    parts.push(user_input.trim());
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// build_active_chars
// ---------------------------------------------------------------------------

export function build_active_chars(
  state: { current_chapter?: number; characters_last_seen?: Record<string, number>; chapter_focus?: string[] },
  user_input: string,
  project: { core_always_include?: string[] },
  facts: { id: string; characters?: string[] }[],
  cast_registry: { characters?: string[] },
  character_aliases: Record<string, string[]> | null = null,
): string[] | null {
  const chars = new Set<string>();

  // 最近 3 章出场角色
  const current = state.current_chapter ?? 1;
  const lastSeen = state.characters_last_seen ?? {};
  for (const [name, chNum] of Object.entries(lastSeen)) {
    if (current - chNum <= 3) {
      chars.add(name);
    }
  }

  // user_input 中提取已知角色名
  const allNames = new Set<string>(cast_registry.characters ?? []);
  const aliasMap = new Map<string, string>();
  if (character_aliases) {
    for (const [mainName, aliases] of Object.entries(character_aliases)) {
      for (const alias of aliases) {
        aliasMap.set(alias, mainName);
      }
    }
  }

  for (const name of allNames) {
    if (user_input.includes(name)) chars.add(name);
  }
  for (const [alias, mainName] of aliasMap) {
    if (user_input.includes(alias)) chars.add(mainName);
  }

  // chapter_focus 涉及角色
  const focusIds = state.chapter_focus ?? [];
  for (const fact of facts) {
    if (focusIds.includes(fact.id)) {
      for (const chName of fact.characters ?? []) {
        chars.add(chName);
      }
    }
  }

  // 降级链
  if (chars.size === 0) {
    const core = project.core_always_include ?? [];
    for (const c of core) chars.add(c);
  }

  if (chars.size === 0) return null; // 全局检索

  return [...chars].sort();
}

// ---------------------------------------------------------------------------
// retrieve_rag
// ---------------------------------------------------------------------------

interface ChunkWithCollection {
  content: string;
  chapter_num: number;
  score: number;
  metadata: Record<string, unknown>;
  _collection: string;
}

export async function retrieve_rag(
  vector_repo: VectorRepository,
  embedding_provider: EmbeddingProvider,
  au_id: string,
  query: string,
  budget_remaining: number,
  char_filter: string[] | null,
  llm_config: unknown,
  rag_decay_coefficient = 0.05,
  current_chapter = 1,
  language = "zh",
): Promise<[string, number]> {
  if (!query.trim()) return ["", 0];

  // 获取查询向量
  const [queryEmbedding] = await embedding_provider.embed([query]);

  // --- 多 collection 检索 ---
  const collections = ["characters", "worldbuilding"] as const;
  const allChunks: ChunkWithCollection[] = [];

  for (const collName of collections) {
    const chunks = await searchCollection(
      vector_repo, au_id, queryEmbedding, collName, 3, char_filter,
    );
    for (const c of chunks) {
      allChunks.push({ ...c, _collection: collName });
    }
  }

  // chapters collection（带时间衰减）
  const chChunks = await searchCollection(
    vector_repo, au_id, queryEmbedding, "chapters", 3, char_filter,
  );
  const decayedChChunks: ChunkWithCollection[] = [];
  for (const c of chChunks) {
    const chNum = c.chapter_num ?? 0;
    const decay = Math.exp(-rag_decay_coefficient * Math.max(0, current_chapter - chNum));
    decayedChChunks.push({ ...c, score: c.score * decay, _collection: "chapters" });
  }
  // 按衰减后 score 降序排列
  decayedChChunks.sort((a, b) => b.score - a.score);
  allChunks.push(...decayedChChunks);

  // --- 去重 ---
  const seenContent = new Set<string>();
  let deduped: ChunkWithCollection[] = [];
  for (const c of allChunks) {
    if (!seenContent.has(c.content)) {
      seenContent.add(c.content);
      deduped.push(c);
    }
  }

  // --- 超预算处理 ---
  let text = formatRagChunks(deduped, language);
  let tokens = count_tokens(text, llm_config as { mode?: string }).count;

  if (tokens > budget_remaining && budget_remaining > 0) {
    for (const reducedK of [2, 1]) {
      deduped = reduceTopK(deduped, reducedK);
      text = formatRagChunks(deduped, language);
      tokens = count_tokens(text, llm_config as { mode?: string }).count;
      if (tokens <= budget_remaining) break;
    }
  }

  // 仍超预算：按 collection 优先级丢弃
  if (tokens > budget_remaining && budget_remaining > 0) {
    const priority = ["characters", "chapters", "worldbuilding"];
    const kept: ChunkWithCollection[] = [];
    let usedTokens = 0;
    for (const prioColl of priority) {
      for (const c of deduped) {
        if (c._collection === prioColl) {
          const cTokens = count_tokens(c.content, llm_config as { mode?: string }).count;
          if (usedTokens + cTokens <= budget_remaining) {
            kept.push(c);
            usedTokens += cTokens;
          }
        }
      }
    }
    deduped = kept;
    text = formatRagChunks(deduped, language);
    tokens = count_tokens(text, llm_config as { mode?: string }).count;
  }

  return [text, tokens];
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

async function searchCollection(
  vector_repo: VectorRepository,
  au_id: string,
  queryEmbedding: number[],
  collection: "chapters" | "characters" | "worldbuilding",
  top_k: number,
  char_filter: string[] | null,
): Promise<SearchResult[]> {
  let results: SearchResult[];
  try {
    results = await vector_repo.search(au_id, queryEmbedding, {
      collection,
      top_k,
      char_filter,
    });
  } catch {
    results = [];
  }

  // fallback：召回 < 2 条时放宽为全局查询
  if (results.length < 2 && char_filter) {
    try {
      const fallback = await vector_repo.search(au_id, queryEmbedding, {
        collection,
        top_k,
        char_filter: null,
      });
      const existingContent = new Set(results.map((r) => r.content));
      for (const r of fallback) {
        if (!existingContent.has(r.content)) {
          results.push(r);
        }
      }
    } catch {
      // ignore
    }
  }

  return results.slice(0, top_k);
}

function reduceTopK(
  chunks: ChunkWithCollection[],
  maxPerCollection: number,
): ChunkWithCollection[] {
  const counts: Record<string, number> = {};
  const result: ChunkWithCollection[] = [];
  for (const c of chunks) {
    counts[c._collection] = (counts[c._collection] ?? 0) + 1;
    if (counts[c._collection] <= maxPerCollection) {
      result.push(c);
    }
  }
  return result;
}

function formatRagChunks(chunks: ChunkWithCollection[], language = "zh"): string {
  if (chunks.length === 0) return "";

  const P = getPrompts(language as "zh" | "en");
  const groups: Record<string, string[]> = {};
  for (const c of chunks) {
    (groups[c._collection] ??= []).push(c.content);
  }

  const labelMap: Record<string, string> = {
    characters: P.RAG_LABEL_CHARACTERS,
    worldbuilding: P.RAG_LABEL_WORLDBUILDING,
    chapters: P.RAG_LABEL_CHAPTERS,
  };

  const parts: string[] = [];
  for (const coll of ["characters", "worldbuilding", "chapters"]) {
    const items = groups[coll];
    if (items?.length) {
      parts.push(`### ${labelMap[coll] ?? coll}`);
      parts.push(...items);
    }
  }

  return parts.join("\n\n");
}
