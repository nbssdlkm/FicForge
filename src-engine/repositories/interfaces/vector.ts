// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** VectorRepository 抽象接口。参见 PRD §2.6.2。 */

import type { IndexStatus } from "../../domain/enums.js";

/** 向量化后的 chunk 数据（含 embedding）。 */
export interface VectorChunk {
  id: string;
  collection: "chapters" | "characters" | "worldbuilding";
  content: string;
  embedding: number[];
  metadata: {
    au_id: string;
    chapter?: number;
    chunk_index: number;
    branch_id: string;
    characters?: string;
    source_file?: string;
  };
}

export interface SearchOptions {
  collection: "chapters" | "characters" | "worldbuilding";
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
  index_chunks(chunks: VectorChunk[]): Promise<void>;

  /** 向量检索，返回最相关的文本片段。 */
  search(au_id: string, query_embedding: number[], options: SearchOptions): Promise<SearchResult[]>;

  /** 删除指定章节的向量索引。 */
  delete_by_chapter(au_id: string, chapter_num: number): Promise<void>;

  /** 删除指定来源文件的向量索引。 */
  delete_by_source(au_id: string, source_file: string): Promise<void>;

  /** 重建 AU 的全部向量索引。 */
  rebuild_index(au_id: string): Promise<void>;

  /** 获取索引状态。 */
  get_index_status(au_id: string): Promise<IndexStatus>;
}
