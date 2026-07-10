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
import { logCatch, warnAlways } from "../logger/index.js";
import { atomicWrite } from "../utils/file_utils.js";

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
    let index: VectorIndex;
    try {
      index = JSON.parse(indexText) as VectorIndex;
    } catch (err) {
      // index.json 损坏（老版本非原子写崩溃截断）：不抛给上层 —— 搜索路径会静默降级
      // 空召回且无人把状态翻回 STALE，RAG 从此永久失效（盲审 2026-07-09）。
      // 自愈：按 STALE 空索引处理，让 index_status 消费方（badge / recalc）看到需重建。
      warnAlways("vector", `index.json corrupted at ${indexPath}; treating as STALE empty index (rebuild required)`, {
        error: err instanceof Error ? err.message : String(err),
        bytes: indexText.length,
      });
      this.indexStatus = IndexStatus.STALE;
      return;
    }

    for (const entry of index.chunks) {
      const filePath = `${vectorsDir}/${entry.file}`;
      try {
        const chunkText = await this.adapter.readFile(filePath);
        const chunkData = JSON.parse(chunkText) as MemoryChunk;
        this.chunks.push(chunkData);
      } catch (err) {
        logCatch("vector", `Failed to load chunk file: ${filePath}`, err);
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

  async delete_by_chapter(au_id: string, chapter_num: number, collection?: string): Promise<void> {
    // collection 省略 = 删该章全部向量（正文 chunks + sum{N} 摘要向量，undo 场景）；
    // 指定 collection = 只删该 collection（重索引正文前清旧 chunks，不能误伤仍有效的摘要向量）。
    this.chunks = this.chunks.filter(
      (c) => !(
        c.metadata.au_id === au_id &&
        c.metadata.chapter === chapter_num &&
        (collection === undefined || c.collection === collection)
      ),
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
    // L18：本次写入的分片文件全集（相对 dir 的 `collection/id.json`），用于清理孤儿分片。
    const writtenRel = new Set<string>();

    for (const chunk of this.chunks) {
      const collDir = `${dir}/${chunk.collection}`;
      if (!collectionDirs.has(collDir)) {
        await this.adapter.mkdir(collDir);
        collectionDirs.add(collDir);
      }

      const fileName = `${chunk.id}.json`;
      const filePath = `${collDir}/${fileName}`;
      // atomicWrite（与全仓崩溃安全策略一致）：中途崩溃不留半截 JSON 分片
      await atomicWrite(this.adapter, filePath, JSON.stringify(chunk, null, 2));
      writtenRel.add(`${chunk.collection}/${fileName}`);

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

    // 写入 index.json（先于孤儿分片 GC —— 见下方 F-10 说明）
    const dimension = this.chunks.length > 0 ? this.chunks[0].embedding.length : 0;
    const index: VectorIndex = {
      model: "",
      dimension,
      total_chunks: this.chunks.length,
      chunks: indexEntries,
    };
    // index.json 是加载判据，必须原子提交：截断的 index 会让 load 走「损坏 → STALE 空索引」
    // 自愈路径（可恢复），但仍应尽力不产生这种状态。
    await atomicWrite(this.adapter, `${dir}/index.json`, JSON.stringify(index, null, 2));

    // L18：清理孤儿分片——undo/编辑/重确认后 chunk 数变少时，旧的 `.json` 分片不再被本次写入
    // 覆盖，会永久残留（load 靠 index.json 不读它们，但纯磁盘垃圾逐轮膨胀）。列出 dir 下各
    // collection 子目录里的 `.json`，删掉不在本次写入集合中的（index.json 在 dir 顶层，不在
    // 任何 collection 子目录，天然不受影响）。清理失败不影响主写入（best-effort）。
    // F-10：GC 放在 index.json 写成功**之后** —— 若 GC 先行、index 写入前崩溃，磁盘上会留下
    // 「旧 index 引用已删分片」的损伤形态（load 报 chunk 缺失）；改序后崩溃最多留孤儿分片
    // （无害垃圾，下轮 persist 再清）。
    try {
      const topEntries = await this.adapter.listDir(dir);
      for (const collName of topEntries) {
        if (collName === "index.json") continue; // 顶层文件，非 collection 目录
        const collDir = `${dir}/${collName}`;
        let files: string[] = [];
        try {
          files = await this.adapter.listDir(collDir);
        } catch {
          continue; // 不是目录 / 读不到 → 跳过
        }
        for (const f of files) {
          if (!f.endsWith(".json")) continue;
          const rel = `${collName}/${f}`;
          if (writtenRel.has(rel)) continue; // 本次写入的，保留
          try {
            await this.adapter.deleteFile(`${collDir}/${f}`);
          } catch {
            // 单个删除失败不阻断（下轮再试）
          }
        }
      }
    } catch {
      // listDir(dir) 失败（罕见）→ 跳过清理，不影响已写入的分片与 index.json
    }

    this.indexStatus = IndexStatus.READY;
  }

  /** 获取当前内存中的 chunk 数量（测试用）。 */
  get chunkCount(): number {
    return this.chunks.length;
  }
}
