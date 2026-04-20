// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach, vi } from "vitest";
import { generate_chapter, is_empty_intent } from "../generation.js";
import type { GenerationEvent } from "../generation.js";
import { createProject, createLLMConfig } from "../../domain/project.js";
import { createState } from "../../domain/state.js";
import { createSettings } from "../../domain/settings.js";
import { IndexStatus, LLMMode } from "../../domain/enums.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import { FileDraftRepository } from "../../repositories/implementations/file_draft.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import type { EmbeddingProvider } from "../../llm/embedding_provider.js";
import type { LLMProvider, LLMResponse, LLMChunk } from "../../llm/provider.js";
import type { VectorRepository } from "../../repositories/interfaces/vector.js";

function createMockProvider(tokens: string[] = ["Hello", " world", "!"]): LLMProvider {
  return {
    async generate(): Promise<LLMResponse> {
      return { content: tokens.join(""), model: "mock", input_tokens: 10, output_tokens: tokens.length, finish_reason: "stop" };
    },
    async *generateStream(): AsyncIterable<LLMChunk> {
      for (let i = 0; i < tokens.length; i++) {
        yield {
          delta: tokens[i],
          is_final: i === tokens.length - 1,
          input_tokens: i === tokens.length - 1 ? 100 : null,
          output_tokens: i === tokens.length - 1 ? tokens.length : null,
          finish_reason: i === tokens.length - 1 ? "stop" : null,
        };
      }
    },
  };
}

function makeParams(adapter: MockAdapter, overrides: Partial<Parameters<typeof generate_chapter>[0]> = {}) {
  return {
    au_id: "au_test",
    chapter_num: 1,
    user_input: "开始写第一章",
    session_llm: null,
    session_params: null,
    project: createProject({
      project_id: "p1", au_id: "au_test",
      llm: createLLMConfig({ mode: LLMMode.API, model: "test-model", api_base: "http://localhost", api_key: "key" }),
    }),
    state: createState({ au_id: "au_test" }),
    settings: createSettings(),
    facts: [],
    chapter_repo: new FileChapterRepository(adapter),
    draft_repo: new FileDraftRepository(adapter),
    _provider_override: createMockProvider(["你好", "世界"]),
    ...overrides,
  };
}

