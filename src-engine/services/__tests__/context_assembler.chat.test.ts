// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 对话式 × 记忆栈融合 P1.2：assemble_chat_context — 分层对话上下文。
 *
 * 与 assemble_context_simple（全塞）的区别：
 *  - 复用 P0-P5 builder（facts / threads / 上一章 / 核心设定）+ retrieve_rag_for_context，
 *    按 D-0039 预算切分，而不是无脑全塞。
 *  - 产物切成 { systemContent, latestUserContent, budget_report }：记忆进 system，
 *    最新轮 user 进 latestUserContent（dispatch 把 history 夹在中间）。
 *  - budget_report 必须保留（token badge 经 estimate_simple_tokens 读它，融合 plan §1.2 B7）。
 *  - 输入侧预留 chatHistoryReserve（上限 + 最新轮硬保），给多轮历史留余量。
 */

import { describe, expect, it } from "vitest";
import {
  assemble_chat_context,
  build_system_prompt_simple,
  compute_input_budget,
  CHAT_HISTORY_RESERVE_RATIO,
  CHAT_HISTORY_RESERVE_CEIL,
} from "../context_assembler.js";
import { createProject, createLLMConfig } from "../../domain/project.js";
import { createState } from "../../domain/state.js";
import { createChapter } from "../../domain/chapter.js";
import { createFact } from "../../domain/fact.js";
import { createThread } from "../../domain/thread.js";
import { FactStatus, NarrativeWeight, LLMMode } from "../../domain/enums.js";
import { count_tokens, ensure_tokenizer } from "../../tokenizer/index.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import type { VectorRepository, SearchOptions, SearchResult, VectorChunk } from "../../repositories/interfaces/vector.js";
import type { EmbeddingProvider } from "../../llm/embedding_provider.js";
import { IndexStatus } from "../../domain/enums.js";

// --- RAG mocks（沿用 rag_retrieval.test.ts 同款）---
const mockEmbedding: EmbeddingProvider = {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => [1, 0, 0]);
  },
  get_dimension() { return 3; },
  get_model_name() { return "mock"; },
};

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

/** embed() 调用计数的 embedding provider —— 用于断言 RAG 是否真被触发（gate 短路验证）。 */
function countingEmbedding(): { provider: EmbeddingProvider; count: () => number } {
  let n = 0;
  return {
    provider: {
      async embed(texts: string[]): Promise<number[][]> { n++; return texts.map(() => [1, 0, 0]); },
      get_dimension() { return 3; },
      get_model_name() { return "mock"; },
    },
    count: () => n,
  };
}

async function seedChapter(
  repo: FileChapterRepository, au_id: string, num: number, content: string,
) {
  await repo.save(createChapter({
    au_id, chapter_num: num, content,
    chapter_id: `ch-${num}`, revision: 1,
    confirmed_at: "2026-06-28T00:00:00Z",
    content_hash: "x", provenance: "ai", generated_with: null,
  }));
}

function baseProject(overrides: Record<string, unknown> = {}) {
  return createProject({
    project_id: "p1", au_id: "au_chat",
    llm: createLLMConfig({ mode: LLMMode.API, model: "test", api_base: "x", api_key: "k" }),
    ...overrides,
  });
}

