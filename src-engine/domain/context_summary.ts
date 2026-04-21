// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** ContextSummary 旁路统计数据结构。参见 D-0031。 */

/** RAG 支持的 collection 类型。新增时只需更新此列表，类型与 UI 白名单自动对齐。 */
export const RAG_COLLECTIONS = ["chapters", "characters", "worldbuilding"] as const;
export type RagCollection = typeof RAG_COLLECTIONS[number];

export interface RagChunkDetail {
  /** 片段原文。 */
  content: string;
  /** 来源集合类型。 */
  collection: RagCollection;
  /** 相似度分数（0-1，chapters 集合含时间衰减）。 */
  score: number;
  /** 来源章节号（仅 chapters 有意义）。 */
  chapter_num?: number;
  /** 来源文件名（characters / worldbuilding 有意义）。 */
  source_file?: string;
}

export interface ContextSummary {
  /** 被注入 P5 核心设定的角色名列表。 */
  characters_used: string[];
  /** 被注入的世界观文件名列表（P5 + P4 RAG）。 */
  worldbuilding_used: string[];
  /** 注入 P3 的 facts 总条数（active + unresolved）。 */
  facts_injected: number;
  /** chapter_focus 对应的 fact content_clean 前 20 字。 */
  facts_as_focus: string[];
  /** P0 生效的写作底线条数。 */
  pinned_count: number;
  /** P4 RAG 召回的 chunk 数。 */
  rag_chunks_retrieved: number;
  /** P4 RAG 召回的片段详情。 */
  rag_chunks: RagChunkDetail[];
  /** 当前使用的索引可能未包含最新章节。 */
  stale_index?: boolean;
  /** 组装完成后的总输入 token 数。 */
  total_input_tokens: number;
  /** 被截断的层标识列表。 */
  truncated_layers: string[];
  /** 因 P5 预算不足而未注入的角色名列表。 */
  truncated_characters: string[];
}

export function createContextSummary(partial?: Partial<ContextSummary>): ContextSummary {
  return {
    characters_used: [],
    worldbuilding_used: [],
    facts_injected: 0,
    facts_as_focus: [],
    pinned_count: 0,
    rag_chunks_retrieved: 0,
    rag_chunks: [],
    total_input_tokens: 0,
    truncated_layers: [],
    truncated_characters: [],
    ...partial,
  };
}