async function collectEvents(gen: AsyncGenerator<GenerationEvent>): Promise<GenerationEvent[]> {
  const events: GenerationEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe("is_empty_intent", () => {
  it("recognizes Chinese empty intents", () => {
    expect(is_empty_intent("继续")).toBe(true);
    expect(is_empty_intent("然后呢")).toBe(true);
  });

  it("recognizes English empty intents", () => {
    expect(is_empty_intent("continue")).toBe(true);
  });

  it("short input as empty", () => {
    expect(is_empty_intent("写")).toBe(true);
  });

  it("substantive input not empty", () => {
    expect(is_empty_intent("让Alice去找Bob谈谈")).toBe(false);
  });
});

describe("generate_chapter", () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
  });

  it("full flow: context_summary → tokens → done", async () => {
    const events = await collectEvents(generate_chapter(makeParams(adapter)));

    const types = events.map((e) => e.type);
    expect(types).toContain("context_summary");
    expect(types).toContain("token");
    expect(types).toContain("done");

    const doneEvent = events.find((e) => e.type === "done")!;
    const data = doneEvent.data as any;
    expect(data.draft_label).toBe("A");
    expect(data.full_text).toBe("你好世界");
    expect(data.generated_with.model).toBe("test-model");

    const contextEvent = events.find((e) => e.type === "context_summary")!;
    expect((contextEvent.data as any).stale_index).toBe(true);
  });

  it("idempotent control rejects concurrent generation", async () => {
    const slowProvider: LLMProvider = {
      async generate(): Promise<LLMResponse> {
        return { content: "", model: "mock", input_tokens: 0, output_tokens: 0, finish_reason: "stop" };
      },
      async *generateStream(): AsyncIterable<LLMChunk> {
        await new Promise((r) => setTimeout(r, 100));
        yield { delta: "text", is_final: true, input_tokens: 10, output_tokens: 1, finish_reason: "stop" };
      },
    };

    const params = makeParams(adapter, {
      au_id: "au_concurrent",
      _provider_override: slowProvider,
    });

    const gen1 = generate_chapter(params);
    await gen1.next(); // starts generating

    const events2 = await collectEvents(generate_chapter(params));
    expect(events2[0].type).toBe("error");
    expect((events2[0].data as any).error_code).toBe("GENERATION_IN_PROGRESS");

    for await (const _ of gen1) { /* drain */ }
  });

  it("draft label increments A→B", async () => {
    const params1 = makeParams(adapter, {
      au_id: "au_label",
      _provider_override: createMockProvider(["draft1"]),
    });

    await collectEvents(generate_chapter(params1));

    const params2 = makeParams(adapter, {
      au_id: "au_label",
      user_input: "再写一次",
      _provider_override: createMockProvider(["draft2"]),
    });

    const events = await collectEvents(generate_chapter(params2));
    const doneEvent = events.find((e) => e.type === "done")!;
    expect((doneEvent.data as any).draft_label).toBe("B");
  });

  it("LLM error saves partial draft", async () => {
    const errorProvider: LLMProvider = {
      async generate(): Promise<LLMResponse> {
        throw new Error("test");
      },
      async *generateStream(): AsyncIterable<LLMChunk> {
        yield { delta: "partial", is_final: false, input_tokens: null, output_tokens: null, finish_reason: null };
        throw new (await import("../../llm/provider.js")).LLMError("rate_limited", "Too many requests", ["retry"]);
      },
    };

    const events = await collectEvents(generate_chapter(makeParams(adapter, {
      au_id: "au_error",
      _provider_override: errorProvider,
    })));

    const errorEvent = events.find((e) => e.type === "error")!;
    expect((errorEvent.data as any).error_code).toBe("rate_limited");
    expect((errorEvent.data as any).partial_draft_label).toBe("A");
  });

  it("runs RAG when index_status is STALE and marks stale_index", async () => {
    const searchSpy = vi.fn(async (_auId: string, _queryEmbedding: number[], options: { collection: string }) => {
      if (options.collection !== "chapters") return [];
      return [{
        content: "上一章里 Alice 看见了燃烧的钟楼。",
        chapter_num: 1,
        score: 0.98,
        metadata: {},
      }];
    });
    const vectorRepo: VectorRepository = {
      async index_chunks() {},
      search: searchSpy,
      async delete_by_chapter() {},
      async delete_by_source() {},
      async rebuild_index() {},
      async get_index_status() { return IndexStatus.READY; },
    };
    const embeddingProvider: EmbeddingProvider = {
      async embed(texts: string[]) {
        return texts.map(() => [0.1, 0.2, 0.3]);
      },
      get_dimension() {
        return 3;
      },
      get_model_name() {
        return "mock-embed";
      },
    };

    const events = await collectEvents(generate_chapter(makeParams(adapter, {
      au_id: "au_rag_stale",
      state: createState({
        au_id: "au_rag_stale",
        current_chapter: 2,
        index_status: IndexStatus.STALE,
      }),
      vector_repo: vectorRepo,
      embedding_provider: embeddingProvider,
      _provider_override: createMockProvider(["继续", "写"]),
    })));

    const contextEvent = events.find((e) => e.type === "context_summary")!;
    const summary = contextEvent.data as any;
    expect(searchSpy).toHaveBeenCalled();
    expect(summary.stale_index).toBe(true);
    expect(summary.rag_chunks_retrieved).toBe(1);
    expect(summary.rag_chunks).toMatchObject([
      { collection: "chapters", chapter_num: 1 },
    ]);
  });
});
