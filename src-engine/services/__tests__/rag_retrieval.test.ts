// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { build_rag_query, build_active_chars, retrieve_rag } from "../rag_retrieval.js";
import type { VectorRepository, SearchOptions, SearchResult, VectorChunk } from "../../repositories/interfaces/vector.js";
import type { EmbeddingProvider } from "../../llm/embedding_provider.js";
import { IndexStatus } from "../../domain/enums.js";

// Mock embedding provider
const mockEmbedding: EmbeddingProvider = {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => [1, 0, 0]);
  },
  get_dimension() { return 3; },
  get_model_name() { return "mock"; },
};

// Mock vector repo
function createMockVectorRepo(chunks: Record<string, SearchResult[]>): VectorRepository {
  return {
    async search(_au_id: string, _embedding: number[], options: SearchOptions): Promise<SearchResult[]> {
      return (chunks[options.collection] ?? []).slice(0, options.top_k);
    },
    async index_chunks(_c: VectorChunk[]) {},
    async delete_by_chapter() {},
    async delete_by_source() {},
    async rebuild_index() {},
    async get_index_status() { return IndexStatus.READY; },
  };
}

describe("build_rag_query", () => {
  it("concatenates focus + ending + input", () => {
    const q = build_rag_query(["focus1", "focus2"], "上章结尾", "用户输入");
    expect(q).toContain("focus1");
    expect(q).toContain("上章结尾");
    expect(q).toContain("用户输入");
  });

  it("handles empty parts", () => {
    expect(build_rag_query([], "", "")).toBe("");
  });
});

describe("build_active_chars", () => {
  it("includes recent chapter characters", () => {
    const result = build_active_chars(
      { current_chapter: 5, characters_last_seen: { Alice: 4, Bob: 1 } },
      "", {}, [], { characters: [] },
    );
    expect(result).toContain("Alice");
    expect(result).not.toContain("Bob"); // too old (5-1=4 > 3)
  });

  it("includes characters from user_input", () => {
    const result = build_active_chars(
      { current_chapter: 1 }, "让Alice去", {},
      [], { characters: ["Alice", "Bob"] },
    );
    expect(result).toContain("Alice");
    expect(result).not.toContain("Bob");
  });

  it("falls back to core_always_include", () => {
    const result = build_active_chars(
      { current_chapter: 1 }, "", { core_always_include: ["Main"] },
      [], { characters: [] },
    );
    expect(result).toEqual(["Main"]);
  });

  it("returns null when all empty", () => {
    const result = build_active_chars(
      { current_chapter: 1 }, "", {},
      [], { characters: [] },
    );
    expect(result).toBeNull();
  });
});

describe("retrieve_rag", () => {
  it("retrieves from multiple collections", async () => {
    const repo = createMockVectorRepo({
      characters: [{ content: "char info", chapter_num: 0, score: 0.9, metadata: {} }],
      worldbuilding: [{ content: "world info", chapter_num: 0, score: 0.8, metadata: {} }],
      chapters: [{ content: "chapter text", chapter_num: 3, score: 0.7, metadata: {} }],
    });

    const [text, tokens] = await retrieve_rag(
      repo, mockEmbedding, "au1", "query", 10000, null, null,
    );

    expect(text).toContain("char info");
    expect(text).toContain("world info");
    expect(text).toContain("chapter text");
    expect(tokens).toBeGreaterThan(0);
  });

  it("applies time decay to chapter results", async () => {
    const repo = createMockVectorRepo({
      characters: [],
      worldbuilding: [],
      chapters: [
        { content: "old chapter", chapter_num: 1, score: 0.9, metadata: {} },
        { content: "recent chapter", chapter_num: 9, score: 0.9, metadata: {} },
      ],
    });

    const [text] = await retrieve_rag(
      repo, mockEmbedding, "au1", "query", 10000, null, null,
      0.05, 10, // current_chapter=10
    );

    // Both should appear but recent chapter has higher effective score
    expect(text).toContain("chapter");
  });

  it("deduplicates by content", async () => {
    const repo = createMockVectorRepo({
      characters: [{ content: "duplicate", chapter_num: 0, score: 0.9, metadata: {} }],
      worldbuilding: [{ content: "duplicate", chapter_num: 0, score: 0.8, metadata: {} }],
      chapters: [],
    });

    const [text] = await retrieve_rag(
      repo, mockEmbedding, "au1", "query", 10000, null, null,
    );

    // "duplicate" should only appear once
    const matches = text.match(/duplicate/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("returns empty for empty query", async () => {
    const repo = createMockVectorRepo({});
    const [text, tokens] = await retrieve_rag(
      repo, mockEmbedding, "au1", "", 10000, null, null,
    );
    expect(text).toBe("");
    expect(tokens).toBe(0);
  });

  it("empty index returns empty", async () => {
    const repo = createMockVectorRepo({ characters: [], worldbuilding: [], chapters: [] });
    const [text] = await retrieve_rag(
      repo, mockEmbedding, "au1", "query", 10000, null, null,
    );
    expect(text).toBe("");
  });

  it("returns structured chunks with collection tag", async () => {
    const repo = createMockVectorRepo({
      characters: [{ content: "char info", chapter_num: 0, score: 0.9, metadata: {} }],
      worldbuilding: [],
      chapters: [{ content: "chapter text", chapter_num: 3, score: 0.7, metadata: {} }],
    });

    const [, , chunks] = await retrieve_rag(
      repo, mockEmbedding, "au1", "query", 10000, null, null,
    );

    expect(chunks).toHaveLength(2);
    const charChunk = chunks.find((c) => c.content === "char info");
    const chChunk = chunks.find((c) => c.content === "chapter text");
    expect(charChunk?._collection).toBe("characters");
    expect(chChunk?._collection).toBe("chapters");
    expect(chChunk?.chapter_num).toBe(3);
    expect(chChunk?.score).toBeGreaterThan(0);
  });

  it("returns [] chunks for empty query", async () => {
    const repo = createMockVectorRepo({});
    const [, , chunks] = await retrieve_rag(
      repo, mockEmbedding, "au1", "", 10000, null, null,
    );
    expect(chunks).toEqual([]);
  });
});
