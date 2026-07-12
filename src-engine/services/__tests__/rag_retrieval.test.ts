// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, vi } from "vitest";
import { buildRagQuery, buildActiveChars, retrieveRag, retrieveRagForContext } from "../rag_retrieval.js";
import type {
  VectorRepository,
  SearchOptions,
  SearchResult,
  VectorChunk,
} from "../../repositories/interfaces/vector.js";
import type { EmbeddingProvider } from "../../llm/embedding_provider.js";
import { IndexStatus } from "../../domain/enums.js";

// Mock embedding provider
const mockEmbedding: EmbeddingProvider = {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => [1, 0, 0]);
  },
  get_dimension() {
    return 3;
  },
  get_model_name() {
    return "mock";
  },
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
    async get_index_status() {
      return IndexStatus.READY;
    },
  };
}

describe("buildRagQuery", () => {
  it("concatenates focus + ending + input", () => {
    const q = buildRagQuery(["focus1", "focus2"], "上章结尾", "用户输入");
    expect(q).toContain("focus1");
    expect(q).toContain("上章结尾");
    expect(q).toContain("用户输入");
  });

  it("handles empty parts", () => {
    expect(buildRagQuery([], "", "")).toBe("");
  });
});

describe("buildActiveChars", () => {
  it("includes recent chapter characters", () => {
    const result = buildActiveChars({ current_chapter: 5, characters_last_seen: { Alice: 4, Bob: 1 } }, "", {}, [], {
      characters: [],
    });
    expect(result).toContain("Alice");
    expect(result).not.toContain("Bob"); // too old (5-1=4 > 3)
  });

  it("includes characters from user_input", () => {
    const result = buildActiveChars({ current_chapter: 1 }, "让Alice去", {}, [], { characters: ["Alice", "Bob"] });
    expect(result).toContain("Alice");
    expect(result).not.toContain("Bob");
  });

  it("falls back to core_always_include", () => {
    const result = buildActiveChars({ current_chapter: 1 }, "", { core_always_include: ["Main"] }, [], {
      characters: [],
    });
    expect(result).toEqual(["Main"]);
  });

  it("returns null when all empty", () => {
    const result = buildActiveChars({ current_chapter: 1 }, "", {}, [], { characters: [] });
    expect(result).toBeNull();
  });

  it("审计⑥：已归档 fact 在 chapter_focus 里也不把其角色加入 RAG char_filter", () => {
    const result = buildActiveChars(
      { current_chapter: 1, chapter_focus: ["fc", "fw"] },
      "",
      {},
      [
        { id: "fw", characters: ["热角色"], archived: false },
        { id: "fc", characters: ["冷角色"], archived: true },
      ],
      { characters: [] },
    );
    expect(result).toContain("热角色");
    expect(result).not.toContain("冷角色");
  });

  it("E8：输入只出现别名「小昭」→ 别名表把主名「林昭」带进活跃角色过滤集", () => {
    const withTable = buildActiveChars(
      { current_chapter: 1 },
      "小昭独自走进房间",
      {},
      [],
      { characters: ["林昭"] },
      {
        林昭: ["小昭"],
      },
    );
    expect(withTable).toContain("林昭");
    // 记的是主名，不是别名
    expect(withTable).not.toContain("小昭");
  });

  it("E8 对照：不传别名表（null）→ 只出现别名时主名不进过滤集（与接通前逐字节一致）", () => {
    const noTable = buildActiveChars({ current_chapter: 1 }, "小昭独自走进房间", {}, [], { characters: ["林昭"] });
    // 「林昭」未在输入中字面出现、无别名归一化，且无最近出场/焦点/核心角色 → 整体降级 null（全局检索）
    expect(noTable).toBeNull();
  });
});

