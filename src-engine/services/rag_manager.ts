// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * RAG 生命周期管理。
 *
 * 统一管理向量引擎的 load / index / persist / unload。
 *
 * **TD-017 修复（per-AU 引擎）**：历史实现持有单个共享 `JsonVectorEngine`，切 AU 时整体替换其
 * 内存 chunks。索引路径「ensureLoaded → 慢 embed（秒级网络 I/O）→ index → persist」在 embed 期间
 * 若另一 AU 调 ensureLoaded 换走内存，随后本 AU 的 index/persist 会把他 AU 内容写进本 AU 的
 * `.vectors`（跨 AU 污染）。`withAuLock` 按 AU 分锁挡不住——共享的是跨 AU 的单例内存。
 * 现改为**每 AU 一个独立引擎实例**（`Map<auPath, JsonVectorEngine>`，LRU 控内存上限），彻底消除
 * 跨 AU 共享内存：不同 AU 的操作用不同引擎，在飞 embed 的引擎引用被本操作独占持有，即使并发创建
 * 他 AU 引擎也互不干扰；persist 落到各自 AU 的目录，无从污染。
 */

import type { EmbeddingProvider } from "../llm/embedding_provider.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import type { ChapterSummaryRepository } from "../repositories/interfaces/chapter_summary.js";
import type { JsonVectorEngine } from "../vector/engine.js";
import type { VectorRepository } from "../repositories/interfaces/vector.js";
import { split_chapter_into_chunks, type CastRegistryLike } from "../vector/chunker.js";
import { logCatch } from "../logger/index.js";

function vectorsDir(auPath: string): string {
  return `${auPath}/.vectors`;
}

export class RagManager {
  /** 已加载的 per-AU 引擎（内存 chunks 仅含各自 AU）。 */
  private engines = new Map<string, JsonVectorEngine>();
  /** 在飞的 load promise（并发首访同一 AU 只 load 一次，避免同 AU 出现两个引擎导致 persist 丢更新）。 */
  private loading = new Map<string, Promise<JsonVectorEngine>>();
  /** LRU 顺序：队首最久未用、队尾最近用。超过 maxEngines 时驱逐队首。 */
  private lru: string[] = [];
  /** 被在飞操作持有的引擎的引用计数（>0 = 正在用，不参与 LRU 驱逐）。 */
  private pins = new Map<string, number>();
  private readonly maxEngines: number;

  /**
   * @param engineFactory 每次调用返回**一个新的** JsonVectorEngine —— per-AU 隔离的前提。
   *   （测试可传 `() => sharedEngine` 复用单实例以沿用旧的单 AU 断言。）
   * @param maxEngines 常驻引擎上限（LRU），默认 2：单窗口应用同时活跃的 AU 极少，2 足够且防内存膨胀。
   */
  constructor(private engineFactory: () => JsonVectorEngine, maxEngines = 2) {
    this.maxEngines = Math.max(1, maxEngines);
  }

  private touch(auPath: string): void {
    const i = this.lru.indexOf(auPath);
    if (i >= 0) this.lru.splice(i, 1);
    this.lru.push(auPath);
  }

  private evict(auPath: string): void {
    this.engines.delete(auPath);
    this.loading.delete(auPath);
    const i = this.lru.indexOf(auPath);
    if (i >= 0) this.lru.splice(i, 1);
  }

  private pin(auPath: string): void {
    this.pins.set(auPath, (this.pins.get(auPath) ?? 0) + 1);
  }

  private unpin(auPath: string): void {
    const n = (this.pins.get(auPath) ?? 0) - 1;
    if (n <= 0) this.pins.delete(auPath);
    else this.pins.set(auPath, n);
  }

  private evictExcess(): void {
    // 从 LRU 队首（最久未用）向后驱逐，跳过被在飞操作 pin 住的引擎。
    // 为什么跳过 pin：若一个长跑写操作（如 rebuild）全程持有 engA，而该 AU 在窗口内被逐出 Map，
    // 随后同 AU 的另一写操作 engineFor 会从磁盘重载出 engA2 → 两引擎各自 persist 互相覆盖丢更新
    // （对抗审发现 2）。pin 住在用引擎，保证同 AU 的并发操作始终复用同一引擎。
    // 只从 Map 驱逐——被逐引擎若仍被某操作持有引用，对象不销毁、照常在自身 chunks 上完成并
    // persist 到正确 AU 目录；驱逐只意味着下次访问从磁盘重载。
    let i = 0;
    while (this.engines.size > this.maxEngines && i < this.lru.length) {
      const victim = this.lru[i];
      if ((this.pins.get(victim) ?? 0) > 0) {
        i++; // 在用，跳过（保持在 Map 里）
        continue;
      }
      this.engines.delete(victim);
      this.lru.splice(i, 1); // splice 后当前 i 指向下一个，不自增
    }
  }

