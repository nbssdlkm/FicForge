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
import type { ChapterSummaryRepository } from "../repositories/interfaces/chapter_summary.js";
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
    signal?: AbortSignal,
  ): Promise<void> {
    await this.indexChapterInMemory(auPath, chapterNum, content, embeddingProvider, castRegistry, signal);
    await this.vectorEngine.persist(vectorsDir(auPath));
  }

  /**
   * 索引单章 standard 摘要为 summaries collection 的 1 个向量（M8-C）。
   * id `sum{N}`，index_chunks 按 id 去重 → 重新生成自动覆盖。空摘要跳过。
   */
  async indexChapterSummary(
    auPath: string,
    chapterNum: number,
    summaryText: string,
    embeddingProvider: EmbeddingProvider,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!summaryText.trim()) return;
    await this.ensureLoaded(auPath);
    const [embedding] = await embeddingProvider.embed([summaryText], { signal });
    // embed 是慢 I/O：期间并发 confirm 可能切走 currentAu，导致 index/persist 落到错误 AU
    // （cross-AU 污染，codex workflow 审）。重新 ensureLoaded 保证回到目标 AU 的内存索引。
    // 注：底层 indexChapter/indexChapterInMemory 有同样的 pre-existing gap，见 TECH-DEBT.md TD-017。
    await this.ensureLoaded(auPath);
    await this.vectorEngine.index_chunks([{
      id: `sum${chapterNum}`,
      collection: "summaries",
      content: summaryText,
      embedding,
      metadata: { au_id: auPath, chapter: chapterNum, kind: "standard" },
    }]);
    await this.vectorEngine.persist(vectorsDir(auPath));
  }

  /**
   * 删除单章的全部向量（正文 `ch{N}_*` chunks + `sum{N}` 摘要向量），内存与落盘双清（H9）。
   * 删除不需要 embedding —— undo / 编辑历史章即使没配 embedding 也能立即清理，
   * 避免被拒/过时正文以最高时间权重残留在召回里。persist 保证冷启动重载后不复活。
   */
  async removeChapter(auPath: string, chapterNum: number): Promise<void> {
    await this.ensureLoaded(auPath);
    const before = this.vectorEngine.chunkCount;
    await this.vectorEngine.delete_by_chapter(auPath, chapterNum);
    // 没删掉任何 chunk（该章从未被索引 / AU 根本没有索引）→ 不写盘，
    // 避免给未配 embedding 的 AU 凭空创建 .vectors/ 空索引。
    if (this.vectorEngine.chunkCount === before) return;
    await this.vectorEngine.persist(vectorsDir(auPath));
  }

  /**
   * 仅当内存加载的正是该 AU 时卸载（H9：deleteAu / 删 fandom 移入回收站后调用）。
   * 故意不 persist —— 数据已移入 trash，persist 会把内存索引写回已删路径。
   * 不卸载则同名重建的 AU 会经 ensureLoaded 跳过 load、直接继承已删作品的内存向量。
   */
  unloadIfCurrent(auPath: string): void {
    if (this.currentAu === auPath) this.unload();
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
    summaryRepo?: ChapterSummaryRepository,
  ): Promise<void> {
    // 先切换到目标 AU（ensureLoaded 会清空内存并从磁盘重新加载，
    // 确保不残留前一个 AU 的 chunks）
    this.unload();
    await this.vectorEngine.load(vectorsDir(auPath));
    this.currentAu = auPath;
    // 清除目标 AU 的旧 chunks（准备全量重建）
    await this.vectorEngine.rebuild_index(auPath);

    try {
      // 遍历所有章节：批量索引到内存，最后一次性 persist
      const chapters = await chapterRepo.list_main(auPath);
      onProgress?.(0, chapters.length);
      for (let i = 0; i < chapters.length; i++) {
        if (signal?.aborted) break;
        const ch = chapters[i];
        const content = await chapterRepo.get_content_only(auPath, ch.chapter_num);
        await this.indexChapterInMemory(auPath, ch.chapter_num, content, embeddingProvider, castRegistry, signal);
        // M8-C：若该章有 standard 摘要，一并索引进 summaries collection（仅内存，循环后统一 persist）
        if (summaryRepo) {
          // best-effort：单章摘要 embed/index 失败（超长被 embedding 拒、或文件语义损坏 text 非 string）
          // 不能中断整个 rebuild（codex 对抗审 BLOCKER + 损坏文件）。typeof 守卫挡住 {"text":42} 这类。
          try {
            const sum = await summaryRepo.get(auPath, ch.chapter_num);
            const text = sum?.standard?.text;
            if (typeof text === "string" && text.trim()) {
              const [embedding] = await embeddingProvider.embed([text], { signal });
              await this.vectorEngine.index_chunks([{
                id: `sum${ch.chapter_num}`,
                collection: "summaries",
                content: text,
                embedding,
                metadata: { au_id: auPath, chapter: ch.chapter_num, kind: "standard" },
              }]);
            }
          } catch (err) {
            console.warn(`[m8c] skip summary for ch${ch.chapter_num} during rebuild:`, err);
          }
        }
        onProgress?.(i + 1, chapters.length);
      }
      // 无论有无章节都 persist（0 章节时需要写入空索引覆盖旧数据）
      await this.vectorEngine.persist(vectorsDir(auPath));
    } catch (err) {
      // 重建中途失败：内存已被 rebuild_index 清空但 persist 没执行 → 磁盘老 chunks 还在。
      // 必须 unload，否则 currentAu 还指向 auPath，下次 ensureLoaded 会跳过 load → 内存永远空 → RAG 0 召回。
      // unload 后下次 ensureLoaded 强制 reload from disk，回到 rebuild 之前的状态。
      this.unload();
      throw err;
    }
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
    signal?: AbortSignal,
  ): Promise<void> {
    await this.ensureLoaded(auPath);

    const chunks = split_chapter_into_chunks(content, chapterNum, 500, 1, castRegistry);

    // embed（慢 I/O）放在删除之前：embed 失败时内存索引未被改动，旧 chunks 仍可召回（fail-safe）。
    const texts = chunks.map((c) => c.content);
    const embeddings = chunks.length > 0 ? await embeddingProvider.embed(texts, { signal }) : [];

    if (embeddings.length !== texts.length) {
      throw new Error(
        `Embedding count mismatch: expected ${texts.length}, got ${embeddings.length}`,
      );
    }

    // H9：重索引同章前先删旧正文 chunks —— index_chunks 只按 id 覆盖，新内容变短（chunk 数变少）
    // 时旧尾部 ch{N}_{k} 会永久残留进召回。只删 chapters collection：sum{N} 摘要向量由摘要自身的
    // 生成/删除路径管理（backfill 对已有摘要的章调本方法时不能误删其仍有效的摘要向量）。
    // delete 按 au_id 过滤，慢 embed 期间并发切 AU 时对错误 AU 的内存是 no-op（不加剧 M3 竞态）。
    await this.vectorEngine.delete_by_chapter(auPath, chapterNum, "chapters");
    if (chunks.length === 0) return;

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
