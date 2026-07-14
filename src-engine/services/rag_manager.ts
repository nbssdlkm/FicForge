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
import { scanChunkCharacters, splitChapterIntoChunks, type CastRegistryLike } from "../vector/chunker.js";
import { logCatch, warnAlways } from "../logger/index.js";
import { createAbortError } from "../utils/abort_error.js";

function vectorsDir(auPath: string): string {
  return `${auPath}/.vectors`;
}

export interface RebuildForAuParams {
  auPath: string;
  chapterRepo: ChapterRepository;
  embeddingProvider: EmbeddingProvider;
  castRegistry?: CastRegistryLike | null;
  characterAliases?: Record<string, string[]> | null;
  signal?: AbortSignal;
  onProgress?: (current: number, total: number) => void;
  summaryRepo?: ChapterSummaryRepository;
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
  /**
   * 同 AU 写操作串行队列（盲审 2026-07-11 正确性维，TD-017 的下一层）：per-AU 引擎
   * 消除了跨 AU 竞态，但同 AU 的并发写（如 rebuildForAu 长跑期间 confirm/编辑触发
   * indexChapter）仍共享同一引擎实例 —— 二者并发改 chunks 并各自 persist，persist 的
   * 孤儿分片 GC 会把「不在本次 writtenRel 里」的对方新分片删掉，且对方的 index.json
   * 仍引用它 → 向量静默丢失。写口按 AU 串行（跨 AU 仍并行；搜索路径不进队列）。
   */
  private writeQueues = new Map<string, Promise<void>>();
  /** 删除纪元：unloadIfCurrent（deleteAu 语义）时自增，作废该 AU 所有在队写。 */
  private epochs = new Map<string, number>();
  private readonly maxEngines: number;

