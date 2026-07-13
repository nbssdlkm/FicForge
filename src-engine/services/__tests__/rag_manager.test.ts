// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import { RagManager } from "../rag_manager.js";
import { JsonVectorEngine } from "../../vector/engine.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import { createChapter } from "../../domain/chapter.js";
import type { EmbeddingProvider } from "../../llm/embedding_provider.js";

/** Fake embedding provider that returns deterministic vectors. */
class FakeEmbeddingProvider implements EmbeddingProvider {
  private callCount = 0;

  /** TD-020 判别用：免嵌重扫断言 embed 调用数不增长。 */
  get calls(): number {
    return this.callCount;
  }

  async embed(texts: string[]): Promise<number[][]> {
    this.callCount++;
    return texts.map((_, i) => [1, 0, 0, (this.callCount * 10 + i) / 100]);
  }

  get_dimension(): number {
    return 4;
  }

  get_model_name(): string {
    return "fake-embed";
  }
}

describe("RagManager", () => {
  let adapter: MockAdapter;
  let chapterRepo: FileChapterRepository;
  let ragManager: RagManager;
  let embProvider: FakeEmbeddingProvider;

  beforeEach(() => {
    adapter = new MockAdapter();
    chapterRepo = new FileChapterRepository(adapter);
    // TD-017：per-AU 引擎工厂 —— 每 AU 独立实例。chunk 数用 ragManager.chunkCountFor(au) 探。
    ragManager = new RagManager(() => new JsonVectorEngine(adapter));
    embProvider = new FakeEmbeddingProvider();
  });

  describe("ensureLoaded", () => {
    it("loads the AU and tracks it as current", async () => {
      await ragManager.ensureLoaded("au1");
      expect(ragManager.loadedAu).toBe("au1");
    });

    it("skips reload if same AU already loaded", async () => {
      await ragManager.ensureLoaded("au1");
      // Index a chapter so we can verify chunks survive
      await ragManager.indexChapter("au1", 1, "Some test content for the chapter.", embProvider);
      expect(ragManager.chunkCountFor("au1")).toBeGreaterThan(0);

      // ensureLoaded again — should NOT reload (would clear chunks)
      await ragManager.ensureLoaded("au1");
      expect(ragManager.chunkCountFor("au1")).toBeGreaterThan(0);
    });

    it("switches AU: unloads previous, loads new", async () => {
      await ragManager.ensureLoaded("au1");
      expect(ragManager.loadedAu).toBe("au1");

      await ragManager.ensureLoaded("au2");
      expect(ragManager.loadedAu).toBe("au2");
    });
  });

  describe("indexChapter", () => {
    it("creates vector chunks and persists to .vectors/", async () => {
      const content = "Alice走进了房间。她看到了Bob。一切开始改变。这是一段足够长的文本来确保能生成chunk。";
      await ragManager.indexChapter("au1", 1, content, embProvider);

      expect(ragManager.chunkCountFor("au1")).toBeGreaterThan(0);
      // Verify persistence: index.json should exist
      expect(adapter.raw("au1/.vectors/index.json")).toBeTruthy();
    });

    it("does nothing for empty content", async () => {
      await ragManager.indexChapter("au1", 1, "", embProvider);
      expect(ragManager.chunkCountFor("au1")).toBe(0);
    });

    it("does not pollute across AUs", async () => {
      const content = "Alice走进了房间。她看到了Bob。一切开始改变。这是一段足够长的文本。";
      await ragManager.indexChapter("au1", 1, content, embProvider);
      const au1Count = ragManager.chunkCountFor("au1");

      // Switch to au2 and index there
      await ragManager.indexChapter("au2", 1, content, embProvider);

      // au2 should have its own index, not carry au1's chunks
      // (load() resets chunks, then indexes au2 only)
      // Verify au2's index.json exists
      expect(adapter.raw("au2/.vectors/index.json")).toBeTruthy();

      // Reload au1 and verify its persisted chunks are intact
      await ragManager.ensureLoaded("au1");
      expect(ragManager.chunkCountFor("au1")).toBe(au1Count);
    });
  });

  describe("rebuildForAu", () => {
    it("rebuilds index from all chapters", async () => {
      // Seed two chapters
      await chapterRepo.save(
        createChapter({
          au_id: "au1",
          chapter_num: 1,
          content: "第一章的内容。Alice在这里。足够长的文本以生成chunk数据。",
        }),
      );
      await chapterRepo.save(
        createChapter({
          au_id: "au1",
          chapter_num: 2,
          content: "第二章的内容。Bob在这里。同样足够长的文本以生成chunk数据。",
        }),
      );

      await ragManager.rebuildForAu("au1", chapterRepo, embProvider);

      expect(ragManager.chunkCountFor("au1")).toBeGreaterThan(0);
      expect(adapter.raw("au1/.vectors/index.json")).toBeTruthy();
    });

    it("handles 0 chapters gracefully", async () => {
      // Pre-index a chapter, then rebuild with no chapters in repo
      await ragManager.indexChapter("au1", 1, "旧内容。足够长的文本以生成chunk数据。", embProvider);
      expect(ragManager.chunkCountFor("au1")).toBeGreaterThan(0);

      // Rebuild with empty repo → should produce empty index
      await ragManager.rebuildForAu("au1", chapterRepo, embProvider);

      expect(ragManager.chunkCountFor("au1")).toBe(0);
      const indexJson = JSON.parse(adapter.raw("au1/.vectors/index.json")!);
      expect(indexJson.total_chunks).toBe(0);
    });

    it("T7-8: unloads AU when embedding fails mid-rebuild, so next ensureLoaded recovers from disk", async () => {
      // 1. 先索引一章到磁盘（模拟用户"重建索引"之前的 happy state）
      await chapterRepo.save(
        createChapter({
          au_id: "au1",
          chapter_num: 1,
          content: "第一章内容。Alice 出场。足够长的文本以生成 chunk 数据用于测试。",
        }),
      );
      await ragManager.indexChapter(
        "au1",
        1,
        "第一章内容。Alice 出场。足够长的文本以生成 chunk 数据用于测试。",
        embProvider,
      );
      const seededCount = ragManager.chunkCountFor("au1");
      expect(seededCount).toBeGreaterThan(0);

      // 2. embedding provider 在第 1 次调用时成功（让 rebuild_index 已清内存），
      //    第 2 次调用时抛错（模拟重建中途断网）
      const failingEmb: EmbeddingProvider = {
        async embed(): Promise<number[][]> {
          throw new Error("network_error: embedding provider unreachable");
        },
        get_dimension: () => 4,
        get_model_name: () => "failing-embed",
      };

      // 3. rebuildForAu 必须抛错
      await expect(ragManager.rebuildForAu("au1", chapterRepo, failingEmb)).rejects.toThrow("network_error");

      // 4. 关键断言（T7-8 真不变量：失败的 rebuild 不得造成 0 召回）。
      //    缓冲式重建（盲审 2026-07-11 B3）后 embed 失败发生在触碰引擎之前 ——
      //    内存根本未被清空，旧 chunks 原样可召回，比旧「清空→驱逐→靠 reload 恢复」更强。
      expect(ragManager.chunkCountFor("au1")).toBe(seededCount);

      // 5. 磁盘上的旧 chunks 仍然完好（rebuild_index 只清内存，persist 没执行）
      expect(adapter.raw("au1/.vectors/index.json")).toBeTruthy();

      // 6. 再次 ensureLoaded 应从磁盘重新载入，内存恢复到 rebuild 之前的状态
      await ragManager.ensureLoaded("au1");
      expect(ragManager.loadedAu).toBe("au1");
      expect(ragManager.chunkCountFor("au1")).toBe(seededCount);
    });

    it("clears old index before rebuilding", async () => {
      // Index a chapter first
      await ragManager.indexChapter("au1", 1, "旧的内容。足够长的文本以生成chunk数据用于测试。", embProvider);
      const oldCount = ragManager.chunkCountFor("au1");
      expect(oldCount).toBeGreaterThan(0);

      // Seed only chapter 2 (chapter 1 no longer in repo)
      await chapterRepo.save(
        createChapter({
          au_id: "au1",
          chapter_num: 2,
          content: "新的第二章。足够长的文本以生成chunk数据用于测试。",
        }),
      );

      await ragManager.rebuildForAu("au1", chapterRepo, embProvider);

      // Should only have chapter 2's chunks, not chapter 1's
      const indexJson = JSON.parse(adapter.raw("au1/.vectors/index.json")!);
      const chapterNums = new Set(indexJson.chunks.map((c: { chapter?: number }) => c.chapter));
      expect(chapterNums.has(1)).toBe(false);
      expect(chapterNums.has(2)).toBe(true);
    });
  });

  describe("indexChapter — overwrite", () => {
    it("H9: re-indexing with shorter content leaves no stale tail chunk ch{N}_{k}", async () => {
      // 两段各 400 字 → 2 个 chunk（ch1_0 / ch1_1）
      const longContent = `${"甲".repeat(400)}\n\n${"乙".repeat(400)}`;
      await ragManager.indexChapter("au1", 1, longContent, embProvider);
      const idsBefore = JSON.parse(adapter.raw("au1/.vectors/index.json")!).chunks.map((c: { id: string }) => c.id);
      expect(idsBefore).toContain("ch1_1");

      // 重索引成 1 个 chunk 的短内容 → 旧尾部 ch1_1 必须消失（内存 + 落盘）
      const shortContent = "短文本内容。".repeat(30);
      await ragManager.indexChapter("au1", 1, shortContent, embProvider);

      expect(ragManager.chunkCountFor("au1")).toBe(1);
      const idsAfter = JSON.parse(adapter.raw("au1/.vectors/index.json")!).chunks.map((c: { id: string }) => c.id);
      expect(idsAfter).toEqual(["ch1_0"]);

      // 冷启动重载后同样不复活
      ragManager.unload();
      await ragManager.ensureLoaded("au1");
      expect(ragManager.chunkCountFor("au1")).toBe(1);
    });

    it("H9: re-indexing chapter content keeps the chapter's still-valid summary vector sum{N}", async () => {
      // backfill 场景：章已有摘要向量，仅重索引正文 → 不能误删 sum{N}
      await ragManager.indexChapterSummary("au1", 1, "第一章的摘要文本。", embProvider);
      await ragManager.indexChapter("au1", 1, "第一章正文。足够长的文本以生成chunk数据用于测试。", embProvider);

      const ids = JSON.parse(adapter.raw("au1/.vectors/index.json")!).chunks.map((c: { id: string }) => c.id);
      expect(ids).toContain("sum1");
      expect(ids).toContain("ch1_0");
    });

    it("replaces chunks when re-indexing the same chapter", async () => {
      const contentV1 = "第一版内容。Alice在这里。足够长的文本以生成chunk数据。";
      await ragManager.indexChapter("au1", 1, contentV1, embProvider);
      const countV1 = ragManager.chunkCountFor("au1");

      // Re-index same chapter with different content
      const contentV2 = "第二版内容。Bob在这里。同样足够长的文本以生成chunk数据。";
      await ragManager.indexChapter("au1", 1, contentV2, embProvider);
      const countV2 = ragManager.chunkCountFor("au1");

      // Chunk count should be the same (replaced, not appended)
      expect(countV2).toBe(countV1);

      // Verify persisted content is V2
      const indexJson = JSON.parse(adapter.raw("au1/.vectors/index.json")!);
      for (const entry of indexJson.chunks) {
        const chunkFile = adapter.raw(`au1/.vectors/${entry.file}`);
        expect(chunkFile).toBeTruthy();
        const chunkData = JSON.parse(chunkFile!);
        expect(chunkData.content).not.toContain("第一版");
      }
    });
  });

  describe("removeChapter (H9)", () => {
    it("removes ch{N}_* chunks and sum{N} from memory and persisted index; survives cold reload", async () => {
      await ragManager.indexChapter("au1", 1, "第一章正文。足够长的文本以生成chunk数据用于测试。", embProvider);
      await ragManager.indexChapterSummary("au1", 1, "第一章摘要。", embProvider);
      await ragManager.indexChapter("au1", 2, "第二章正文。足够长的文本以生成chunk数据用于测试。", embProvider);
      await ragManager.indexChapterSummary("au1", 2, "第二章摘要。", embProvider);

      await ragManager.removeChapter("au1", 1);

      // 内存：ch1_* 与 sum1 消失，第 2 章完好
      const idsInMemory = JSON.parse(adapter.raw("au1/.vectors/index.json")!).chunks.map((c: { id: string }) => c.id);
      expect(idsInMemory.some((id: string) => id.startsWith("ch1_"))).toBe(false);
      expect(idsInMemory).not.toContain("sum1");
      expect(idsInMemory).toContain("ch2_0");
      expect(idsInMemory).toContain("sum2");

      // 冷启动重载（rebuild-from-disk）：被删向量不复活
      ragManager.unload();
      await ragManager.ensureLoaded("au1");
      const survivors = JSON.parse(adapter.raw("au1/.vectors/index.json")!).chunks.map((c: { id: string }) => c.id);
      expect(survivors.some((id: string) => id.startsWith("ch1_") || id === "sum1")).toBe(false);
      expect(ragManager.chunkCountFor("au1")).toBe(2); // ch2_0 + sum2
    });

    it("works without any embedding provider involvement (deletion needs no embedding)", async () => {
      await ragManager.indexChapter("au1", 1, "第一章正文。足够长的文本以生成chunk数据用于测试。", embProvider);
      // 换一个全新 manager（模拟另一会话 / 冷启动），不传任何 embedding 即可删除
      const freshManager = new RagManager(() => new JsonVectorEngine(adapter));
      await freshManager.removeChapter("au1", 1);
      // 由 freshManager 执行删除 → 探它自己的引擎（ragManager 的 au1 引擎未重载，仍持旧内存）
      expect(freshManager.chunkCountFor("au1")).toBe(0);
    });

    it("is a no-op for never-indexed AUs and does not create an empty .vectors/", async () => {
      await ragManager.removeChapter("au-no-vectors", 3);
      expect(adapter.raw("au-no-vectors/.vectors/index.json")).toBeUndefined();
    });
  });

  describe("unloadIfCurrent (H9)", () => {
    it("unloads only when the given AU is the currently loaded one", async () => {
      await ragManager.ensureLoaded("au1");

      ragManager.unloadIfCurrent("au2");
      expect(ragManager.loadedAu).toBe("au1");

      ragManager.unloadIfCurrent("au1");
      expect(ragManager.loadedAu).toBeNull();
    });

    it("prevents a recreated same-path AU from inheriting the deleted AU's in-memory chunks", async () => {
      await ragManager.indexChapter("au1", 1, "已删作品的正文。足够长的文本以生成chunk数据用于测试。", embProvider);
      expect(ragManager.chunkCountFor("au1")).toBeGreaterThan(0);

      // 模拟 deleteAu：树移入 trash（磁盘索引消失）+ 卸载内存
      await adapter.deleteFile("au1/.vectors/index.json");
      ragManager.unloadIfCurrent("au1");

      // 同名重建后首次 ensureLoaded 必须从磁盘 load（空），不得复用旧内存 chunks
      await ragManager.ensureLoaded("au1");
      expect(ragManager.chunkCountFor("au1")).toBe(0);
    });
  });

  describe("unload", () => {
    it("resets current AU tracking", async () => {
      await ragManager.ensureLoaded("au1");
      expect(ragManager.loadedAu).toBe("au1");

      ragManager.unload();
      expect(ragManager.loadedAu).toBeNull();
    });

    it("after unload, ensureLoaded triggers fresh load", async () => {
      await ragManager.indexChapter("au1", 1, "内容文本。足够长的文本以生成chunk数据。", embProvider);
      ragManager.unload();

      // ensureLoaded should trigger load() again (not skip)
      await ragManager.ensureLoaded("au1");
      expect(ragManager.loadedAu).toBe("au1");
      // After fresh load from persisted data, chunks should be restored
      expect(ragManager.chunkCountFor("au1")).toBeGreaterThan(0);
    });
  });

  describe("TD-017: 跨 AU 并发隔离", () => {
    it("AU1 的 embed 挂起期间并发索引 AU2 → 两 AU 的 .vectors 各自纯净、无交叉污染", async () => {
      // 可控 embedding：au1 的 embed 挂起直到手动释放；au2 立即返回。
      let releaseAu1: () => void = () => {};
      const au1Gate = new Promise<void>((r) => {
        releaseAu1 = r;
      });
      const controllableEmb: EmbeddingProvider = {
        async embed(texts: string[]): Promise<number[][]> {
          if (texts.some((t) => t.includes("AU1内容"))) await au1Gate; // au1 卡在 embed
          return texts.map((_, i) => [1, 0, 0, (i + 1) / 100]);
        },
        get_dimension: () => 4,
        get_model_name: () => "ctrl",
      };

      // 并发：au1 索引（embed 挂起）与 au2 索引（立即完成 + persist）。
      const au1P = ragManager.indexChapter("au1", 1, "AU1内容。".repeat(80), controllableEmb);
      const au2P = ragManager.indexChapter("au2", 1, "AU2内容。".repeat(80), controllableEmb);
      await au2P; // au2 在 au1 仍卡 embed 期间完成并落盘（正是竞态窗口）
      releaseAu1();
      await au1P; // 释放后 au1 完成并落盘

      // 断言：每个 AU 的落盘索引分片只含**自身** au_id / 内容。
      // 回退到单例共享引擎：au1 的 post-embed index/persist 会把 au2 的 chunk 一并写进 au1/index.json
      // （au_id=au2）→ 下面断言即挂。
      for (const au of ["au1", "au2"] as const) {
        const index = JSON.parse(adapter.raw(`${au}/.vectors/index.json`)!);
        expect(index.chunks.length).toBeGreaterThan(0);
        for (const entry of index.chunks) {
          const chunk = JSON.parse(adapter.raw(`${au}/.vectors/${entry.file}`)!);
          expect(chunk.metadata.au_id).toBe(au);
          expect(chunk.content).toContain(au === "au1" ? "AU1内容" : "AU2内容");
        }
      }
    });

    it("发现1: 加载在飞期间被 unloadIfCurrent → epoch 守卫使续约不复活该 AU 引擎", async () => {
      // au1 已索引落盘（磁盘有向量）
      await ragManager.indexChapter("au1", 1, "au1内容。".repeat(80), embProvider);

      // 可控 load 的工厂：load 挂起直到释放
      let releaseLoad: () => void = () => {};
      const gate = new Promise<void>((r) => {
        releaseLoad = r;
      });
      const gatedMgr = new RagManager(() => {
        const eng = new JsonVectorEngine(adapter);
        const origLoad = eng.load.bind(eng);
        eng.load = async (dir: string) => {
          await gate;
          return origLoad(dir);
        };
        return eng;
      });

      const loadP = gatedMgr.ensureLoaded("au1"); // load 在飞
      gatedMgr.unloadIfCurrent("au1"); // 删除该 AU（evict：从 loading 移除本 promise）
      releaseLoad();
      await loadP;

      // 续约检查 loading.get(au1) !== 本 promise → 不落库。
      // 回退旧码（无 epoch 守卫）会 engines.set(au1) 复活已删向量 → chunkCountFor>0、loadedAu=au1（此断言即挂）。
      expect(gatedMgr.chunkCountFor("au1")).toBe(0);
      expect(gatedMgr.loadedAu).toBeNull();
    });

    it("发现2: 在用引擎被 pin，同 AU 并发操作复用之，更新不因 LRU 驱逐丢失", async () => {
      const mgr = new RagManager(() => new JsonVectorEngine(adapter), 1); // maxEngines=1 激进驱逐
      let release: () => void = () => {};
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const gatedEmb: EmbeddingProvider = {
        async embed(texts: string[]): Promise<number[][]> {
          if (texts.some((t) => t.includes("GATE"))) await gate;
          return texts.map((_, i) => [1, 0, 0, (i + 1) / 100]);
        },
        get_dimension: () => 4,
        get_model_name: () => "g",
      };

      // au1 索引 ch1：embed 挂起（withEngine pin 住 au1）
      const au1ch1 = mgr.indexChapter("au1", 1, "GATE内容。".repeat(80), gatedEmb);
      // 让 au1ch1 推进到 pin + embed 挂起（宏任务让步，确保 load 完成、pin 已置）
      await new Promise((r) => setTimeout(r, 0));
      // 并发 au2 索引：engineFor(au2) 触发 evictExcess（size 2 > 1），au1 pinned → 不被驱逐；
      // 跨 AU 不进 au1 的写队列，照常并行完成
      await mgr.indexChapter("au2", 1, "AU2内容。".repeat(80), gatedEmb);
      // 同 AU 索引 ch2：盲审 2026-07-11 写队列串行化后它会排在 ch1 之后 —— 只发起不 await
      //（旧断言意图不变：pin 保证复用同一引擎、ch2 不因驱逐/互覆丢失）
      const au1ch2 = mgr.indexChapter("au1", 2, "au1第二章。".repeat(80), gatedEmb);
      release();
      await Promise.all([au1ch1, au1ch2]);

      // au1 落盘同时含 ch1 与 ch2 —— 无 pin + maxEngines=1 时 au1 被驱逐、两操作各自引擎互覆 → ch2 丢（断言挂）。
      const ids = JSON.parse(adapter.raw("au1/.vectors/index.json")!).chunks.map((c: { id: string }) => c.id);
      expect(ids.some((id: string) => id.startsWith("ch1_"))).toBe(true);
      expect(ids.some((id: string) => id.startsWith("ch2_"))).toBe(true);
    });
  });
});

