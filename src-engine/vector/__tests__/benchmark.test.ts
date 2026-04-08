// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { cosine_similarity, JsonVectorEngine } from "../engine.js";
import type { VectorChunk } from "../../repositories/interfaces/vector.js";

/** 生成随机 embedding 向量。 */
function randomEmbedding(dim: number): number[] {
  return Array.from({ length: dim }, () => Math.random() * 2 - 1);
}

function makeChunk(i: number, dim: number): VectorChunk {
  return {
    id: `bench_ch${String(Math.floor(i / 5) + 1).padStart(4, "0")}_${i % 5}`,
    collection: "chapters",
    content: `Benchmark chunk content #${i}`,
    embedding: randomEmbedding(dim),
    metadata: {
      au_id: "bench_au",
      chapter: Math.floor(i / 5) + 1,
      chunk_index: i % 5,
      branch_id: "main",
      characters: i % 3 === 0 ? "Alice,Bob" : "Charlie",
    },
  };
}

// Minimal mock adapter (engine only needs it for persist/load, not for search)
const noopAdapter = {
  async readFile() { return ""; },
  async writeFile() {},
  async deleteFile() {},
  async listDir() { return []; },
  async exists() { return false; },
  async mkdir() {},
  async showSaveDialog() { return null; },
  async showOpenDialog() { return null; },
  getPlatform() { return "web" as const; },
  async getDataDir() { return "/mock"; },
  getDeviceId() { return "mock"; },
};

describe("Vector engine performance benchmark", () => {
  it("5000 chunks: search completes in < 50ms", async () => {
    const engine = new JsonVectorEngine(noopAdapter as any);
    const dim = 384; // bge-small-zh dimension
    const chunks = Array.from({ length: 5000 }, (_, i) => makeChunk(i, dim));

    // Index all chunks
    const indexStart = performance.now();
    await engine.index_chunks(chunks);
    const indexTime = performance.now() - indexStart;

    expect(engine.chunkCount).toBe(5000);
    console.log(`  Index 5000 chunks (dim=${dim}): ${indexTime.toFixed(1)}ms`);

    // Search
    const queryVec = randomEmbedding(dim);
    const searchStart = performance.now();
    const results = await engine.search("bench_au", queryVec, {
      collection: "chapters",
      top_k: 5,
    });
    const searchTime = performance.now() - searchStart;

    expect(results).toHaveLength(5);
    expect(searchTime).toBeLessThan(50);
    console.log(`  Search top_k=5 over 5000 chunks: ${searchTime.toFixed(1)}ms`);
  });

  it("1000 chunks: search completes in < 20ms", async () => {
    const engine = new JsonVectorEngine(noopAdapter as any);
    const dim = 384;
    const chunks = Array.from({ length: 1000 }, (_, i) => makeChunk(i, dim));

    await engine.index_chunks(chunks);

    const queryVec = randomEmbedding(dim);
    const searchStart = performance.now();
    const results = await engine.search("bench_au", queryVec, {
      collection: "chapters",
      top_k: 5,
    });
    const searchTime = performance.now() - searchStart;

    expect(results).toHaveLength(5);
    expect(searchTime).toBeLessThan(20);
    console.log(`  Search top_k=5 over 1000 chunks: ${searchTime.toFixed(1)}ms`);
  });

  it("5000 chunks: search with char_filter", async () => {
    const engine = new JsonVectorEngine(noopAdapter as any);
    const dim = 384;
    const chunks = Array.from({ length: 5000 }, (_, i) => makeChunk(i, dim));
    await engine.index_chunks(chunks);

    const queryVec = randomEmbedding(dim);
    const searchStart = performance.now();
    const results = await engine.search("bench_au", queryVec, {
      collection: "chapters",
      top_k: 5,
      char_filter: ["Alice"],
    });
    const searchTime = performance.now() - searchStart;

    expect(results.length).toBeLessThanOrEqual(5);
    expect(searchTime).toBeLessThan(50);
    console.log(`  Search with char_filter over 5000 chunks: ${searchTime.toFixed(1)}ms`);
  });
});
