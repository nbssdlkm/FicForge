// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach, vi } from "vitest";
import { generateChapter, isEmptyIntent } from "../generation.js";
import type { GenerationEvent } from "../generation.js";
import { chapterInflightKey, isChapterInflight } from "../chapter_inflight.js";
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
import { createMockLLMProvider } from "./mock_llm_provider.js";

function createMockProvider(tokens: string[] = ["Hello", " world", "!"]): LLMProvider {
  const streamChunks: LLMChunk[] = tokens.map((delta, i) => ({
    delta,
    is_final: i === tokens.length - 1,
    input_tokens: i === tokens.length - 1 ? 100 : null,
    output_tokens: i === tokens.length - 1 ? tokens.length : null,
    finish_reason: i === tokens.length - 1 ? "stop" : null,
  }));
  return createMockLLMProvider({
    content: tokens.join(""),
    streamChunks,
    response: { input_tokens: 10, output_tokens: tokens.length },
  });
}

function makeParams(adapter: MockAdapter, overrides: Partial<Parameters<typeof generateChapter>[0]> = {}) {
  return {
    au_id: "au_test",
    chapter_num: 1,
    user_input: "开始写第一章",
    session_llm: null,
    session_params: null,
    project: createProject({
      project_id: "p1",
      au_id: "au_test",
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

describe("isEmptyIntent", () => {
  it("recognizes Chinese empty intents", () => {
    expect(isEmptyIntent("继续")).toBe(true);
    expect(isEmptyIntent("然后呢")).toBe(true);
  });

  it("recognizes English empty intents", () => {
    expect(isEmptyIntent("continue")).toBe(true);
  });

  it("short input as empty", () => {
    expect(isEmptyIntent("写")).toBe(true);
  });

  it("substantive input not empty", () => {
    expect(isEmptyIntent("让Alice去找Bob谈谈")).toBe(false);
  });
});

describe("generateChapter", () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
  });

  it("full flow: context_summary → tokens → done", async () => {
    const events = await collectEvents(generateChapter(makeParams(adapter)));

    const types = events.map((e) => e.type);
    expect(types).toContain("context_summary");
    expect(types).toContain("token");
    expect(types).toContain("done");

    const doneEvent = events.find((e) => e.type === "done")!;
    const data = doneEvent.data as any;
    expect(data.draft_label).toBe("A");
    expect(data.full_text).toBe("你好世界");
    expect(data.generated_with.model).toBe("test-model");
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

    const gen1 = generateChapter(params);
    await gen1.next(); // starts generating

    const events2 = await collectEvents(generateChapter(params));
    expect(events2[0].type).toBe("error");
    expect((events2[0].data as any).error_code).toBe("GENERATION_IN_PROGRESS");

    for await (const _ of gen1) {
      /* drain */
    }
  });

  it("draft label increments A→B", async () => {
    const params1 = makeParams(adapter, {
      au_id: "au_label",
      _provider_override: createMockProvider(["draft1"]),
    });

    await collectEvents(generateChapter(params1));

    const params2 = makeParams(adapter, {
      au_id: "au_label",
      user_input: "再写一次",
      _provider_override: createMockProvider(["draft2"]),
    });

    const events = await collectEvents(generateChapter(params2));
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

    const events = await collectEvents(
      generateChapter(
        makeParams(adapter, {
          au_id: "au_error",
          _provider_override: errorProvider,
        }),
      ),
    );

    const errorEvent = events.find((e) => e.type === "error")!;
    expect((errorEvent.data as any).error_code).toBe("rate_limited");
    expect((errorEvent.data as any).partial_draft_label).toBe("A");
  });

  it("passes signal to provider and rethrows AbortError without saving a partial draft", async () => {
    const controller = new AbortController();

    const abortProvider = createMockLLMProvider({ error: new DOMException("Aborted", "AbortError") });

    const params = makeParams(adapter, {
      au_id: "au_abort",
      signal: controller.signal,
      _provider_override: abortProvider,
    });

    await expect(collectEvents(generateChapter(params))).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(abortProvider.calls[0]?.signal).toBe(controller.signal);
    await expect(params.draft_repo.list_by_chapter("au_abort", 1)).resolves.toEqual([]);
    // M5：AbortError rethrow 后 finally 必须释放 inflight，否则该章永久锁死返 409
    expect(isChapterInflight(chapterInflightKey("au_abort", 1))).toBe(false);
  });

  // --- 盲审 R3 M5：错误/中断路径必须释放 chapter_inflight（finally 非 catch）---

  it("LLM 错误路径结束后释放 inflight，同章可再次生成（不被 409 卡死）", async () => {
    const errorProvider: LLMProvider = {
      async generate(): Promise<LLMResponse> {
        throw new Error("boom");
      },
      async *generateStream(): AsyncIterable<LLMChunk> {
        yield { delta: "partial", is_final: false, input_tokens: null, output_tokens: null, finish_reason: null };
        throw new (await import("../../llm/provider.js")).LLMError("rate_limited", "Too many requests", ["retry"]);
      },
    };
    const key = chapterInflightKey("au_inflight_err", 1);

    const events1 = await collectEvents(
      generateChapter(
        makeParams(adapter, {
          au_id: "au_inflight_err",
          _provider_override: errorProvider,
        }),
      ),
    );
    expect((events1.find((e) => e.type === "error")!.data as any).error_code).toBe("rate_limited");
    // 释放判据：错误路径退出后 inflight 表不残留该 key
    expect(isChapterInflight(key)).toBe(false);

    // 端到端复核：同章第二次生成不再返回 GENERATION_IN_PROGRESS
    const events2 = await collectEvents(
      generateChapter(
        makeParams(adapter, {
          au_id: "au_inflight_err",
          _provider_override: createMockProvider(["重试", "成功"]),
        }),
      ),
    );
    expect(
      events2.find((e) => e.type === "error" && (e.data as any).error_code === "GENERATION_IN_PROGRESS"),
    ).toBeUndefined();
    expect(events2.find((e) => e.type === "done")).toBeTruthy();
  });

  it("AbortError 中断后 inflight 已释放，同章可重新发起生成", async () => {
    const controller = new AbortController();
    const abortProvider = createMockLLMProvider({ error: new DOMException("Aborted", "AbortError") });
    const key = chapterInflightKey("au_inflight_abort", 1);

    await expect(
      collectEvents(
        generateChapter(
          makeParams(adapter, {
            au_id: "au_inflight_abort",
            signal: controller.signal,
            _provider_override: abortProvider,
          }),
        ),
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(isChapterInflight(key)).toBe(false);

    // 中断后重新生成应当放行（若漏 release 会被 409）
    const events = await collectEvents(
      generateChapter(
        makeParams(adapter, {
          au_id: "au_inflight_abort",
          _provider_override: createMockProvider(["再来", "一次"]),
        }),
      ),
    );
    expect(
      events.find((e) => e.type === "error" && (e.data as any).error_code === "GENERATION_IN_PROGRESS"),
    ).toBeUndefined();
    expect(events.find((e) => e.type === "done")).toBeTruthy();
  });

  it("runs RAG when index_status is STALE", async () => {
    const searchSpy = vi.fn(async (_auId: string, _queryEmbedding: number[], options: { collection: string }) => {
      if (options.collection !== "chapters") return [];
      return [
        {
          content: "上一章里 Alice 看见了燃烧的钟楼。",
          chapter_num: 1,
          score: 0.98,
          metadata: {},
        },
      ];
    });
    const vectorRepo: VectorRepository = {
      async index_chunks() {},
      search: searchSpy,
      async delete_by_chapter() {},
      async delete_by_source() {},
      async get_index_status() {
        return IndexStatus.READY;
      },
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

    const events = await collectEvents(
      generateChapter(
        makeParams(adapter, {
          au_id: "au_rag_stale",
          state: createState({
            au_id: "au_rag_stale",
            current_chapter: 2,
            index_status: IndexStatus.STALE,
          }),
          vector_repo: vectorRepo,
          embedding_provider: embeddingProvider,
          _provider_override: createMockProvider(["继续", "写"]),
        }),
      ),
    );

    const contextEvent = events.find((e) => e.type === "context_summary")!;
    const summary = contextEvent.data as any;
    expect(searchSpy).toHaveBeenCalled();
    expect(summary.rag_chunks_retrieved).toBe(1);
    expect(summary.rag_chunks).toMatchObject([{ collection: "chapters", chapter_num: 1 }]);
  });
});