describe("同 AU 并发写串行化（盲审 2026-07-11：persist 孤儿分片 GC 竞态）", () => {
  /** 可手动放行的 embedding provider：精确控制交错时序。 */
  class GatedEmbeddingProvider implements EmbeddingProvider {
    gates: Array<() => void> = [];
    calls = 0;
    async embed(texts: string[]): Promise<number[][]> {
      this.calls++;
      await new Promise<void>((resolve) => this.gates.push(resolve));
      return texts.map((_, i) => [1, 0, 0, (this.calls * 10 + i) / 100]);
    }
    get_dimension(): number {
      return 4;
    }
    get_model_name(): string {
      return "gated-embed";
    }
    /** 放行下一个在等待的 embed。 */
    release(): void {
      const g = this.gates.shift();
      if (g) g();
    }
    async waitForPending(n: number): Promise<void> {
      while (this.gates.length < n) await new Promise((r) => setTimeout(r, 0));
    }
  }

  it("并发 rebuild 与 indexChapter：embed 并发跑（不占队），persist 快段严格互斥，端态三章齐全", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    // 追踪 persist 区间：写队列存在时同 AU 的 persist 必须严格串行（enter 后必先 exit 才能再 enter）
    const persistLog: string[] = [];
    class TrackingEngine extends JsonVectorEngine {
      async persist(dir: string): Promise<void> {
        persistLog.push("enter");
        try {
          return await super.persist(dir);
        } finally {
          persistLog.push("exit");
        }
      }
    }
    const ragManager = new RagManager(() => new TrackingEngine(adapter));
    const gated = new GatedEmbeddingProvider();

    await chapterRepo.save(createChapter({ au_id: "auC", chapter_num: 1, content: "第一章正文内容。" }));
    await chapterRepo.save(createChapter({ au_id: "auC", chapter_num: 2, content: "第二章正文内容。" }));

    // rebuild 慢段阻塞在 ch1 embed（快慢分离：此期间不占写队列）
    const rebuild = ragManager.rebuildForAu("auC", chapterRepo, gated);
    await gated.waitForPending(1);

    // 并发 indexChapter(ch3)：其 embed 与 rebuild 的 embed 并发挂起（B3 整改后的预期行为）。
    // 章文件先落盘（真实 confirm 流的顺序）—— 否则 rebuild 快段的孤儿清扫会把
    // 「内存有向量但磁盘无章文件」的 ch3 正确地当漂移垃圾清掉。
    await chapterRepo.save(createChapter({ au_id: "auC", chapter_num: 3, content: "第三章正文内容。" }));
    const index3 = ragManager.indexChapter("auC", 3, "第三章正文内容。", gated);
    await gated.waitForPending(2);
    expect(gated.gates.length).toBe(2); // 两个 embed 并发在等 —— 慢段确实不互斥

    // 同一 tick 全部放行，逼两个快段同时争队列
    gated.release();
    gated.release();
    await gated.waitForPending(1); // rebuild ch2 embed
    gated.release();
    await Promise.all([rebuild, index3]);

    // 快段严格互斥：persist 区间不得交错（无串行化时 enter,enter 交错 → GC 竞态窗口）
    for (let i = 0; i < persistLog.length; i += 2) {
      expect(persistLog[i]).toBe("enter");
      expect(persistLog[i + 1]).toBe("exit");
    }

    // 端到端完整性：全新加载，三章向量齐全（rebuild 的选择性清扫不误删快照外新章）
    const fresh = new JsonVectorEngine(adapter);
    await fresh.load("auC/.vectors");
    const nums = fresh.listChapterNums().sort();
    expect(nums).toEqual([1, 2, 3]);
  });

  it("排队等待期 AU 被删除（unloadIfCurrent）：出队写静默跳过，不复活 .vectors", async () => {
    const adapter = new MockAdapter();
    const ragManager = new RagManager(() => new JsonVectorEngine(adapter));
    const gated = new GatedEmbeddingProvider();

    // indexChapter 慢段（embed）挂起期间删除 AU
    const write = ragManager.indexChapter("auG", 1, "内容。", gated);
    await gated.waitForPending(1);
    ragManager.unloadIfCurrent("auG"); // deleteAu 语义：epoch +1
    gated.release();
    await write; // 出队时 epoch 不符 → 跳过，不抛错（AU 已删，写无意义）

    expect(adapter.raw("auG/.vectors/index.json")).toBeUndefined();
  });

  it("前序写失败不阻塞后续写（队尾已 catch）", async () => {
    const adapter = new MockAdapter();
    const ragManager = new RagManager(() => new JsonVectorEngine(adapter));
    const failing: EmbeddingProvider = {
      embed: async () => {
        throw new Error("embed down");
      },
      get_dimension: () => 4,
      get_model_name: () => "failing",
    };
    await expect(ragManager.indexChapter("auD", 1, "内容一。", failing)).rejects.toThrow("embed down");

    const good = new FakeEmbeddingProvider();
    await ragManager.indexChapter("auD", 2, "内容二。", good);
    expect(ragManager.chunkCountFor("auD")).toBeGreaterThan(0);
  });

  it("不同 AU 的写互不排队（跨 AU 仍并行）", async () => {
    const adapter = new MockAdapter();
    const ragManager = new RagManager(() => new JsonVectorEngine(adapter));
    const gated = new GatedEmbeddingProvider();

    // auE 的写阻塞在 embed 上
    const slow = ragManager.indexChapter("auE", 1, "E 章内容。", gated);
    await gated.waitForPending(1);

    // auF 的写不该被 auE 的队列挡住 —— 用 Fake 直接完成
    const fast = new FakeEmbeddingProvider();
    await ragManager.indexChapter("auF", 1, "F 章内容。", fast);
    expect(ragManager.chunkCountFor("auF")).toBeGreaterThan(0);

    gated.release();
    await slow;
  });
});