describe("retrieveRag", () => {
  it("retrieves from multiple collections", async () => {
    const repo = createMockVectorRepo({
      characters: [{ content: "char info", chapter_num: 0, score: 0.9, metadata: {} }],
      worldbuilding: [{ content: "world info", chapter_num: 0, score: 0.8, metadata: {} }],
      chapters: [{ content: "chapter text", chapter_num: 3, score: 0.7, metadata: {} }],
    });

    const [text, tokens] = await retrieveRag(repo, mockEmbedding, "au1", "query", 10000, null, null);

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

    const [text] = await retrieveRag(
      repo,
      mockEmbedding,
      "au1",
      "query",
      10000,
      null,
      null,
      0.05,
      10, // current_chapter=10
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

    const [text] = await retrieveRag(repo, mockEmbedding, "au1", "query", 10000, null, null);

    // "duplicate" should only appear once
    const matches = text.match(/duplicate/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it("returns empty for empty query", async () => {
    const repo = createMockVectorRepo({});
    const [text, tokens] = await retrieveRag(repo, mockEmbedding, "au1", "", 10000, null, null);
    expect(text).toBe("");
    expect(tokens).toBe(0);
  });

  it("empty index returns empty", async () => {
    const repo = createMockVectorRepo({ characters: [], worldbuilding: [], chapters: [] });
    const [text] = await retrieveRag(repo, mockEmbedding, "au1", "query", 10000, null, null);
    expect(text).toBe("");
  });

  it("returns structured chunks with collection tag", async () => {
    const repo = createMockVectorRepo({
      characters: [{ content: "char info", chapter_num: 0, score: 0.9, metadata: {} }],
      worldbuilding: [],
      chapters: [{ content: "chapter text", chapter_num: 3, score: 0.7, metadata: {} }],
    });

    const [, , chunks] = await retrieveRag(repo, mockEmbedding, "au1", "query", 10000, null, null);

    expect(chunks).toHaveLength(2);
    const charChunk = chunks.find((c) => c.content === "char info");
    const chChunk = chunks.find((c) => c.content === "chapter text");
    expect(charChunk?._collection).toBe("characters");
    expect(chChunk?._collection).toBe("chapters");
    expect(chChunk?.chapter_num).toBe(3);
    expect(chChunk?.score).toBeGreaterThan(0);
  });

  it("retrieves up to CHAPTERS_TOP_K=8 chapter chunks", async () => {
    const chapters = Array.from({ length: 12 }, (_, i) => ({
      content: `chapter chunk ${i}`,
      chapter_num: i + 1,
      score: 0.9 - i * 0.01,
      metadata: {},
    }));
    const repo = createMockVectorRepo({ characters: [], worldbuilding: [], chapters });

    const [, , chunks] = await retrieveRag(repo, mockEmbedding, "au1", "query", 100000, null, null);

    const chapterChunks = chunks.filter((c) => c._collection === "chapters");
    expect(chapterChunks.length).toBe(8);
  });

  it("returns [] chunks for empty query", async () => {
    const repo = createMockVectorRepo({});
    const [, , chunks] = await retrieveRag(repo, mockEmbedding, "au1", "", 10000, null, null);
    expect(chunks).toEqual([]);
  });
});

describe("retrieveRagForContext (融合:RAG 编排单一真相源)", () => {
  const baseArgs = {
    project: { llm: { context_window: 128000 }, rag_decay_coefficient: 0.05 },
    state: { current_chapter: 2, last_scene_ending: "" },
    au_id: "au1",
    llm_config: null,
    language: "zh",
  };

  it("ACTIVE fact 给出 focus → query 非空 → 返回 ragText + chunks", async () => {
    const repo = createMockVectorRepo({
      chapters: [{ content: "前情提要", chapter_num: 1, score: 0.9, metadata: {} }],
    });
    const res = await retrieveRagForContext({
      ...baseArgs,
      user_input: "继续写",
      facts: [{ id: "f1", status: "active", content_clean: "林夏发现了真相", characters: [] }],
      vector_repo: repo,
      embedding_provider: mockEmbedding,
    });
    expect(res.ragText).toContain("前情提要");
    expect(res.chunks.length).toBeGreaterThan(0);
  });

  it("无 facts / 无结尾 / 无输入 → query 空 → 不检索（search 不被调用）,返回 null + []", async () => {
    const searchSpy = vi.fn(async () => [] as SearchResult[]);
    const repo: VectorRepository = {
      search: searchSpy,
      async index_chunks(_c: VectorChunk[]) {},
      async delete_by_chapter() {},
      async delete_by_source() {},
      async rebuild_index() {},
      async get_index_status() {
        return IndexStatus.READY;
      },
    };
    const res = await retrieveRagForContext({
      ...baseArgs,
      user_input: "",
      facts: [],
      vector_repo: repo,
      embedding_provider: mockEmbedding,
    });
    expect(res.ragText).toBeNull();
    expect(res.chunks).toEqual([]);
    expect(searchSpy).not.toHaveBeenCalled();
  });

  it("审计⑥：已归档 fact 的 content_clean 不进 RAG 检索 query（热 fact 仍进）", async () => {
    let capturedQuery = "";
    const capturingEmbedding: EmbeddingProvider = {
      async embed(texts: string[]): Promise<number[][]> {
        capturedQuery = texts[0] ?? "";
        return texts.map(() => [1, 0, 0]);
      },
      get_dimension() {
        return 3;
      },
      get_model_name() {
        return "cap";
      },
    };
    const repo = createMockVectorRepo({ chapters: [] });

    await retrieveRagForContext({
      ...baseArgs,
      user_input: "继续写",
      facts: [
        { id: "fw", status: "active", content_clean: "热线索应进query", characters: [], archived: false },
        { id: "fc", status: "active", content_clean: "冷线索不该进query", characters: [], archived: true },
      ],
      vector_repo: repo,
      embedding_provider: capturingEmbedding,
    });

    expect(capturedQuery).toContain("热线索应进query");
    expect(capturedQuery).not.toContain("冷线索不该进query");
  });

  it("embed 抛错 → 静默回退 null + []（真正命中 retrieveRagForContext 的 catch）", async () => {
    // 注:让 embed 抛错而非 search —— retrieveRag 内部对 search 有 try/catch 会吞掉。
    // embed / ensureTokenizer 等 retrieveRag 内未被内部 try 包住的 await 抛错,才会冒泡到本函数 catch。
    const throwingEmbedding: EmbeddingProvider = {
      async embed(): Promise<number[][]> {
        throw new Error("embedding service down");
      },
      get_dimension() {
        return 3;
      },
      get_model_name() {
        return "throwing";
      },
    };
    const repo = createMockVectorRepo({
      chapters: [{ content: "不该到达", chapter_num: 1, score: 0.9, metadata: {} }],
    });
    const res = await retrieveRagForContext({
      ...baseArgs,
      user_input: "继续",
      facts: [{ id: "f1", status: "active", content_clean: "关键线索", characters: [] }],
      vector_repo: repo,
      embedding_provider: throwingEmbedding,
    });
    expect(res.ragText).toBeNull();
    expect(res.chunks).toEqual([]);
  });

  // E8：别名表透传链 —— retrieveRagForContext → buildActiveChars → retrieveRag → search 的 char_filter。
  // 捕获传给 vector_repo.search 的 char_filter 证明主名进过滤集（可过滤 collection），并给 null 对照。
  function makeFilterCapturingRepo(seen: (string[] | null)[]): VectorRepository {
    return {
      async search(_au_id: string, _embedding: number[], options: SearchOptions): Promise<SearchResult[]> {
        seen.push(options.char_filter ?? null);
        // 返回 2 条：避开 searchCollection 「<2 条 + 有 char_filter → null 全局回退」的二次查询干扰断言
        return [
          { content: "c1", chapter_num: 3, score: 0.9, metadata: {} },
          { content: "c2", chapter_num: 2, score: 0.8, metadata: {} },
        ].slice(0, options.top_k);
      },
      async index_chunks(_c: VectorChunk[]) {},
      async delete_by_chapter() {},
      async delete_by_source() {},
      async rebuild_index() {},
      async get_index_status() {
        return IndexStatus.READY;
      },
    };
  }

  it("E8：传别名表 → 正文只含别名「小昭」时 char_filter 认主名「林昭」（可过滤 collection）", async () => {
    const seen: (string[] | null)[] = [];
    await retrieveRagForContext({
      ...baseArgs,
      project: { ...baseArgs.project, cast_registry: { characters: ["林昭"] } },
      user_input: "小昭出现了",
      facts: [],
      vector_repo: makeFilterCapturingRepo(seen),
      embedding_provider: mockEmbedding,
      character_aliases: { 林昭: ["小昭"] },
    });
    // characters / worldbuilding / chapters 三个可过滤 collection 至少一处 char_filter 含主名 林昭
    expect(seen.some((f) => f?.includes("林昭"))).toBe(true);
  });

  it("E8 对照：不传别名表 → char_filter 不含主名（只出现别名时活跃集为空，逐字节回退现状）", async () => {
    const seen: (string[] | null)[] = [];
    await retrieveRagForContext({
      ...baseArgs,
      project: { ...baseArgs.project, cast_registry: { characters: ["林昭"] } },
      user_input: "小昭出现了",
      facts: [],
      vector_repo: makeFilterCapturingRepo(seen),
      embedding_provider: mockEmbedding,
    });
    // 无别名归一化 → activeChars 全局 null → 所有 collection 的 char_filter 均为 null
    expect(seen.every((f) => f === null || !f.includes("林昭"))).toBe(true);
  });
});