  /**
   * @param engineFactory 每次调用返回**一个新的** JsonVectorEngine —— per-AU 隔离的前提。
   *   （测试可传 `() => sharedEngine` 复用单实例以沿用旧的单 AU 断言。）
   * @param maxEngines 常驻引擎上限（LRU），默认 2：单窗口应用同时活跃的 AU 极少，2 足够且防内存膨胀。
   */
  constructor(
    private engineFactory: () => JsonVectorEngine,
    maxEngines = 2,
  ) {
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

  /** 当前删除纪元（写操作起点捕获，随 withAuWriteLock opts.epoch 传入）。 */
  private epochOf(auPath: string): number {
    return this.epochs.get(auPath) ?? 0;
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
   * 同 AU 写操作串行化（见 writeQueues 字段注释）。队尾恒为已 catch 的 promise，
   * 前序失败不阻塞后续写（与 au_lock 同语义）；错误照常抛给本次调用方。
   *
   * 出队三查（B3 对抗审）：
   * ① signal —— 排队等待期用户已取消则立即以 AbortError 收尾，不空跑；
   * ② epoch —— 入队后该 AU 被删除（unloadIfCurrent 已 bump）则静默跳过，
   *    防止排队写在 deleteAu 之后 persist 复活 <au>/.vectors（同名重建继承已删向量）；
   * ③ 正常执行 fn。
   */
  private withAuWriteLock(
    auPath: string,
    fn: () => Promise<void>,
    opts?: { signal?: AbortSignal; epoch?: number },
  ): Promise<void> {
    const signal = opts?.signal;
    // epoch 必须在**操作起点**（慢段 embed 之前）捕获并传入 —— 若在入队时才捕获，
    // 慢段期间发生的 deleteAu 已把纪元推进，入队时捕获到的就是删除后的新纪元，
    // 检查恒通过、排队写照样复活 .vectors（B3 整改自测抓到的捕获点错误）。
    const epochAtEnqueue = opts?.epoch ?? this.epochs.get(auPath) ?? 0;
    const prev = this.writeQueues.get(auPath) ?? Promise.resolve();
    const run = prev.then(() => {
      if (signal?.aborted) throw createAbortError();
      if ((this.epochs.get(auPath) ?? 0) !== epochAtEnqueue) {
        warnAlways("rag_manager", "queued vector write skipped: AU unloaded (deleted) while waiting", { auPath });
        return;
      }
      return fn();
    });
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.writeQueues.set(auPath, tail);
    void tail.then(() => {
      if (this.writeQueues.get(auPath) === tail) this.writeQueues.delete(auPath);
    });
    return run;
  }

  /**
   * 取得该 AU 引擎并在**整个操作期间 pin 住**（不被 LRU 驱逐），跑完 unpin。
   * 保证同 AU 的并发写操作复用同一引擎实例，杜绝「驱逐 → 两引擎各自 persist 丢更新」（发现 2）。
   */
  private async withEngine<T>(auPath: string, fn: (eng: JsonVectorEngine) => Promise<T>): Promise<T> {
    // pin 先于任何 await（盲审 2026-07-09 复核修正）：旧序「await engineFor 后再 pin」
    // 存在微任务间隙 —— await 本身让步（即使命中缓存也让步一次），间隙里其它操作
    // finally 中的 evictExcess 可把刚入 Map、尚未 pin 的引擎驱逐；随后同 AU 并发写
    // 会从磁盘重载出第二个引擎，两引擎各自 persist 互相丢更新（正是 pin 要防的
    // 「发现 2」）。pin 是纯计数、不要求引擎已存在，先 pin 后取无此窗口。
    this.pin(auPath);
    try {
      const eng = await this.engineFor(auPath);
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
    characterAliases?: Record<string, string[]> | null,
    signal?: AbortSignal,
  ): Promise<void> {
    const epoch = this.epochOf(auPath);
    // 慢段（embed，秒级）不占队列 —— 队列只串行毫秒级的「内存变更 + persist」快段。
    // 否则持 au_lock 的调用方（confirm 摘要块 / backfill persistChapter）会在队列里
    // 等其它写的 embed 甚至整个 rebuild，把 au_lock 握持时间放大成分钟级、冻结全 AU
    // 写操作（B3 对抗审 MEDIUM：优先级反转）。embed 不碰引擎状态，天然可并发。
    const prepared = await this.prepareChapterChunks(
      auPath,
      chapterNum,
      content,
      embeddingProvider,
      castRegistry,
      characterAliases,
      signal,
    );
    await this.withAuWriteLock(
      auPath,
      () =>
        this.withEngine(auPath, async (eng) => {
          await eng.deleteByChapter(auPath, chapterNum, "chapters");
          if (prepared.length > 0) await eng.indexChunks(prepared);
          await eng.persist(vectorsDir(auPath));
        }),
      { signal, epoch },
    );
  }

  /**
   * 重算存量正文 chunks 的「出场角色」标签（TD-020 免嵌迁移）：块原文就存在分片里，
   * 用别名表重扫一遍 metadata 即可——**不调 embedding、不动向量**，纯本地毫秒~秒级。
   * 判据与新建块同源（scanChunkCharacters）。标签无变化时跳过 persist（幂等零写放大）。
   * 触发点：recalcState / 角色卡增删改（别名表失效点）/ 导入完成——由 UI api 层编排。
   * @returns 标签发生变化的 chunk 数。
   */
  async rescanChunkCharacters(
    auPath: string,
    castRegistry: CastRegistryLike | null | undefined,
    characterAliases: Record<string, string[]> | null | undefined,
  ): Promise<number> {
    const epoch = this.epochOf(auPath);
    let changed = 0;
    await this.withAuWriteLock(
      auPath,
      () =>
        this.withEngine(auPath, async (eng) => {
          changed = eng.update_chapter_characters(auPath, (content, chapterNum) =>
            scanChunkCharacters(content, castRegistry, characterAliases, chapterNum),
          );
          if (changed > 0) {
            try {
              await eng.persist(vectorsDir(auPath));
            } catch (err) {
              // persist 失败时内存已是新标签、磁盘还是旧标签——留着这台引擎，下次重扫
              // changed=0 会永久跳过落盘（内存对、重启回退，codex F4 对抗审 MED）。
              // 驱逐该 AU 引擎：下次加载从磁盘重读，重扫重新得出 changed>0 再试
              // （与 rebuild 失败自愈同款姿势）。
              this.evict(auPath);
              throw err;
            }
          }
        }),
      { epoch },
    );
    return changed;
  }

  /**
   * 索引单章 standard 摘要为 summaries collection 的 1 个向量（M8-C）。
   * id `sum{N}`，indexChunks 按 id 去重 → 重新生成自动覆盖。空摘要跳过。
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
    const epoch = this.epochOf(auPath);
    // 慢段（embed）出队列，理由同 indexChapter —— 本方法正是 confirm 在 au_lock 内调用的那条链
    const [embedding] = await embeddingProvider.embed([summaryText], { signal });
    await this.withAuWriteLock(
      auPath,
      () =>
        this.withEngine(auPath, async (eng) => {
          await eng.indexChunks([
            {
              id: `sum${chapterNum}`,
              collection: "summaries",
              content: summaryText,
              embedding,
              metadata: { au_id: auPath, chapter: chapterNum, kind: "standard" },
            },
          ]);
          await eng.persist(vectorsDir(auPath));
        }),
      { signal, epoch },
    );
  }

  /**
   * 删除单章的全部向量（正文 `ch{N}_*` chunks + `sum{N}` 摘要向量），内存与落盘双清（H9）。
   * 删除不需要 embedding —— undo / 编辑历史章即使没配 embedding 也能立即清理。
   */
  async removeChapter(auPath: string, chapterNum: number): Promise<void> {
    await this.withAuWriteLock(auPath, () =>
      this.withEngine(auPath, async (eng) => {
        const before = eng.chunkCount;
        await eng.deleteByChapter(auPath, chapterNum);
        // 没删掉任何 chunk（该章从未被索引 / AU 根本没有索引）→ 不写盘，
        // 避免给未配 embedding 的 AU 凭空创建 .vectors/ 空索引。
        if (eng.chunkCount === before) return;
        await eng.persist(vectorsDir(auPath));
      }),
    );
  }

  /**
   * 仅当该 AU 已加载时驱逐其引擎（H9：deleteAu / 删 fandom 移入回收站后调用）。
   * 故意不 persist —— 数据已移入 trash，persist 会把内存索引写回已删路径。
   * 驱逐后同名重建的 AU 经 engineFor 会从磁盘重新 load，不继承已删作品的内存向量。
   */
  unloadIfCurrent(auPath: string): void {
    this.evict(auPath);
    // 删除纪元 +1：该 AU 已移入回收站，排队中的向量写全部作废（出队时 epoch 不符即跳过），
    // 防止出队写从空路径 reload → persist 重新 mkdir 出 <au>/.vectors（B3 对抗审 LOW）。
    this.epochs.set(auPath, (this.epochs.get(auPath) ?? 0) + 1);
  }

  /**
   * 全量重建：删除旧索引 → 遍历所有章节 → 逐章索引。
   */
  async rebuildForAu(params: RebuildForAuParams): Promise<void> {
    const { auPath, chapterRepo, embeddingProvider, castRegistry, characterAliases, signal, onProgress, summaryRepo } =
      params;
    // 缓冲式重建（B3 对抗审 MEDIUM 整改）：慢段（逐章 embed，秒~分钟级）**不占写队列、
    // 不碰引擎**，把 chunks 攒进局部缓冲；只有毫秒级快段（清扫 + 注入 + persist）进队列。
    // 旧实现全程占队会让持 au_lock 的 confirm/backfill 写在队列里等整个 rebuild —— au_lock
    // 被跨等待持有，冻结该 AU 全部写操作（优先级反转）。
    //
    // 附带收益：embed 中途失败/取消时引擎与磁盘均未被改动（旧实现先 rebuild_index 清内存，
    // 取消即 persist 半成品、未处理章的向量丢失）—— 现在直接 return，旧索引原样保留。
    const epoch = this.epochOf(auPath);
    const chapters = await chapterRepo.listMain(auPath);
    const snapshotNums = new Set(chapters.map((ch) => ch.chapter_num));
    const buffered: Parameters<JsonVectorEngine["indexChunks"]>[0] = [];
    onProgress?.(0, chapters.length);
    for (let i = 0; i < chapters.length; i++) {
      if (signal?.aborted) return; // 旧索引未动，安全中止
      const ch = chapters[i];
      const content = await chapterRepo.getContentOnly(auPath, ch.chapter_num);
      buffered.push(
        ...(await this.prepareChapterChunks(
          auPath,
          ch.chapter_num,
          content,
          embeddingProvider,
          castRegistry,
          characterAliases,
          signal,
        )),
      );
      // M8-C：若该章有 standard 摘要，一并缓冲进 summaries collection
      if (summaryRepo) {
        // best-effort：单章摘要 embed 失败（超长被 embedding 拒、或文件语义损坏 text 非 string）
        // 不能中断整个 rebuild（codex 对抗审 BLOCKER + 损坏文件）。typeof 守卫挡住 {"text":42} 这类。
        try {
          const sum = await summaryRepo.get(auPath, ch.chapter_num);
          const text = sum?.standard?.text;
          if (typeof text === "string" && text.trim()) {
            const [embedding] = await embeddingProvider.embed([text], { signal });
            buffered.push({
              id: `sum${ch.chapter_num}`,
              collection: "summaries",
              content: text,
              embedding,
              metadata: { au_id: auPath, chapter: ch.chapter_num, kind: "standard" },
            });
          }
        } catch (err) {
          warnAlways("m8c", `skip summary for ch${ch.chapter_num} during rebuild`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      onProgress?.(i + 1, chapters.length);
    }
    if (signal?.aborted) return;

    // 快段：清扫 + 注入 + persist（毫秒级占队）
    await this.withAuWriteLock(
      auPath,
      () =>
        this.withEngine(auPath, async (eng) => {
          try {
            // 只清「快照内章节」的旧向量 —— 慢段期间新确认的章（不在快照里）由其自身
            // indexChapter 维护，盲清会误删它刚写的向量（旧实现 rebuild_index 全清无此问题，
            // 因为旧实现同时把并发写也锁死了；缓冲式必须选择性清扫）。
            for (const n of snapshotNums) {
              await eng.deleteByChapter(auPath, n);
            }
            // 陈旧孤儿清扫：内存里属于「快照外且磁盘上已不存在的章」的向量是漂移垃圾
            // （removeChapter 失败残留等），rebuild 的修复语义要求把它们一并清掉。
            for (const n of eng.listChapterNums()) {
              if (snapshotNums.has(n)) continue;
              if (!(await chapterRepo.exists(auPath, n))) {
                await eng.deleteByChapter(auPath, n);
              }
            }
            await eng.indexChunks(buffered);
            // 无论有无章节都 persist（0 章节时需要写入空索引覆盖旧数据）
            await eng.persist(vectorsDir(auPath));
          } catch (err) {
            // 快段中途失败：内存可能已清但 persist 未成 → 驱逐该 AU 引擎，下次 engineFor 强制
            // 从磁盘 reload，回到 rebuild 之前的状态（不留空内存 → 0 召回）。
            this.evict(auPath);
            throw err;
          }
        }),
      { signal, epoch },
    );
  }

  /**
   * 慢段：切块 + embed，产出待注入的 chunks（**不碰引擎状态**，可并发）。
   * embed（慢 I/O）先于任何引擎变更：embed 失败时索引未被改动，旧 chunks 仍可召回（fail-safe）。
   */
  private async prepareChapterChunks(
    auPath: string,
    chapterNum: number,
    content: string,
    embeddingProvider: EmbeddingProvider,
    castRegistry?: CastRegistryLike | null,
    characterAliases?: Record<string, string[]> | null,
    signal?: AbortSignal,
  ): Promise<Parameters<JsonVectorEngine["indexChunks"]>[0]> {
    const chunks = splitChapterIntoChunks(content, chapterNum, 500, 1, castRegistry, characterAliases);
    const texts = chunks.map((c) => c.content);
    const embeddings = chunks.length > 0 ? await embeddingProvider.embed(texts, { signal }) : [];

    if (embeddings.length !== texts.length) {
      throw new Error(`Embedding count mismatch: expected ${texts.length}, got ${embeddings.length}`);
    }

    return chunks.map((c, i) => ({
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
