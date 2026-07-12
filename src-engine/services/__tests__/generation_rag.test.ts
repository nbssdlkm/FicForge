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
      return {
        content: tokens.join(""),
        model: "mock",
        input_tokens: 10,
        output_tokens: tokens.length,
        finish_reason: "stop",
      };
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
    async get_index_status() {
      return IndexStatus.READY;
    },
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

function makeParams(adapter: MockAdapter, overrides: Partial<Parameters<typeof generate_chapter>[0]> = {}) {
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

// 融合(plan §1.0):generate_chapter 不再按 writing_mode gate RAG —— 删了 disableRAG,
// 写文路径 RAG 恒开。原「writing_mode='simple' 跳过 RAG」用例已随全塞退役删除;保留下方
// full 路径用例,作为 RAG 编排抽到 retrieve_rag_for_context 后的端到端回归守护。
describe("generate_chapter — RAG 检索(写文路径恒开)", () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
  });

  it("repo+embedding 就位 + index READY 时执行 RAG（vector_repo.search 被调用,rag_chunks_retrieved=1）", async () => {
    const searchSpy = vi.fn<VectorRepository["search"]>(async (_auId, _queryEmbedding, options) => {
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

    const events = await collectEvents(
      generate_chapter(
        makeParams(adapter, {
          au_id: "au_full_rag",
          // 融合后无写作模式：RAG 恒开，与任何模式无关（disableRAG gate 已删）。
          settings: createSettings({ app: createAppConfig() }),
          state: createState({
            au_id: "au_full_rag",
            current_chapter: 2,
            index_status: IndexStatus.READY,
          }),
          vector_repo: makeVectorRepo(searchSpy),
          embedding_provider: makeEmbeddingProvider(),
          _provider_override: createMockProvider(["继续", "写"]),
        }),
      ),
    );

    // 核心断言：rag_text===null + repo/embedding 就位 → 内部检索触发,vector_repo.search 被调用
    //（disableRAG gate 已删,触发条件与 writing_mode 无关）。
    expect(searchSpy).toHaveBeenCalled();

    const contextEvent = events.find((e) => e.type === "context_summary");
    expect(contextEvent).toBeDefined();
    expect((contextEvent!.data as { rag_chunks_retrieved: number }).rag_chunks_retrieved).toBe(1);
  });

  it("外部已传入 rag_text → 跳过内部检索（caller gate rag_text===null,vector_repo.search 不被调用）", async () => {
    const searchSpy = vi.fn<VectorRepository["search"]>(async () => [
      { content: "不该被检索到的内部 chunk", chapter_num: 1, score: 0.9, metadata: {} },
    ]);

    const events = await collectEvents(
      generate_chapter(
        makeParams(adapter, {
          au_id: "au_external_rag",
          settings: createSettings({ app: createAppConfig() }),
          state: createState({ au_id: "au_external_rag", current_chapter: 2, index_status: IndexStatus.READY }),
          vector_repo: makeVectorRepo(searchSpy),
          embedding_provider: makeEmbeddingProvider(),
          rag_text: "外部已检索并注入的上下文",
          _provider_override: createMockProvider(["继续", "写"]),
        }),
      ),
    );

    // caller gate `rag_text === null`:外部已传 rag_text → 内部 retrieve_rag_for_context 不触发。
    expect(searchSpy).not.toHaveBeenCalled();
    // 且外部 rag_text 确实被转发进 assemble_context(P4 按行计数 → context_summary 非零),
    // 锁住「gate 跳过内部检索」的同时「外部 rag_text 不被静默丢弃」。
    const ctx = events.find((e) => e.type === "context_summary");
    expect((ctx!.data as { rag_chunks_retrieved: number }).rag_chunks_retrieved).toBeGreaterThan(0);
  });
});
