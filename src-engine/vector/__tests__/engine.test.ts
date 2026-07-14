// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import { cosineSimilarity, JsonVectorEngine } from "../engine.js";
import type { VectorChunk } from "../../repositories/interfaces/vector.js";

// Re-use mock adapter
class MockAdapter {
  private files = new Map<string, string>();
  async readFile(path: string) {
    const c = this.files.get(path);
    if (!c) throw new Error("Not found");
    return c;
  }
  async writeFile(path: string, content: string) {
    this.files.set(path, content);
  }
  async deleteFile(path: string) {
    this.files.delete(path);
  }
  // atomicWrite 依赖（写 .tmp → rename 原子替换），与真实三端 adapter 契约一致
  async rename(oldPath: string, newPath: string) {
    const c = this.files.get(oldPath);
    if (c === undefined) throw new Error(`rename: source not found: ${oldPath}`);
    this.files.set(newPath, c);
    this.files.delete(oldPath);
  }
  async listDir(path: string) {
    const prefix = `${path}/`;
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        names.add(key.slice(prefix.length).split("/")[0]);
      }
    }
    return [...names];
  }
  async exists(path: string) {
    if (this.files.has(path)) return true;
    for (const key of this.files.keys()) {
      if (key.startsWith(`${path}/`)) return true;
    }
    return false;
  }
  async mkdir() {}
  async showSaveDialog() {
    return null;
  }
  async showOpenDialog() {
    return null;
  }
  getPlatform() {
    return "web" as const;
  }
  async getDataDir() {
    return "/mock";
  }
  getDeviceId() {
    return "mock";
  }
}