  /**
   * 取得（必要时创建 + 从磁盘 load）指定 AU 的向量引擎。promise 缓存保证并发首访只 load 一次
   * （否则两个引擎并存 → 各自 persist 互相丢更新）。load 失败向上抛（索引路径据此中止，不把
   * 空引擎 persist 覆盖损坏索引）；搜索路径经 {@link vectorRepoFor} 自行吞错回退空库。
   */
  private async engineFor(auPath: string): Promise<JsonVectorEngine> {
    const cached = this.engines.get(auPath);
    if (cached) {
      this.touch(auPath);
      return cached;
    }
    const inflight = this.loading.get(auPath);
    if (inflight) return inflight;
    const eng = this.engineFactory();
    const loadPromise: Promise<JsonVectorEngine> = eng.load(vectorsDir(auPath)).then(
      () => {
        // epoch 守卫（对抗审发现 1）：这条 load 在飞期间该 AU 若已被 evict（如并发 deleteAu →
        // unloadIfCurrent）或被后续 load 取代，loading 里已不是本 promise → 不落库。否则「删除时
        // 恰有在飞 load」会把已删作品的向量重新塞回 Map、被同名重建的新 AU 继承 → 索引污染。
        if (this.loading.get(auPath) === loadPromise) {
          this.engines.set(auPath, eng);
          this.loading.delete(auPath);
          this.touch(auPath);
          this.evictExcess();
        }
        return eng;
      },
      (err) => {
        if (this.loading.get(auPath) === loadPromise) this.loading.delete(auPath); // 失败不缓存，下次重试
        throw err;
      },
    );
    this.loading.set(auPath, loadPromise);
    return loadPromise;
  }

  /**
   * 确保指定 AU 的向量索引已加载（供搜索前调用）。语义等价旧 ensureLoaded：
   * 已加载则复用、未加载则从磁盘 load。
   */
  async ensureLoaded(auPath: string): Promise<void> {
    await this.engineFor(auPath);
  }

  /**
   * 搜索路径用：确保加载并返回该 AU 的向量库（VectorRepository）。索引损坏/加载失败时返回一个
   * 空引擎（等价旧 `e.vectorEngine` 的空态回退：搜索得 0 结果而非抛错），且不缓存损坏态。
   */
  async vectorRepoFor(auPath: string): Promise<VectorRepository> {
    try {
      return await this.engineFor(auPath);
    } catch (err) {
      logCatch("rag_manager", `load failed for ${auPath}; search degrades to empty`, err);
      return this.engineFactory(); // throwaway 空库，仅供本次搜索读（不 persist、不缓存）
    }
  }

  /** 当前已加载引擎中该 AU 的 chunk 数（未加载 → 0）。测试/诊断用。 */
  chunkCountFor(auPath: string): number {
    return this.engines.get(auPath)?.chunkCount ?? 0;
  }

  /**
   * 取得该 AU 引擎并在**整个操作期间 pin 住**（不被 LRU 驱逐），跑完 unpin。
   * 保证同 AU 的并发写操作复用同一引擎实例，杜绝「驱逐 → 两引擎各自 persist 丢更新」（发现 2）。
   */
  private async withEngine<T>(auPath: string, fn: (eng: JsonVectorEngine) => Promise<T>): Promise<T> {
    const eng = await this.engineFor(auPath); // engineFor 返回后同步 pin，其间无 await 让步，不会被驱逐
    this.pin(auPath);
    try {
      return await fn(eng);
    } finally {
      this.unpin(auPath);
      this.evictExcess(); // unpin 后可能腾出可驱逐名额
    }
  }

  /**
   * 对单个章节执行切块 → 向量化 → 索引 → 持久化。
   */
  async indexChapter(
    auPath: string,
    chapterNum: number,
    content: string,
    embeddingProvider: EmbeddingProvider,
    castRegistry?: CastRegistryLike | null,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.withEngine(auPath, async (eng) => {
      await this.indexChapterInMemory(eng, auPath, chapterNum, content, embeddingProvider, castRegistry, signal);
      await eng.persist(vectorsDir(auPath));
    });
  }

