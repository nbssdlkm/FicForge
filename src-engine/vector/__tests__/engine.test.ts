// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import { cosine_similarity, JsonVectorEngine } from "../engine.js";
import type { VectorChunk } from "../../repositories/interfaces/vector.js";

// Re-use mock adapter
class MockAdapter {
  private files = new Map<string, string>();
  async readFile(path: string) { const c = this.files.get(path); if (!c) throw new Error("Not found"); return c; }
  async writeFile(path: string, content: string) { this.files.set(path, content); }
  async deleteFile(path: string) { this.files.delete(path); }
  async listDir(path: string) {
    const prefix = path + "/";
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) { names.add(key.slice(prefix.length).split("/")[0]); }
    }
    return [...names];
  }
  async exists(path: string) {
    if (this.files.has(path)) return true;
    for (const key of this.files.keys()) { if (key.startsWith(path + "/")) return true; }
    return false;
  }
  async mkdir() {}
  async showSaveDialog() { return null; }
  async showOpenDialog() { return null; }
  getPlatform() { return "web" as const; }
  async getDataDir() { return "/mock"; }
  getDeviceId() { return "mock"; }
}

describe("cosine_similarity", () => {
  it("identical vectors → 1.0", () => {
    expect(cosine_similarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0);
  });

  it("orthogonal vectors → 0.0", () => {
    expect(cosine_similarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it("opposite vectors → -1.0", () => {
    expect(cosine_similarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it("known similarity value", () => {
    // cos([1,2,3], [4,5,6]) = 32 / (sqrt(14) * sqrt(77)) ≈ 0.9746
    const sim = cosine_similarity([1, 2, 3], [4, 5, 6]);
    expect(sim).toBeCloseTo(0.9746, 3);
  });

  it("zero vector → 0", () => {
    expect(cosine_similarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe("JsonVectorEngine", () => {
  let adapter: MockAdapter;
  let engine: JsonVectorEngine;

  function makeChunk(id: string, collection: "chapters" | "characters" | "worldbuilding", embedding: number[], meta: Record<string, unknown> = {}): VectorChunk {
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
    await engine.index_chunks([
      makeChunk("c1", "chapters", [1, 0, 0], { chapter: 1 }),
      makeChunk("c2", "chapters", [0, 1, 0], { chapter: 2 }),
      makeChunk("c3", "chapters", [0.9, 0.1, 0], { chapter: 3 }),
    ]);

    const results = await engine.search("au1", [1, 0, 0], { collection: "chapters", top_k: 2 });
    expect(results).toHaveLength(2);
    expect(results[0].content).toBe("Content of c1"); // highest similarity
  });

  it("search respects AU isolation", async () => {
    await engine.index_chunks([
      makeChunk("c1", "chapters", [1, 0], { au_id: "au1", chapter: 1 }),
      makeChunk("c2", "chapters", [1, 0], { au_id: "au2", chapter: 1 }),
    ]);

    const results = await engine.search("au1", [1, 0], { collection: "chapters", top_k: 10 });
    expect(results).toHaveLength(1);
  });

  it("search with character filter", async () => {
    await engine.index_chunks([
      makeChunk("c1", "chapters", [1, 0], { chapter: 1, characters: "Alice,Bob" }),
      makeChunk("c2", "chapters", [0.9, 0.1], { chapter: 2, characters: "Charlie" }),
    ]);

    const results = await engine.search("au1", [1, 0], {
      collection: "chapters", top_k: 10, char_filter: ["Alice"],
    });
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("Content of c1");
  });

  it("delete_by_chapter removes chunks", async () => {
    await engine.index_chunks([
      makeChunk("c1", "chapters", [1, 0], { chapter: 1 }),
      makeChunk("c2", "chapters", [0, 1], { chapter: 2 }),
    ]);

    await engine.delete_by_chapter("au1", 1);
    const results = await engine.search("au1", [1, 0], { collection: "chapters", top_k: 10 });
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe("Content of c2");
  });

  it("delete_by_source removes chunks", async () => {
    await engine.index_chunks([
      makeChunk("s1", "characters", [1, 0], { source_file: "Connor.md" }),
      makeChunk("s2", "characters", [0, 1], { source_file: "Hank.md" }),
    ]);

    await engine.delete_by_source("au1", "Connor.md");
    expect(engine.chunkCount).toBe(1);
  });

  it("persist and reload", async () => {
    await engine.index_chunks([
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

  it("empty index returns empty search results", async () => {
    const results = await engine.search("au1", [1, 0], { collection: "chapters", top_k: 5 });
    expect(results).toEqual([]);
  });

  it("upsert replaces existing chunk", async () => {
    await engine.index_chunks([makeChunk("c1", "chapters", [1, 0], { chapter: 1 })]);
    await engine.index_chunks([{ ...makeChunk("c1", "chapters", [0, 1], { chapter: 1 }), content: "Updated" }]);
    expect(engine.chunkCount).toBe(1);

    const results = await engine.search("au1", [0, 1], { collection: "chapters", top_k: 1 });
    expect(results[0].content).toBe("Updated");
  });
});
