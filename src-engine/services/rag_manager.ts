// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * RAG 生命周期管理。
 *
 * 统一管理 vectorEngine 的 load / index / persist / unload，
 * 内部跟踪当前已加载的 AU，切换 AU 时自动 unload 前一个。
 * 解决 F7：confirm 后索引覆盖旧 chunk、反复 load 等问题。
 */

import type { EmbeddingProvider } from "../llm/embedding_provider.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import type { JsonVectorEngine } from "../vector/engine.js";
import { split_chapter_into_chunks, type CastRegistryLike } from "../vector/chunker.js";

function vectorsDir(auPath: string): string {
  return `${auPath}/.vectors`;
}

export class RagManager {
  private currentAu: string | null = null;

  constructor(private vectorEngine: JsonVectorEngine) {}

  /**
   * 加载指定 AU 的向量索引到内存。
   * 如果当前已加载同一 AU，则跳过；如果是不同 AU，先 unload 再 load。
   */
  async ensureLoaded(auPath: string): Promise<void> {
    if (this.currentAu === auPath) return;
    this.unload();
    await this.vectorEngine.load(vectorsDir(auPath));
    this.currentAu = auPath;
  }

  /**
   * 对单个章节执行切块 → 向量化 → 索引 → 持久化。
   * 调用前自动 ensureLoaded，避免覆盖其他 AU 的 chunk。
   */
  async indexChapter(
    auPath: string,
    chapterNum: number,
    content: string,
    embeddingProvider: EmbeddingProvider,
    castRegistry?: CastRegistryLike | null,
  ): Promise<void> {
    await this.indexChapterInMemory(auPath, chapterNum, content, embeddingProvider, castRegistry);
    await this.vectorEngine.persist(vectorsDir(auPath));
  }

  /**
   * 全量重建：删除旧索引 → 遍历所有章节 → 逐章 indexChapter。
   * chapter_repo 和 embedding_provider 由调用方传入（DI 模式）。
   */
  async rebuildForAu(
    auPath: string,
    chapterRepo: ChapterRepository,
    embeddingProvider: EmbeddingProvider,
    castRegistry?: CastRegistryLike | null,
    signal?: AbortSignal,
    onProgress?: (current: number, total: number) => void,
  ): Promise<void> {
    // 先切换到目标 AU（ensureLoaded 会清空内存并从磁盘重新加载，
    // 确保不残留前一个 AU 的 chunks）
    this.unload();
    await this.vectorEngine.load(vectorsDir(auPath));
    this.currentAu = auPath;
    // 清除目标 AU 的旧 chunks（准备全量重建）
    await this.vectorEngine.rebuild_index(auPath);

    // 遍历所有章节：批量索引到内存，最后一次性 persist
    const chapters = await chapterRepo.list_main(auPath);
    onProgress?.(0, chapters.length);
    for (let i = 0; i < chapters.length; i++) {
      if (signal?.aborted) break;
      const ch = chapters[i];
      const content = await chapterRepo.get_content_only(auPath, ch.chapter_num);
      await this.indexChapterInMemory(auPath, ch.chapter_num, content, embeddingProvider, castRegistry);
      onProgress?.(i + 1, chapters.length);
    }
    // 无论有无章节都 persist（0 章节时需要写入空索引覆盖旧数据）
    await this.vectorEngine.persist(vectorsDir(auPath));
  }

  /**
   * 仅索引到内存，不 persist。供 rebuildForAu 批量使用。
   */
  private async indexChapterInMemory(
    auPath: string,
    chapterNum: number,
    content: string,
    embeddingProvider: EmbeddingProvider,
    castRegistry?: CastRegistryLike | null,
  ): Promise<void> {
    await this.ensureLoaded(auPath);

    const chunks = split_chapter_into_chunks(content, chapterNum, 500, 1, castRegistry);
    if (chunks.length === 0) return;

    const texts = chunks.map((c) => c.content);
    const embeddings = await embeddingProvider.embed(texts);

    if (embeddings.length !== texts.length) {
      throw new Error(
        `Embedding count mismatch: expected ${texts.length}, got ${embeddings.length}`,
      );
    }

    const vectorChunks = chunks.map((c, i) => ({
      id: `ch${chapterNum}_${c.chunk_index}`,
      collection: "chapters" as const,
      content: c.content,
      embedding: embeddings[i],
      metadata: {
        au_id: auPath,
        chapter: chapterNum,
        chunk_index: c.chunk_index,
        branch_id: c.branch_id,
        characters: c.characters.join(","),
      },
    }));

    await this.vectorEngine.index_chunks(vectorChunks);
  }

  /**
   * 卸载当前 AU 的内存索引。
   * 下次 ensureLoaded 会触发 load() 重置内存中的 chunks。
   */
  unload(): void {
    this.currentAu = null;
  }

  /** 获取当前已加载的 AU 路径（测试用）。 */
  get loadedAu(): string | null {
    return this.currentAu;
  }
}
