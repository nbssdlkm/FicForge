// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * RAG 检索服务。参见 PRD §4.1 P4 RAG 召回。
 * 从向量引擎检索相关设定和历史章节片段，格式化后注入上下文组装器 P4 层。
 */

import { count_tokens, ensure_tokenizer } from "../tokenizer/index.js";
import { getPrompts } from "../prompts/index.js";
import type { VectorRepository, SearchResult } from "../repositories/interfaces/vector.js";
import type { EmbeddingProvider } from "../llm/embedding_provider.js";
import type { RagChunkDetail, RagCollection } from "../domain/context_summary.js";
import { RAG_COLLECTIONS } from "../domain/context_summary.js";
import { FactStatus } from "../domain/enums.js";
import { isColdFact } from "../domain/fact.js";
import { get_context_window } from "../domain/model_context_map.js";
import { DEFAULT_RAG_DECAY_COEFFICIENT } from "../domain/project.js";

// RAG 召回数量配置
// 注：characters / worldbuilding collections 当前不被 indexer 写入（lore 走 P5 直读），
//    保持低值；chapters 是唯一真实出 chunk 的 collection。
const CHARACTERS_TOP_K = 3;
const WORLDBUILDING_TOP_K = 3;
const CHAPTERS_TOP_K = 8;
const SUMMARIES_TOP_K = 4;

// ---------------------------------------------------------------------------
// build_rag_query
// ---------------------------------------------------------------------------