describe("TD-020 rescanChunkCharacters（免嵌 metadata 重扫）", () => {
  const cast = { characters: ["张三", "李四"] };
  const aliases = { 张三: ["小张", "阿三"], 李四: ["小李"] };
  const aliasOnlyText = "小张走在路上，神色凝重。小李跟在后面，欲言又止。两人一路无话，各怀心事。";

  let adapter: MockAdapter;
  let ragManager: RagManager;
  let embProvider: FakeEmbeddingProvider;

  beforeEach(() => {
    adapter = new MockAdapter();
    ragManager = new RagManager(() => new JsonVectorEngine(adapter));
    embProvider = new FakeEmbeddingProvider();
  });

  it("存量别名盲库：重扫后 char_filter 按主名命中，且不重新 embed", async () => {
    // 1. 模拟存量库：别名盲索引（不供表）——通篇只用别名，标签为空
    await ragManager.indexChapter("au1", 1, aliasOnlyText, embProvider, cast);
    const repo = await ragManager.vectorRepoFor("au1");
    const missBefore = await repo.search("au1", [1, 0, 0, 0.1], {
      collection: "chapters",
      top_k: 10,
      char_filter: ["张三"],
    });
    expect(missBefore).toEqual([]);

    // 2. 免嵌重扫：只动 metadata，embed 调用数不得增长
    const embedCallsBefore = embProvider.calls;
    const changed = await ragManager.rescanChunkCharacters("au1", cast, aliases);
    expect(changed).toBeGreaterThan(0);
    expect(embProvider.calls).toBe(embedCallsBefore);

    // 3. 重扫后 char_filter 命中（内存与磁盘都生效）
    const hitAfter = await repo.search("au1", [1, 0, 0, 0.1], {
      collection: "chapters",
      top_k: 10,
      char_filter: ["张三"],
    });
    expect(hitAfter.length).toBeGreaterThan(0);
    expect(hitAfter[0].content).toContain("小张");

    // 4. 持久化生效：卸载后从磁盘重载仍命中（round-trip 闭环）
    ragManager.unload();
    const repo2 = await ragManager.vectorRepoFor("au1");
    const hitReloaded = await repo2.search("au1", [1, 0, 0, 0.1], {
      collection: "chapters",
      top_k: 10,
      char_filter: ["张三"],
    });
    expect(hitReloaded.length).toBeGreaterThan(0);
  });

  it("幂等：标签无变化时 changed=0（不放大写入）", async () => {
    await ragManager.indexChapter("au2", 1, aliasOnlyText, embProvider, cast, aliases);
    const changed = await ragManager.rescanChunkCharacters("au2", cast, aliases);
    expect(changed).toBe(0);
  });

  it("indexChapter 供表后新块标签直接记主名（全链穿线）", async () => {
    await ragManager.indexChapter("au3", 1, aliasOnlyText, embProvider, cast, aliases);
    const repo = await ragManager.vectorRepoFor("au3");
    const hit = await repo.search("au3", [1, 0, 0, 0.1], {
      collection: "chapters",
      top_k: 10,
      char_filter: ["李四"],
    });
    expect(hit.length).toBeGreaterThan(0);
  });
});