describe("cosineSimilarity", () => {
  it("identical vectors → 1.0", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0);
  });

  it("orthogonal vectors → 0.0", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it("opposite vectors → -1.0", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it("known similarity value", () => {
    // cos([1,2,3], [4,5,6]) = 32 / (sqrt(14) * sqrt(77)) ≈ 0.9746
    const sim = cosineSimilarity([1, 2, 3], [4, 5, 6]);
    expect(sim).toBeCloseTo(0.9746, 3);
  });

  it("zero vector → 0", () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe("JsonVectorEngine", () => {
  let adapter: MockAdapter;
  let engine: JsonVectorEngine;

  function makeChunk(
    id: string,
    collection: "chapters" | "characters" | "worldbuilding" | "summaries",
    embedding: number[],
    meta: Record<string, unknown> = {},
  ): VectorChunk {
    return {
      id,
      collection,
      content: `Content of ${id}`,
      embedding,
      metadata: { au_id: "au1", chunk_index: 0, branch_id: "main", ...meta },
    };
  }

  beforeEach(() => {
    adapter = new MockAdapter();
    engine = new JsonVectorEngine(adapter as any);
  });

  it("index and search", async () => {
    await engine.indexChunks([
      makeChunk("c1", "chapters", [1, 0, 0], { chapter: 1 }),
      makeChunk("c2", "chapters", [0, 1, 0], { chapter: 2 }),
      makeChunk("c3", "chapters", [0.9, 0.1, 0], { chapter: 3 }),
    ]);

    const results = await engine.search("au1", [1, 0, 0], { collection: "chapters", top_k: 2 });
    expect(results).toHaveLength(2);
    expect(results[0].content).toBe("Content of c1"); // highest similarity
  });

  it("search respects AU isolation", async () => {
    await engine.indexChunks([
      makeChunk("c1", "chapters", [1, 0], { au_id: "au1", chapter: 1 }),
      makeChunk("c2", "chapters", [1, 0], { au_id: "au2", chapter: 1 }),
    ]);

    const results = await engine.search("au1", [1, 0], { collection: "chapters", top_k: 10 });
    expect(results).toHaveLength(1);
  });

  it("search with character filter", async () => {
    await engine.indexChunks([
      makeChunk("c1", "chapters", [1, 0], { chapter: 1, characters: "Alice,Bob" }),
      makeChunk("c2", "chapters", [0.9, 0.1], { chapter: 2, characters: "Charlie" }),
    ]);

    const results = await engine.search("au1", [1, 0], {
      collection: "chapters",
      top_k: 10,
      char_filter: ["Alice"],
    });
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("Content of c1");
  });

  it("deleteByChapter removes chunks", async () => {
    await engine.indexChunks([
      makeChunk("c1", "chapters", [1, 0], { chapter: 1 }),
      makeChunk("c2", "chapters", [0, 1], { chapter: 2 }),
    ]);

    await engine.deleteByChapter("au1", 1);
    const results = await engine.search("au1", [1, 0], { collection: "chapters", top_k: 10 });
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("Content of c2");
  });

  it("deleteByChapter without collection removes the chapter's vectors across collections (ch chunks + summary)", async () => {
    await engine.indexChunks([
      makeChunk("ch1_0", "chapters", [1, 0], { chapter: 1 }),
      makeChunk("sum1", "summaries", [0, 1], { chapter: 1, kind: "standard" }),
      makeChunk("ch2_0", "chapters", [0, 1], { chapter: 2 }),
      makeChunk("sum2", "summaries", [1, 0], { chapter: 2, kind: "standard" }),
    ]);

    await engine.deleteByChapter("au1", 1);

    expect(engine.chunkCount).toBe(2);
    expect(
      (await engine.search("au1", [1, 0], { collection: "chapters", top_k: 10 })).map((r) => r.chapter_num),
    ).toEqual([2]);
    expect(
      (await engine.search("au1", [1, 0], { collection: "summaries", top_k: 10 })).map((r) => r.chapter_num),
    ).toEqual([2]);
  });

  it("deleteByChapter with collection only removes that collection (keeps valid summary vector)", async () => {
    await engine.indexChunks([
      makeChunk("ch1_0", "chapters", [1, 0], { chapter: 1 }),
      makeChunk("ch1_1", "chapters", [0.5, 0.5], { chapter: 1, chunk_index: 1 }),
      makeChunk("sum1", "summaries", [0, 1], { chapter: 1, kind: "standard" }),
    ]);

    await engine.deleteByChapter("au1", 1, "chapters");

    expect(engine.chunkCount).toBe(1);
    expect(await engine.search("au1", [1, 0], { collection: "chapters", top_k: 10 })).toEqual([]);
    const summaries = await engine.search("au1", [0, 1], { collection: "summaries", top_k: 10 });
    expect(summaries).toHaveLength(1);
    expect(summaries[0].chapter_num).toBe(1);
  });

  it("deleteByChapter respects AU isolation", async () => {
    await engine.indexChunks([
      makeChunk("ch1_0", "chapters", [1, 0], { au_id: "au1", chapter: 1 }),
      makeChunk("ch1_0b", "chapters", [1, 0], { au_id: "au2", chapter: 1 }),
    ]);

    await engine.deleteByChapter("au1", 1);

    expect(engine.chunkCount).toBe(1);
    expect(await engine.search("au2", [1, 0], { collection: "chapters", top_k: 10 })).toHaveLength(1);
  });

  it("deleteBySource removes chunks", async () => {
    await engine.indexChunks([
      makeChunk("s1", "characters", [1, 0], { source_file: "Connor.md" }),
      makeChunk("s2", "characters", [0, 1], { source_file: "Hank.md" }),
    ]);

    await engine.deleteBySource("au1", "Connor.md");
    expect(engine.chunkCount).toBe(1);
  });

  it("persist and reload", async () => {
    await engine.indexChunks([
      makeChunk("c1", "chapters", [1, 0, 0], { chapter: 1 }),
      makeChunk("c2", "characters", [0, 1, 0], { source_file: "Connor.md" }),
    ]);

    await engine.persist("/vectors");

    // Create a new engine and load
    const engine2 = new JsonVectorEngine(adapter as any);
    await engine2.load("/vectors");
    expect(engine2.chunkCount).toBe(2);

    const results = await engine2.search("au1", [1, 0, 0], { collection: "chapters", top_k: 1 });
    expect(results).toHaveLength(1);
  });

  // L18（审计第二轮）：persist 清理孤儿分片——chunk 数变少后旧 .json 分片不该永久残留。
  it("L18: persist 删除不在本次写入集合中的旧分片文件，load 仍正常", async () => {
    // 第一次：3 章 chunk 落盘
    await engine.indexChunks([
      makeChunk("ch1_0", "chapters", [1, 0, 0], { chapter: 1 }),
      makeChunk("ch2_0", "chapters", [0, 1, 0], { chapter: 2 }),
      makeChunk("ch3_0", "chapters", [0, 0, 1], { chapter: 3 }),
    ]);
    await engine.persist("/vectors");
    expect(await adapter.exists("/vectors/chapters/ch3_0.json")).toBe(true);

    // 模拟 undo 第 3 章：删该章 chunk，再 persist —— 旧 ch3_0.json 应被清理
    await engine.deleteByChapter("au1", 3);
    await engine.persist("/vectors");

    // 孤儿分片文件消失
    expect(await adapter.exists("/vectors/chapters/ch3_0.json")).toBe(false);
    // 保留的分片仍在
    expect(await adapter.exists("/vectors/chapters/ch1_0.json")).toBe(true);
    expect(await adapter.exists("/vectors/chapters/ch2_0.json")).toBe(true);

    // load 正常：只剩 2 个 chunk，index.json 与磁盘一致
    const engine2 = new JsonVectorEngine(adapter as any);
    await engine2.load("/vectors");
    expect(engine2.chunkCount).toBe(2);
    const results = await engine2.search("au1", [0, 0, 1], { collection: "chapters", top_k: 3 });
    // ch3 已删，不该被召回
    expect(results.find((r) => r.content.includes("ch3_0"))).toBeUndefined();
  });

  // F-10（第三波对抗审）：GC 必须在 index.json 写成功之后 —— 若先删分片再写 index，
  // 中间崩溃会留下「旧 index 引用已删分片」的损伤形态；改序后崩溃最多留孤儿分片（无害）。
  it("F-10: persist 先写 index.json、后 GC 孤儿分片（操作顺序断言）", async () => {
    const ops: string[] = [];
    class OrderAdapter extends MockAdapter {
      async writeFile(path: string, content: string) {
        ops.push(`write:${path}`);
        return super.writeFile(path, content);
      }
      async deleteFile(path: string) {
        ops.push(`delete:${path}`);
        return super.deleteFile(path);
      }
      // atomicWrite 时代 index.json 的「提交点」是 rename（.tmp → 正式路径）
      async rename(oldPath: string, newPath: string) {
        ops.push(`rename:${newPath}`);
        return super.rename(oldPath, newPath);
      }
    }
    const orderAdapter = new OrderAdapter();
    const eng = new JsonVectorEngine(orderAdapter as any);
    await eng.indexChunks([
      makeChunk("ch1_0", "chapters", [1, 0, 0], { chapter: 1 }),
      makeChunk("ch2_0", "chapters", [0, 1, 0], { chapter: 2 }),
    ]);
    await eng.persist("/vectors");

    // 删第 2 章后再 persist：ch2_0.json 成孤儿，应在 index.json 写入之后才被 GC。
    await eng.deleteByChapter("au1", 2);
    ops.length = 0;
    await eng.persist("/vectors");

    const indexCommitIdx = ops.indexOf("rename:/vectors/index.json");
    const orphanDeleteIdx = ops.indexOf("delete:/vectors/chapters/ch2_0.json");
    expect(indexCommitIdx).toBeGreaterThanOrEqual(0);
    expect(orphanDeleteIdx).toBeGreaterThan(indexCommitIdx);
    // GC 结果不变：孤儿已清、保留分片仍在
    expect(await orderAdapter.exists("/vectors/chapters/ch2_0.json")).toBe(false);
    expect(await orderAdapter.exists("/vectors/chapters/ch1_0.json")).toBe(true);
  });

  it("empty index returns empty search results", async () => {
    const results = await engine.search("au1", [1, 0], { collection: "chapters", top_k: 5 });
    expect(results).toEqual([]);
  });

  it("upsert replaces existing chunk", async () => {
    await engine.indexChunks([makeChunk("c1", "chapters", [1, 0], { chapter: 1 })]);
    await engine.indexChunks([{ ...makeChunk("c1", "chapters", [0, 1], { chapter: 1 }), content: "Updated" }]);
    expect(engine.chunkCount).toBe(1);

    const results = await engine.search("au1", [0, 1], { collection: "chapters", top_k: 1 });
    expect(results[0].content).toBe("Updated");
  });
});
