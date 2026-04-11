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
  let vectorEngine: JsonVectorEngine;
  let chapterRepo: FileChapterRepository;
  let ragManager: RagManager;
  let embProvider: FakeEmbeddingProvider;

  beforeEach(() => {
    adapter = new MockAdapter();
    vectorEngine = new JsonVectorEngine(adapter);
    chapterRepo = new FileChapterRepository(adapter);
    ragManager = new RagManager(vectorEngine);
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
      expect(vectorEngine.chunkCount).toBeGreaterThan(0);

      // ensureLoaded again — should NOT reload (would clear chunks)
      await ragManager.ensureLoaded("au1");
      expect(vectorEngine.chunkCount).toBeGreaterThan(0);
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

      expect(vectorEngine.chunkCount).toBeGreaterThan(0);
      // Verify persistence: index.json should exist
      expect(adapter.raw("au1/.vectors/index.json")).toBeTruthy();
    });

    it("does nothing for empty content", async () => {
      await ragManager.indexChapter("au1", 1, "", embProvider);
      expect(vectorEngine.chunkCount).toBe(0);
    });

    it("does not pollute across AUs", async () => {
      const content = "Alice走进了房间。她看到了Bob。一切开始改变。这是一段足够长的文本。";
      await ragManager.indexChapter("au1", 1, content, embProvider);
      const au1Count = vectorEngine.chunkCount;

      // Switch to au2 and index there
      await ragManager.indexChapter("au2", 1, content, embProvider);

      // au2 should have its own index, not carry au1's chunks
      // (load() resets chunks, then indexes au2 only)
      // Verify au2's index.json exists
      expect(adapter.raw("au2/.vectors/index.json")).toBeTruthy();

      // Reload au1 and verify its persisted chunks are intact
      await ragManager.ensureLoaded("au1");
      expect(vectorEngine.chunkCount).toBe(au1Count);
    });
  });

  describe("rebuildForAu", () => {
    it("rebuilds index from all chapters", async () => {
      // Seed two chapters
      await chapterRepo.save(createChapter({
        au_id: "au1", chapter_num: 1,
        content: "第一章的内容。Alice在这里。足够长的文本以生成chunk数据。",
      }));
      await chapterRepo.save(createChapter({
        au_id: "au1", chapter_num: 2,
        content: "第二章的内容。Bob在这里。同样足够长的文本以生成chunk数据。",
      }));

      await ragManager.rebuildForAu("au1", chapterRepo, embProvider);

      expect(vectorEngine.chunkCount).toBeGreaterThan(0);
      expect(adapter.raw("au1/.vectors/index.json")).toBeTruthy();
    });

    it("clears old index before rebuilding", async () => {
      // Index a chapter first
      await ragManager.indexChapter("au1", 1, "旧的内容。足够长的文本以生成chunk数据用于测试。", embProvider);
      const oldCount = vectorEngine.chunkCount;
      expect(oldCount).toBeGreaterThan(0);

      // Seed only chapter 2 (chapter 1 no longer in repo)
      await chapterRepo.save(createChapter({
        au_id: "au1", chapter_num: 2,
        content: "新的第二章。足够长的文本以生成chunk数据用于测试。",
      }));

      await ragManager.rebuildForAu("au1", chapterRepo, embProvider);

      // Should only have chapter 2's chunks, not chapter 1's
      const indexJson = JSON.parse(adapter.raw("au1/.vectors/index.json")!);
      const chapterNums = new Set(indexJson.chunks.map((c: { chapter?: number }) => c.chapter));
      expect(chapterNums.has(1)).toBe(false);
      expect(chapterNums.has(2)).toBe(true);
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
      expect(vectorEngine.chunkCount).toBeGreaterThan(0);
    });
  });
});