describe("TD-020 rescan 失效面（codex F4 对抗审补测）", () => {
  const cast = { characters: ["张三", "李四"] };
  const aliases = { 张三: ["小张", "阿三"], 李四: ["小李"] };
  const aliasOnlyText = "小张走在路上，神色凝重。小李跟在后面，欲言又止。两人一路无话，各怀心事。";

  let adapter: MockAdapter;
  let ragManager: RagManager;
  let embProvider: FakeEmbeddingProvider;

  beforeEach(() => {
    adapter = new MockAdapter();
    ragManager = new RagManager(() => new JsonVectorEngine(adapter));
    embProvider = new FakeEmbeddingProvider();
  });

  it("persist 失败自愈：首次落盘失败后第二次重扫必须再次 persist（不许 changed=0 永久跳过）", async () => {
    await ragManager.indexChapter("au1", 1, aliasOnlyText, embProvider, cast);

    // 故障注入：下一次 writeFile 抛错（atomicWrite 的 .tmp 写入即失败）
    const realWriteFile = adapter.writeFile.bind(adapter);
    let failOnce = true;
    adapter.writeFile = async (path: string, content: string) => {
      if (failOnce) {
        failOnce = false;
        throw new Error("disk full (injected)");
      }
      return realWriteFile(path, content);
    };
    await expect(ragManager.rescanChunkCharacters("au1", cast, aliases)).rejects.toThrow("disk full");

    // 自愈判据：引擎已被驱逐（内存新标签不残留），第二次重扫从磁盘重读旧标签 → changed>0 并成功落盘
    adapter.writeFile = realWriteFile;
    const changedSecond = await ragManager.rescanChunkCharacters("au1", cast, aliases);
    expect(changedSecond).toBeGreaterThan(0);

    // round-trip：重载后 char_filter 命中（磁盘为准）
    ragManager.unload();
    const repo = await ragManager.vectorRepoFor("au1");
    const hit = await repo.search("au1", [1, 0, 0, 0.1], { collection: "chapters", top_k: 10, char_filter: ["张三"] });
    expect(hit.length).toBeGreaterThan(0);
  });

  it("隔离：只动目标 AU 的 chapters collection——他 AU 与 summaries 向量零触碰", async () => {
    await ragManager.indexChapter("au1", 1, aliasOnlyText, embProvider, cast);
    await ragManager.indexChapterSummary("au1", 1, "本章摘要：两人同行。", embProvider);
    await ragManager.indexChapter("au2", 1, aliasOnlyText, embProvider, cast);

    const changed = await ragManager.rescanChunkCharacters("au1", cast, aliases);
    expect(changed).toBeGreaterThan(0);

    // au2 未供表重扫：标签仍是别名盲（char_filter 不命中）
    const repo2 = await ragManager.vectorRepoFor("au2");
    const au2Hit = await repo2.search("au2", [1, 0, 0, 0.1], {
      collection: "chapters",
      top_k: 10,
      char_filter: ["张三"],
    });
    expect(au2Hit).toEqual([]);

    // au1 summaries 向量原样可检索且未被打上 characters 标签
    const repo1 = await ragManager.vectorRepoFor("au1");
    const sums = await repo1.search("au1", [0.1, 0.2, 0.3, 0.4], { collection: "summaries", top_k: 5 });
    expect(sums.length).toBe(1);
    expect(sums[0].metadata.characters).toBeUndefined();
  });
});