describe("assemble_chat_context (对话式 × 记忆栈融合 P1.2)", () => {
  it("注入：facts / 剧情线 / 上一章 / 核心设定 进 systemContent；latestUserContent 含 status + user_input", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    const project = baseProject({ core_always_include: ["Alice"] });
    const state = createState({ au_id: "au_chat", current_chapter: 3 });
    await seedChapter(chapterRepo, "au_chat", 2, "第二章结尾：Alice 拔剑指向 Bob。");

    const facts = [
      createFact({ id: "f1", content_raw: "x", content_clean: "Alice 是红发剑客", status: FactStatus.ACTIVE, chapter: 1 }),
      createFact({ id: "f2", content_raw: "y", content_clean: "Bob 隐藏了身世", status: FactStatus.UNRESOLVED, chapter: 2, narrative_weight: NarrativeWeight.HIGH }),
    ];
    const threads = [
      createThread({ id: "t1", title: "复仇线", state: "Alice 正在追查仇人" }),
    ];

    const result = await assemble_chat_context({
      project, state, user_input: "让 Alice 先发制人",
      facts, threads,
      chapter_repo: chapterRepo, au_id: "au_chat",
      character_files: { Alice: "# Alice\n红发剑客，背负血仇。" },
      language: "zh",
    });

    const { systemContent, latestUserContent } = result;

    // 记忆全进 system
    expect(systemContent).toContain("Alice 是红发剑客");
    expect(systemContent).toContain("Bob 隐藏了身世");
    expect(systemContent).toContain("复仇线");
    expect(systemContent).toContain("Alice 正在追查仇人");
    expect(systemContent).toContain("第二章结尾");
    expect(systemContent).toContain("### Alice");
    expect(systemContent).toContain("背负血仇");
    // 对话人设（SIMPLE_CHAT persona）在 systemContent 开头 + 与记忆层之间有 "---" 分隔（契约固定）
    expect(systemContent.startsWith(build_system_prompt_simple(project, "zh"))).toBe(true);
    expect(systemContent).toContain("\n\n---\n\n");

    // 最新轮 user 进 latestUserContent，不含记忆
    expect(latestUserContent).toContain("让 Alice 先发制人");
    expect(latestUserContent).toContain("第3章");
    expect(latestUserContent).not.toContain("Alice 是红发剑客");
    expect(latestUserContent).not.toContain("复仇线");
  });

  it("产物契约：保留 budget_report（token badge 靠它）+ max_tokens", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    const project = baseProject();
    const state = createState({ au_id: "au_chat", current_chapter: 1 });

    const result = await assemble_chat_context({
      project, state, user_input: "开始第一章",
      facts: [],
      chapter_repo: chapterRepo, au_id: "au_chat",
      language: "zh",
    });

    expect(result.budget_report).toBeDefined();
    expect(result.budget_report.context_window).toBeGreaterThan(0);
    expect(result.budget_report.max_output_tokens).toBeGreaterThan(0);
    expect(result.budget_report.total_input_tokens).toBeGreaterThan(0);
    // total_input_tokens = persona + 各记忆层 + latest user（账面口径，对齐 full assembler）
    expect(result.budget_report.total_input_tokens).toBe(
      result.budget_report.system_tokens
      + result.budget_report.p1_tokens
      + result.budget_report.p2_tokens
      + result.budget_report.p3_tokens
      + result.budget_report.thread_tokens
      + result.budget_report.p4_tokens
      + result.budget_report.p5_tokens,
    );
    expect(result.max_tokens).toBe(result.budget_report.max_output_tokens);
  });

  it("RAG：传 vector_repo + embedding → P4 进 systemContent 且计入 budget", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    const project = baseProject({ cast_registry: { characters: ["Alice"] }, core_always_include: ["Alice"] });
    const state = createState({ au_id: "au_chat", current_chapter: 5, last_scene_ending: "Alice 走入密林" });
    const vectorRepo = createMockVectorRepo({
      chapters: [{ content: "RAG 召回片段：密林深处有古老祭坛。", chapter_num: 2, score: 0.9, metadata: {} }],
    });

    const result = await assemble_chat_context({
      project, state, user_input: "Alice 继续深入",
      facts: [createFact({ id: "f1", content_raw: "x", content_clean: "Alice 在寻找祭坛", status: FactStatus.ACTIVE, chapter: 1 })],
      chapter_repo: chapterRepo, au_id: "au_chat",
      vector_repo: vectorRepo, embedding_provider: mockEmbedding,
      language: "zh",
    });

    expect(result.systemContent).toContain("密林深处有古老祭坛");
    expect(result.budget_report.p4_tokens).toBeGreaterThan(0);
    expect(result.context_summary.rag_chunks_retrieved).toBeGreaterThan(0);
  });

  it("不传 vector_repo → gate 在 vector_repo 处短路，embedding 一次都不调用（estimate 路径省钱保证）", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    const project = baseProject();
    const state = createState({ au_id: "au_chat", current_chapter: 2 });
    // 故意只给 embedding 不给 vector_repo：gate `vector_repo && embedding_provider` 应在
    // vector_repo（undefined）处短路，embed() 永不被调用 —— 这是 estimate 每次估算不触发
    // embedding 调用（避免按键级开销）的真正保证，仅断言 p4_tokens===0 抓不住。
    const emb = countingEmbedding();

    const result = await assemble_chat_context({
      project, state, user_input: "继续",
      facts: [createFact({ id: "f1", content_raw: "x", content_clean: "事实A", status: FactStatus.ACTIVE })],
      chapter_repo: chapterRepo, au_id: "au_chat",
      embedding_provider: emb.provider, // 无 vector_repo
      language: "zh",
    });

    expect(result.budget_report.p4_tokens).toBe(0);
    expect(emb.count()).toBe(0);
  });

  it("空记忆回退：无 facts/threads/章节/RAG/核心设定 → systemContent = 纯人设，不崩", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    const project = baseProject();
    const state = createState({ au_id: "au_chat", current_chapter: 1 });

    const result = await assemble_chat_context({
      project, state, user_input: "你好",
      facts: [],
      chapter_repo: chapterRepo, au_id: "au_chat",
      language: "zh",
    });

    expect(result.systemContent).toBe(build_system_prompt_simple(project, "zh"));
    expect(result.latestUserContent).toContain("你好");
    expect(result.budget_report.p2_tokens).toBe(0);
    expect(result.budget_report.p3_tokens).toBe(0);
    expect(result.budget_report.thread_tokens).toBe(0);
    expect(result.budget_report.p4_tokens).toBe(0);
    expect(result.budget_report.p5_tokens).toBe(0);
  });

  it("最新轮硬保：极小 context window 下 latestUserContent 仍完整，核心设定走低保，不崩", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    // ctx=100 强制预算被挤爆
    const project = baseProject({
      llm: createLLMConfig({ mode: LLMMode.API, model: "", api_base: "x", api_key: "k", context_window: 100 }),
      core_always_include: ["Hero"],
    });
    const state = createState({ au_id: "au_chat", current_chapter: 1 });

    const result = await assemble_chat_context({
      project, state, user_input: "写一段惊心动魄的开场",
      facts: [createFact({ id: "f1", content_raw: "x", content_clean: "x".repeat(500), status: FactStatus.UNRESOLVED })],
      chapter_repo: chapterRepo, au_id: "au_chat",
      character_files: { Hero: "# Hero\n勇者。" },
      language: "zh",
    });

    // 最新轮（用户输入）逐字不丢 —— 硬保的核心断言
    expect(result.latestUserContent).toContain("写一段惊心动魄的开场");
    // 核心设定低保：Hero 仍注入
    expect(result.systemContent).toContain("### Hero");
    // 载荷断言：超大 fact 在预算挤压下被真正丢弃（不出现在 systemContent 里），而非靠
    // budget_remaining<0 这种 debug 字段间接"暗示"（后者对任何 used>budget 都成立、证明不了 fact 缺席）。
    expect(result.systemContent).not.toContain("x".repeat(500));
    expect(result.budget_report.unresolved_soft_degraded).toBe(true);
  });

  it("历史预留：记忆层选择预算被压在 memBudget=budget−reserve 内（抓 reserve 回归）", async () => {
    await ensure_tokenizer();
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    // ctx 收窄到 12000 让"记忆远超 memBudget"可判定（默认 32k 下小 fixture 塞得下不降级）。
    // 显式设 core_guarantee_budget，避免测试侧硬抄默认值 400（单一真相源）。
    const coreGuarantee = 400;
    const project = baseProject({
      llm: createLLMConfig({ mode: LLMMode.API, model: "test", api_base: "x", api_key: "k", context_window: 12000 }),
      core_guarantee_budget: coreGuarantee,
    });
    const state = createState({ au_id: "au_chat", current_chapter: 1 });

    // 200 条**内容完全一致**的 fact（无 _confidence → 无富化后缀）：每条选择期 token 数恒定、
    // 可在测试侧精确复算 build_facts_layer 的贪心选择量，从而对 selection budget 做精确断言。
    const factContent = "内容".repeat(20);
    const facts = Array.from({ length: 200 }, (_, i) =>
      createFact({ id: `f${i}`, content_raw: "x", content_clean: factContent, status: FactStatus.UNRESOLVED }),
    );

    const result = await assemble_chat_context({
      project, state, user_input: "继续",
      facts,
      chapter_repo: chapterRepo, au_id: "au_chat",
      language: "zh",
    });

    const br = result.budget_report;
    // P3 被软降级（预算不够塞全部 fact）—— 确认这是"预算受限"场景而非塞得下。
    expect(br.unresolved_soft_degraded).toBe(true);

    // 复算 budget / reserve / memBudget（用 export 的单一真相源公式 + 常量，不手抄）。
    const budget = Math.max(0, compute_input_budget(br.context_window, br.system_tokens, br.max_output_tokens));
    const reserve = Math.min(Math.trunc(budget * CHAT_HISTORY_RESERVE_RATIO), CHAT_HISTORY_RESERVE_CEIL);
    const memBudget = budget - reserve;
    expect(reserve).toBeGreaterThan(0); // fixture 前提：reserve 确实非零

    // build_facts_layer 的 selection budget = memBudget − latestUser(p1) − core_guarantee；
    // 它按 content+后缀 token 贪心保留 fact（后缀此处为空），保证"已保留 fact 的 content token 总和"
    // ≤ selection budget。p3_tokens 是**渲染后**计数（含 "- [unresolved] " 前缀/表头/丢弃提示），
    // 会超 selection budget，故必须用 content token 复算、不能直接用 p3_tokens。
    const perFactContent = count_tokens(factContent, project.llm).count;
    const selectionBudget = memBudget - br.p1_tokens - coreGuarantee;
    const keptContentTokens = result.context_summary.facts_injected * perFactContent;

    // 关键回归断言：已保留 fact 的 content token ≤ memBudget 派生的 selection budget（**不是** budget）。
    // 若有人误删 `memBudget = budget − reserve`（记忆层改用全量 budget），selection budget 涨一个
    // reserve，会多保留 ≈ reserve/perFact 条 fact，keptContentTokens 逼近 budget−p1−guarantee > 本上限
    // → 断言变红。这正是旧 `budget_remaining > 0`（被 core_guarantee 兜住、reserve=0 也绿）抓不住的回归。
    expect(keptContentTokens).toBeLessThanOrEqual(selectionBudget);
    // 下界：贪心填到差不超过一条 fact，证明确实"被 reserve 压满"而非 fixture 本就小。
    expect(keptContentTokens).toBeGreaterThan(selectionBudget - perFactContent);
  });

  it("英文模板正确切换", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    const project = baseProject();
    const state = createState({ au_id: "au_chat", current_chapter: 2 });
    await seedChapter(chapterRepo, "au_chat", 1, "Once upon a time.");

    const result = await assemble_chat_context({
      project, state, user_input: "Write the next scene.",
      facts: [],
      chapter_repo: chapterRepo, au_id: "au_chat",
      language: "en",
    });

    expect(result.latestUserContent).toContain("Write the next scene");
    expect(result.latestUserContent).toContain("Chapter 2");
    expect(result.systemContent).toContain("Once upon a time");
  });
});