export function build_rag_query(focus_texts: string[], last_scene_ending: string, user_input: string): string {
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
  facts: { id: string; characters?: string[]; archived?: boolean }[],
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

  // chapter_focus 涉及角色。审计⑥：已归档冷 fact 即便还挂在 focus，也不把其角色带进 RAG
  // 角色过滤器（与 focusTexts 同源 isColdFact），否则冷 fact 的角色仍会把召回拉向冷线。
  const focusIds = state.chapter_focus ?? [];
  for (const fact of facts) {
    if (focusIds.includes(fact.id) && !isColdFact(fact)) {
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

export interface ChunkWithCollection {
  content: string;
  chapter_num: number;
  score: number;
  metadata: Record<string, unknown>;
  _collection: string;
}

/**
 * 把 RAG 检索内部 chunk 转成 summary 对外的 RagChunkDetail。
 * 在此集中：合法 collection 校验、chapter_num 正数 guard、source_file 非空 guard。
 * 非法 collection 的 chunk 返回 null（UI 层 normalize 也有同类守卫，此处是源头）。
 */
export function to_rag_chunk_detail(c: ChunkWithCollection): RagChunkDetail | null {
  if (!RAG_COLLECTIONS.includes(c._collection as RagCollection)) return null;
  const detail: RagChunkDetail = {
    content: c.content,
    collection: c._collection as RagCollection,
    score: c.score,
  };
  if ((c._collection === "chapters" || c._collection === "summaries") && c.chapter_num > 0) {
    detail.chapter_num = c.chapter_num;
  }
  const srcFile = c.metadata?.source_file;
  if (typeof srcFile === "string" && srcFile) {
    detail.source_file = srcFile;
  }
  return detail;
}

/**
 * 时间衰减 + 衰减后降序（chapters/summaries 共用；衰减公式单点维护——R4 重复维 L1）。
 * 衰减后必须重排序：否则保持 cosine 序，预算裁剪 reduce_top_k 可能留旧弃新（codex 对抗审）。
 * skip 谓词由调用方给（summaries 排除 current-1，理由见调用点注释）。
 */
function decayAndSortByRecency(
  chunks: Omit<ChunkWithCollection, "_collection">[],
  collection: "chapters" | "summaries",
  current_chapter: number,
  coefficient: number,
  skip?: (chapterNum: number) => boolean,
): ChunkWithCollection[] {
  const decayed: ChunkWithCollection[] = [];
  for (const c of chunks) {
    const chNum = c.chapter_num ?? 0;
    if (skip?.(chNum)) continue;
    const decay = Math.exp(-coefficient * Math.max(0, current_chapter - chNum));
    decayed.push({ ...c, score: c.score * decay, _collection: collection });
  }
  decayed.sort((a, b) => b.score - a.score);
  return decayed;
}

export async function retrieve_rag(
  vector_repo: VectorRepository,
  embedding_provider: EmbeddingProvider,
  au_id: string,
  query: string,
  budget_remaining: number,
  char_filter: string[] | null,
  llm_config: unknown,
  rag_decay_coefficient = DEFAULT_RAG_DECAY_COEFFICIENT,
  current_chapter = 1,
  language = "zh",
): Promise<[string, number, ChunkWithCollection[]]> {
  await ensure_tokenizer();
  if (!query.trim()) return ["", 0, []];

  // 获取查询向量
  const [queryEmbedding] = await embedding_provider.embed([query]);

  // --- 多 collection 检索 ---
  const collections = ["characters", "worldbuilding"] as const;
  const allChunks: ChunkWithCollection[] = [];

  for (const collName of collections) {
    const topK = collName === "characters" ? CHARACTERS_TOP_K : WORLDBUILDING_TOP_K;
    const chunks = await search_collection(vector_repo, au_id, queryEmbedding, collName, topK, char_filter);
    for (const c of chunks) {
      allChunks.push({ ...c, _collection: collName });
    }
  }

  // chapters collection（带时间衰减）
  const chChunks = await search_collection(vector_repo, au_id, queryEmbedding, "chapters", CHAPTERS_TOP_K, char_filter);
  allChunks.push(...decayAndSortByRecency(chChunks, "chapters", current_chapter, rag_decay_coefficient));

  // summaries collection（M8-C，带时间衰减）。
  // 决策③ + codex MAJOR4：排除"最近已确认章 current-1"（其全文已在 P2，避免同章既全文又摘要）。
  // retrieve_rag 收到的 current_chapter 是"待写章"，P2 注入的是 current-1，故排除 chNum >= current-1。
  // 摘要是整章级、非角色作用域，且其 chunk 无 characters metadata：若传 char_filter，
  // 主查询必返 0 再触发兜底全局查询 = 每次双查（codex workflow 审）。直接传 null 走单查询。
  const sumChunks = await search_collection(vector_repo, au_id, queryEmbedding, "summaries", SUMMARIES_TOP_K, null);
  allChunks.push(
    ...decayAndSortByRecency(
      sumChunks,
      "summaries",
      current_chapter,
      rag_decay_coefficient,
      // 排除"最近已确认章 current-1"（全文已在 P2，避免同章既全文又摘要）——见上方决策注释
      (chNum) => chNum >= current_chapter - 1,
    ),
  );

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
  let text = format_rag_chunks(deduped, language);
  let tokens = count_tokens(text, llm_config as { mode?: string }).count;

  if (tokens > budget_remaining && budget_remaining > 0) {
    for (const reducedK of [2, 1]) {
      deduped = reduce_top_k(deduped, reducedK);
      text = format_rag_chunks(deduped, language);
      tokens = count_tokens(text, llm_config as { mode?: string }).count;
      if (tokens <= budget_remaining) break;
    }
  }

  // 仍超预算：按 collection 优先级丢弃
  if (tokens > budget_remaining && budget_remaining > 0) {
    const priority = ["characters", "summaries", "chapters", "worldbuilding"];
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
    text = format_rag_chunks(deduped, language);
    tokens = count_tokens(text, llm_config as { mode?: string }).count;
  }

  return [text, tokens, deduped];
}

// ---------------------------------------------------------------------------
// 辅助
// ---------------------------------------------------------------------------

async function search_collection(
  vector_repo: VectorRepository,
  au_id: string,
  queryEmbedding: number[],
  collection: RagCollection,
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

function reduce_top_k(chunks: ChunkWithCollection[], maxPerCollection: number): ChunkWithCollection[] {
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

function format_rag_chunks(chunks: ChunkWithCollection[], language = "zh"): string {
  if (chunks.length === 0) return "";

  const P = getPrompts(language as "zh" | "en");
  const groups: Record<string, string[]> = {};
  for (const c of chunks) {
    groups[c._collection] ??= [];
    groups[c._collection].push(c.content);
  }

  const labelMap: Record<string, string> = {
    characters: P.RAG_LABEL_CHARACTERS,
    worldbuilding: P.RAG_LABEL_WORLDBUILDING,
    summaries: P.RAG_LABEL_SUMMARIES,
    chapters: P.RAG_LABEL_CHAPTERS,
  };

  const parts: string[] = [];
  for (const coll of ["characters", "worldbuilding", "summaries", "chapters"]) {
    const items = groups[coll];
    if (items?.length) {
      parts.push(`### ${labelMap[coll] ?? coll}`);
      parts.push(...items);
    }
  }

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// retrieve_rag_for_context —— RAG 检索编排(单一真相源)
// ---------------------------------------------------------------------------
//
// 把「build_active_chars → focusTexts → build_rag_query → retrieve_rag」这套编排
// 从 generation.ts 抽出,已 export 并接入 services barrel。当前 caller = generate_chapter
// (写文路径);融合后续步骤(plan §1.1-1.3)对话路径(simple_chat_dispatch)复用本函数 ——
// 目的是杜绝两套手工维护的 RAG 编排漂移(单一真相源)。
//
// 行为与原 generation.ts:218-244 内联块逐字节等价:空 query → 不检索;retrieve_rag
// 抛错 → 静默回退(RAG 失败不中断生成)。调用方负责 gate(rag_text 已有 / repo 就位)。
export interface RetrieveRagForContextArgs {
  project: {
    cast_registry?: { characters?: string[] };
    core_always_include?: string[];
    llm?: { context_window?: number; model?: string };
    rag_decay_coefficient?: number;
  };
  state: {
    current_chapter?: number;
    characters_last_seen?: Record<string, number>;
    chapter_focus?: string[];
    last_scene_ending?: string;
  };
  user_input: string;
  facts: { id: string; status: string; content_clean: string; characters?: string[]; archived?: boolean }[];
  vector_repo: VectorRepository;
  embedding_provider: EmbeddingProvider;
  au_id: string;
  llm_config: unknown;
  language?: string;
  /**
   * H4：实际生效 LLM 视图（resolve_llm_config 结果，{model, context_window} 足够）。
   * ragBudget（≈ctx/4）按它算窗口；可选 + 缺省回退 project.llm —— 旧调用方不传时
   * 行为不变（向后兼容硬约束）。
   */
  effective_llm?: { model?: string; context_window?: number } | null;
  /**
   * E8：角色别名表（主名 → 别名列表）。透传给 build_active_chars —— 正文/用户输入只出现别名
   * 时也能把主名带进活跃角色过滤集，与提取/扫描侧同一张表同一归一化语义。可选 + 缺省 null：
   * 旧调用方 / 无角色卡的 AU 不传时，char_filter 行为与接通前逐字节一致（向后兼容硬约束）。
   */
  character_aliases?: Record<string, string[]> | null;
}

export async function retrieve_rag_for_context(
  args: RetrieveRagForContextArgs,
): Promise<{ ragText: string | null; chunks: ChunkWithCollection[] }> {
  const {
    project,
    state,
    user_input,
    facts,
    vector_repo,
    embedding_provider,
    au_id,
    llm_config,
    language = "zh",
    effective_llm = null,
    character_aliases = null,
  } = args;
  try {
    const castReg = project.cast_registry ?? { characters: [] };
    // E8：别名表透传 build_active_chars —— 正文只出现别名时主名也进 char_filter（缺省 null = 现状）。
    const activeChars = build_active_chars(state, user_input, project, facts, castReg, character_aliases);
    // 审计⑥：已归档冷 fact 的 content_clean 不进 RAG 检索 query，避免把召回拉向本应冷藏的旧线
    // （与 build_facts_layer / FOCUS_GOAL 同用 isColdFact 单一真相源）。
    const focusTexts = facts
      .filter((f) => f.status === FactStatus.ACTIVE && !isColdFact(f))
      .map((f) => f.content_clean);
    const lastEnding = state.last_scene_ending ?? "";
    const query = build_rag_query(focusTexts, lastEnding, user_input);
    if (!query) return { ragText: null, chunks: [] };

    // 用 get_context_window(支持 context_window=0 自动按 model 推断),与 context_assembler 同源;
    // 原内联块写死 `|| 128000`,在 context_window=0 + 大上下文模型时会把预算算小(审计 R2 修)。
    // H4：给了 effective 视图则按实际生效模型算窗口（缺省回退 project.llm，向后兼容）。
    const ragBudget = Math.max(0, Math.trunc(get_context_window(effective_llm ? { llm: effective_llm } : project) / 4));
    const [ragResult, , chunks] = await retrieve_rag(
      vector_repo,
      embedding_provider,
      au_id,
      query,
      ragBudget,
      activeChars,
      llm_config,
      project.rag_decay_coefficient ?? DEFAULT_RAG_DECAY_COEFFICIENT,
      state.current_chapter ?? 1,
      language,
    );
    if (ragResult) return { ragText: ragResult, chunks };
    return { ragText: null, chunks: [] };
  } catch {
    // RAG 失败不中断生成(与原内联块一致)
    return { ragText: null, chunks: [] };
  }
}