  /**
   * 索引单章 standard 摘要为 summaries collection 的 1 个向量（M8-C）。
   * id `sum{N}`，index_chunks 按 id 去重 → 重新生成自动覆盖。空摘要跳过。
   *
   * TD-017 后：引擎是该 AU 独占实例，embed 期间不会被他 AU 换走内存，故不再需要旧的
   * 「embed 后 re-ensureLoaded」补丁（那是共享单例时代的缓解）。
   */
  async indexChapterSummary(
    auPath: string,
    chapterNum: number,
    summaryText: string,
    embeddingProvider: EmbeddingProvider,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!summaryText.trim()) return;
    await this.withEngine(auPath, async (eng) => {
      const [embedding] = await embeddingProvider.embed([summaryText], { signal });
      await eng.index_chunks([{
        id: `sum${chapterNum}`,
        collection: "summaries",
        content: summaryText,
        embedding,
        metadata: { au_id: auPath, chapter: chapterNum, kind: "standard" },
      }]);
      await eng.persist(vectorsDir(auPath));
    });
  }

  /**
   * 删除单章的全部向量（正文 `ch{N}_*` chunks + `sum{N}` 摘要向量），内存与落盘双清（H9）。
   * 删除不需要 embedding —— undo / 编辑历史章即使没配 embedding 也能立即清理。
   */
  async removeChapter(auPath: string, chapterNum: number): Promise<void> {
    await this.withEngine(auPath, async (eng) => {
      const before = eng.chunkCount;
      await eng.delete_by_chapter(auPath, chapterNum);
      // 没删掉任何 chunk（该章从未被索引 / AU 根本没有索引）→ 不写盘，
      // 避免给未配 embedding 的 AU 凭空创建 .vectors/ 空索引。
      if (eng.chunkCount === before) return;
      await eng.persist(vectorsDir(auPath));
    });
  }

  /**
   * 仅当该 AU 已加载时驱逐其引擎（H9：deleteAu / 删 fandom 移入回收站后调用）。
   * 故意不 persist —— 数据已移入 trash，persist 会把内存索引写回已删路径。
   * 驱逐后同名重建的 AU 经 engineFor 会从磁盘重新 load，不继承已删作品的内存向量。
   */
  unloadIfCurrent(auPath: string): void {
    this.evict(auPath);
  }

  /**
   * 全量重建：删除旧索引 → 遍历所有章节 → 逐章索引。
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
    const eng = await this.engineFor(auPath);
    // rebuild 是最长的写操作（逐章 embed，秒~分钟级）：全程 pin 住引擎，防被 LRU 驱逐后同 AU
    // 并发写重载出第二个引擎、两引擎 persist 互覆丢更新（对抗审发现 2）。
    this.pin(auPath);
    try {
      // 清除目标 AU 的旧 chunks（准备全量重建）
      await eng.rebuild_index(auPath);
      // 遍历所有章节：批量索引到内存，最后一次性 persist
      const chapters = await chapterRepo.list_main(auPath);
      onProgress?.(0, chapters.length);
      for (let i = 0; i < chapters.length; i++) {
        if (signal?.aborted) break;
        const ch = chapters[i];
        const content = await chapterRepo.get_content_only(auPath, ch.chapter_num);
        await this.indexChapterInMemory(eng, auPath, ch.chapter_num, content, embeddingProvider, castRegistry, signal);
        // M8-C：若该章有 standard 摘要，一并索引进 summaries collection（仅内存，循环后统一 persist）
        if (summaryRepo) {
          // best-effort：单章摘要 embed/index 失败（超长被 embedding 拒、或文件语义损坏 text 非 string）
          // 不能中断整个 rebuild（codex 对抗审 BLOCKER + 损坏文件）。typeof 守卫挡住 {"text":42} 这类。
          try {
            const sum = await summaryRepo.get(auPath, ch.chapter_num);
            const text = sum?.standard?.text;
            if (typeof text === "string" && text.trim()) {
              const [embedding] = await embeddingProvider.embed([text], { signal });
              await eng.index_chunks([{
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
      await eng.persist(vectorsDir(auPath));
    } catch (err) {
      // 重建中途失败：内存已被 rebuild_index 清空但 persist 没执行 → 磁盘老 chunks 还在。
      // 驱逐该 AU 引擎，下次 engineFor 强制从磁盘 reload，回到 rebuild 之前的状态（不留空内存 → 0 召回）。
      this.evict(auPath);
      throw err;
    } finally {
      this.unpin(auPath);
    }
  }

  /**
   * 仅索引到内存（传入已加载的目标 AU 引擎），不 persist。供 indexChapter / rebuildForAu 复用。
   */
  private async indexChapterInMemory(
    eng: JsonVectorEngine,
    auPath: string,
    chapterNum: number,
    content: string,
    embeddingProvider: EmbeddingProvider,
    castRegistry?: CastRegistryLike | null,
    signal?: AbortSignal,
  ): Promise<void> {
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
    await eng.delete_by_chapter(auPath, chapterNum, "chapters");
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

    await eng.index_chunks(vectorChunks);
  }

  /**
   * 驱逐全部已加载引擎（下次 engineFor 各自从磁盘重载）。
   */
  unload(): void {
    this.engines.clear();
    this.loading.clear();
    this.lru = [];
    this.pins.clear();
  }

  /** 最近使用的 AU 路径（无则 null）。测试/诊断用；替代旧的单一 currentAu。 */
  get loadedAu(): string | null {
    return this.lru.length > 0 ? this.lru[this.lru.length - 1] : null;
  }
}
