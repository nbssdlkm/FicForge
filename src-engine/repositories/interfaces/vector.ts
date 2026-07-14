// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** VectorRepository 抽象接口。参见 PRD §2.6.2。 */

import type { IndexStatus } from "../../domain/enums.js";
import type { RagCollection } from "../../domain/context_summary.js";

/** 向量化后的 chunk 数据（含 embedding）。 */
export interface VectorChunk {
  id: string;
  collection: RagCollection;
  content: string;
  embedding: number[];
  metadata: {
    au_id: string;
    chapter?: number;
    // chunk_index / branch_id 仅 chapters chunk 有；summaries 这类整章单向量无此概念，故可选。
    chunk_index?: number;
    branch_id?: string;
    characters?: string;
    source_file?: string;
    kind?: string;
  };
}

export interface SearchOptions {
  collection: RagCollection;
  top_k: number;
  char_filter?: string[] | null;
}

export interface SearchResult {
  content: string;
  chapter_num: number;
  score: number;
  metadata: Record<string, unknown>;
}

export interface VectorRepository {
  /** 将 chunks 写入向量索引。 */
  indexChunks(chunks: VectorChunk[]): Promise<void>;

  /** 向量检索，返回最相关的文本片段。 */
  search(au_id: string, query_embedding: number[], options: SearchOptions): Promise<SearchResult[]>;

  /**
   * 删除指定章节的向量索引。
   * collection 省略时删该章在所有 collection 的向量（正文 chunks + 摘要向量）；
   * 指定时只删该 collection（如重索引正文前只清 chapters，保留仍有效的 sum{N}）。
   */
  deleteByChapter(au_id: string, chapter_num: number, collection?: RagCollection): Promise<void>;

  /** 删除指定来源文件的向量索引。 */
  deleteBySource(au_id: string, source_file: string): Promise<void>;

  /** 获取索引状态。 */
  getIndexStatus(au_id: string): Promise<IndexStatus>;
}
