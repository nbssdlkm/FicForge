// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach, vi } from "vitest";
import { generate_chapter } from "../generation.js";
import type { GenerationEvent } from "../generation.js";
import { createProject, createLLMConfig } from "../../domain/project.js";
import { createState } from "../../domain/state.js";
import { createSettings, createAppConfig } from "../../domain/settings.js";
import { IndexStatus, LLMMode } from "../../domain/enums.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import { FileDraftRepository } from "../../repositories/implementations/file_draft.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import type { EmbeddingProvider } from "../../llm/embedding_provider.js";
import type { LLMProvider, LLMResponse, LLMChunk } from "../../llm/provider.js";
import type { VectorRepository } from "../../repositories/interfaces/vector.js";

// 与 generation.test.ts 同款 mock provider：流式吐出固定 token，最后一块带 usage + stop。
function createMockProvider(tokens: string[] = ["你好", "世界"]): LLMProvider {
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

// 构造一个会被 search spy 记录调用的 VectorRepository（chapters 集合返回 1 条命中）。
function makeVectorRepo(searchSpy: VectorRepository["search"]): VectorRepository {
  return {
    async index_chunks() {},
    search: searchSpy,
    async delete_by_chapter() {},
    async delete_by_source() {},
    async rebuild_index() {},
    async get_index_status() { return IndexStatus.READY; },
  };
}

function makeEmbeddingProvider(): EmbeddingProvider {
  return {
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
}

function makeParams(
  adapter: MockAdapter,
  overrides: Partial<Parameters<typeof generate_chapter>[0]> = {},
) {
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

describe("generate_chapter — writing_mode gate（简版跳过 RAG）", () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
  });

  it("writing_mode='simple' 即便 index_status=STALE 也跳过 RAG（getSimpleFeatures.disableRAG=true）", async () => {
    const searchSpy = vi.fn<VectorRepository["search"]>(async () => []);

    const events = await collectEvents(generate_chapter(makeParams(adapter, {
      au_id: "au_simple_skip_rag",
      settings: createSettings({ app: createAppConfig({ writing_mode: "simple" }) }),
      state: createState({
        au_id: "au_simple_skip_rag",
        current_chapter: 2,
        index_status: IndexStatus.STALE,
      }),
      vector_repo: makeVectorRepo(searchSpy),
      embedding_provider: makeEmbeddingProvider(),
      _provider_override: createMockProvider(["继续", "写"]),
    })));

    // 核心断言：disableRAG 推导为 true → vector_repo.search 从未被调用。
    expect(searchSpy).not.toHaveBeenCalled();

    // LLM 文本仍正常产出草稿（流程没有因跳过 RAG 而中断）。
    const doneEvent = events.find((e) => e.type === "done");
    expect(doneEvent).toBeDefined();
    const data = doneEvent!.data as { full_text: string; draft_label: string };
    expect(data.full_text).toBe("继续写");
    expect(data.draft_label).toBe("A");
  });

  it("writing_mode='full'（默认）+ index_status=READY 时仍执行 RAG（vector_repo.search 被调用）", async () => {
    const searchSpy = vi.fn<VectorRepository["search"]>(async (_auId, _queryEmbedding, options) => {
      if (options.collection !== "chapters") return [];
      return [{
        content: "上一章里 Alice 看见了燃烧的钟楼。",
        chapter_num: 1,
        score: 0.98,
        metadata: {},
      }];
    });

    const events = await collectEvents(generate_chapter(makeParams(adapter, {
      au_id: "au_full_rag",
      // 默认 createSettings() 的 writing_mode 即 "full"；显式写出以表意。
      settings: createSettings({ app: createAppConfig({ writing_mode: "full" }) }),
      state: createState({
        au_id: "au_full_rag",
        current_chapter: 2,
        index_status: IndexStatus.READY,
      }),
      vector_repo: makeVectorRepo(searchSpy),
      embedding_provider: makeEmbeddingProvider(),
      _provider_override: createMockProvider(["继续", "写"]),
    })));

    // 核心断言：full 模式 disableRAG=false → vector_repo.search 被调用。
    expect(searchSpy).toHaveBeenCalled();

    const contextEvent = events.find((e) => e.type === "context_summary");
    expect(contextEvent).toBeDefined();
    expect((contextEvent!.data as { rag_chunks_retrieved: number }).rag_chunks_retrieved).toBe(1);
  });
});
