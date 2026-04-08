// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 内存向量检索引擎（PRD v4 §2）。
 *
 * JSON 分片存储 + 内存 cosine similarity 检索。
 * 替代 Python 端的 ChromaDB。
 */

import type { PlatformAdapter } from "../platform/adapter.js";
import { IndexStatus } from "../domain/enums.js";
import type { SearchOptions, SearchResult, VectorChunk, VectorRepository } from "../repositories/interfaces/vector.js";

/** 内存中的 chunk 条目。 */
interface MemoryChunk {
  id: string;
  collection: string;
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
}

/** index.json 中的 chunk 条目。 */
interface IndexEntry {
  id: string;
  file: string;
  chapter?: number;
  characters?: string[];
}

/** index.json 格式。 */
interface VectorIndex {
  model: string;
  dimension: number;
  total_chunks: number;
  chunks: IndexEntry[];
}

/** Cosine similarity。 */
export function cosine_similarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export class JsonVectorEngine implements VectorRepository {
  private chunks: MemoryChunk[] = [];
  private vectorsDir = "";
  private indexStatus: IndexStatus = IndexStatus.STALE;

  constructor(private adapter: PlatformAdapter) {}

  /** 从 .vectors/ 目录加载全部 chunks 到内存。 */
  async load(vectorsDir: string): Promise<void> {
    this.vectorsDir = vectorsDir;
    this.chunks = [];

    const indexPath = `${vectorsDir}/index.json`;
    const exists = await this.adapter.exists(indexPath);
    if (!exists) {
      this.indexStatus = IndexStatus.STALE;
      return;
    }

    const indexText = await this.adapter.readFile(indexPath);
    const index = JSON.parse(indexText) as VectorIndex;

    for (const entry of index.chunks) {
      const filePath = `${vectorsDir}/${entry.file}`;
      try {
        const chunkText = await this.adapter.readFile(filePath);
        const chunkData = JSON.parse(chunkText) as MemoryChunk;
        this.chunks.push(chunkData);
      } catch {
        // skip corrupt/missing files
      }
    }

    this.indexStatus = IndexStatus.READY;
  }

  async index_chunks(chunks: VectorChunk[]): Promise<void> {
    for (const chunk of chunks) {
      // 去重：替换已有 ID
      const existingIdx = this.chunks.findIndex((c) => c.id === chunk.id);
      const memChunk: MemoryChunk = {
        id: chunk.id,
        collection: chunk.collection,
        content: chunk.content,
        embedding: chunk.embedding,
        metadata: chunk.metadata,
      };

      if (existingIdx >= 0) {
        this.chunks[existingIdx] = memChunk;
      } else {
        this.chunks.push(memChunk);
      }
    }
  }

  async search(
    au_id: string,
    query_embedding: number[],
    options: SearchOptions,
  ): Promise<SearchResult[]> {
    // 过滤 AU + collection
    let candidates = this.chunks.filter(
      (c) => c.collection === options.collection && c.metadata.au_id === au_id,
    );

    // 角色过滤
    if (options.char_filter && options.char_filter.length > 0) {
      const filterSet = new Set(options.char_filter);
      candidates = candidates.filter((c) => {
        const chars = (c.metadata.characters as string) ?? "";
        return chars.split(",").some((ch) => filterSet.has(ch.trim()));
      });
    }

    // 计算 cosine similarity 并排序
    const scored = candidates.map((c) => ({
      chunk: c,
      score: cosine_similarity(query_embedding, c.embedding),
    }));
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, options.top_k).map((s) => ({
      content: s.chunk.content,
      chapter_num: (s.chunk.metadata.chapter as number) ?? 0,
      score: s.score,
      metadata: s.chunk.metadata,
    }));
  }

  async delete_by_chapter(au_id: string, chapter_num: number): Promise<void> {
    this.chunks = this.chunks.filter(
      (c) => !(c.metadata.au_id === au_id && c.metadata.chapter === chapter_num),
    );
  }

  async delete_by_source(au_id: string, source_file: string): Promise<void> {
    this.chunks = this.chunks.filter(
      (c) => !(c.metadata.au_id === au_id && c.metadata.source_file === source_file),
    );
  }

  async rebuild_index(au_id: string): Promise<void> {
    // 删除该 AU 的所有 chunks
    this.chunks = this.chunks.filter((c) => c.metadata.au_id !== au_id);
    this.indexStatus = IndexStatus.STALE;
  }

  async get_index_status(_au_id: string): Promise<IndexStatus> {
    return this.indexStatus;
  }

  /** 将内存数据持久化到 .vectors/ 目录。 */
  async persist(vectorsDir?: string): Promise<void> {
    const dir = vectorsDir ?? this.vectorsDir;
    if (!dir) return;

    await this.adapter.mkdir(dir);

    // 按 collection 分组写入 JSON 文件
    const indexEntries: IndexEntry[] = [];
    const collectionDirs = new Set<string>();

    for (const chunk of this.chunks) {
      const collDir = `${dir}/${chunk.collection}`;
      if (!collectionDirs.has(collDir)) {
        await this.adapter.mkdir(collDir);
        collectionDirs.add(collDir);
      }

      const fileName = `${chunk.id}.json`;
      const filePath = `${collDir}/${fileName}`;
      await this.adapter.writeFile(filePath, JSON.stringify(chunk, null, 2));

      indexEntries.push({
        id: chunk.id,
        file: `${chunk.collection}/${fileName}`,
        chapter: chunk.metadata.chapter as number | undefined,
        characters: ((chunk.metadata.characters as string) ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
    }

    // 写入 index.json
    const dimension = this.chunks.length > 0 ? this.chunks[0].embedding.length : 0;
    const index: VectorIndex = {
      model: "",
      dimension,
      total_chunks: this.chunks.length,
      chunks: indexEntries,
    };
    await this.adapter.writeFile(`${dir}/index.json`, JSON.stringify(index, null, 2));
    this.indexStatus = IndexStatus.READY;
  }

  /** 获取当前内存中的 chunk 数量（测试用）。 */
  get chunkCount(): number {
    return this.chunks.length;
  }
}
