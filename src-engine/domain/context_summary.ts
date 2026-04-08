// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** ContextSummary 旁路统计数据结构。参见 D-0031。 */

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
    total_input_tokens: 0,
    truncated_layers: [],
    truncated_characters: [],
    ...partial,
  };
}
