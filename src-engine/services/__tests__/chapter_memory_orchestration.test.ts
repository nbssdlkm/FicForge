// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * chapter_memory_orchestration（M1：confirm/undo 记忆编排下沉引擎）的行为测试。
 *
 * 覆盖原住 UI api/engine-chapters.test.ts 里无法在 UI 层复现的编排分支（那些依赖
 * barrel spy 引擎函数、下沉后失效）：章节摘要生成+落盘、摘要 gate、回顾 Phase2 CAS
 * 门控（审计⑤）、undo 记忆清理与 index_status 门控。核心 confirm/undo 事务另有
 * confirm_chapter / undo_chapter golden 覆盖，本文件只测其上的记忆编排层。
 *
 * provider 注入式：LLM 用 createMockLLMProvider（固定文本），embedding 用确定性桩，
 * RagManager 用 vi.fn 桩观察调用；核心 confirm 走真内存 repo（MockAdapter）。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmChapterWithMemory, undoChapterWithMemory } from "../chapter_memory_orchestration.js";
import { confirmChapter } from "../confirm_chapter.js";
import { editChapterContent } from "../chapter_edit.js";
import { IndexStatus } from "../../domain/enums.js";
import { createDraft } from "../../domain/draft.js";
import { createState } from "../../domain/state.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import { FileChapterSummaryRepository } from "../../repositories/implementations/file_chapter_summary.js";
import { FileDraftRepository } from "../../repositories/implementations/file_draft.js";
import { FileFactRepository } from "../../repositories/implementations/file_fact.js";
import { FileOpsRepository } from "../../repositories/implementations/file_ops.js";
import { FileStateRepository } from "../../repositories/implementations/file_state.js";
import { createMockLLMProvider } from "./mock_llm_provider.js";
import * as loggerModule from "../../logger/index.js";

const AU = "au1";

// 确定性 embedding 桩（不走网络；4 维）。
const fakeEmb = {
  embed: async (texts: string[]) => texts.map(() => [1, 0, 0, 0]),
  get_dimension: () => 4,
  get_model_name: () => "fake-embed",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

function draftId(n: number): string {
  return `ch${String(n).padStart(4, "0")}_draft_A.md`;
}

describe("chapter_memory_orchestration", () => {
  let adapter: MockAdapter;
  let chapterRepo: FileChapterRepository;
  let draftRepo: FileDraftRepository;
  let stateRepo: FileStateRepository;
  let opsRepo: FileOpsRepository;
  let factRepo: FileFactRepository;
  let summaryRepo: FileChapterSummaryRepository;

  beforeEach(async () => {
    adapter = new MockAdapter();
    chapterRepo = new FileChapterRepository(adapter);
    draftRepo = new FileDraftRepository(adapter);
    stateRepo = new FileStateRepository(adapter);
    opsRepo = new FileOpsRepository(adapter);
    factRepo = new FileFactRepository(adapter);
    summaryRepo = new FileChapterSummaryRepository(adapter);
    await stateRepo.save(createState({ au_id: AU, current_chapter: 1 }));
  });

  function makeRag() {
    return {
      indexChapter: vi.fn(async () => {}),
      removeChapter: vi.fn(async () => {}),
      indexChapterSummary: vi.fn(async () => {}),
    };
  }

  async function seedDraft(n: number, content = `第${n}章正文。Alice 在场。`) {
    await draftRepo.save(createDraft({ au_id: AU, chapter_num: n, variant: "A", content }));
  }

  // 核心 confirm（不带记忆编排，快）—— 用于 seed 前置章节。
  async function coreConfirm(n: number) {
    await confirmChapter({
      au_id: AU,
      chapter_num: n,
      draft_id: draftId(n),
      chapter_repo: chapterRepo,
      draft_repo: draftRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function baseParams(overrides: Record<string, unknown> = {}): any {
    return {
      au_id: AU,
      chapter_num: 1,
      draft_id: draftId(1),
      cast_registry: { characters: [] },
      chapter_repo: chapterRepo,
      draft_repo: draftRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
      chapter_summary_repo: summaryRepo,
      rag_manager: makeRag(),
      embedding_provider: null,
      llm_provider: null,
      language: "zh",
      ...overrides,
    };
  }

  // ===== RAG 索引门控（M1a）=====

  it("embedding 可用 + 增量索引成功 → 首章 confirm 升 READY", async () => {
    await seedDraft(1);
    const rag = makeRag();
    const result = await confirmChapterWithMemory(baseParams({ rag_manager: rag, embedding_provider: fakeEmb }));
    expect(result.chapter_num).toBe(1);
    expect(rag.indexChapter).toHaveBeenCalledOnce();
    expect((await stateRepo.get(AU)).index_status).toBe(IndexStatus.READY);
  });

  it("reindex 失败 → 保持 STALE，confirm 本身不受影响", async () => {
    await seedDraft(1);
    const rag = makeRag();
    rag.indexChapter.mockRejectedValue(new Error("embedding offline"));
    const result = await confirmChapterWithMemory(baseParams({ rag_manager: rag, embedding_provider: fakeEmb }));
    expect(result.chapter_num).toBe(1); // 确认成功
    expect((await stateRepo.get(AU)).index_status).toBe(IndexStatus.STALE);
  });

  it("embedding 不可用 → 不索引，保持 STALE", async () => {
    await seedDraft(1);
    const rag = makeRag();
    await confirmChapterWithMemory(baseParams({ rag_manager: rag, embedding_provider: null }));
    expect(rag.indexChapter).not.toHaveBeenCalled();
    expect((await stateRepo.get(AU)).index_status).toBe(IndexStatus.STALE);
  });

  // ===== 章节摘要（M8-C）=====

  it("embedding+LLM 可用 → 生成 standard 摘要并落盘 + 向量化", async () => {
    await seedDraft(1);
    const rag = makeRag();
    const llm = createMockLLMProvider({ content: "第一章标准摘要" });
    await confirmChapterWithMemory(
      baseParams({ rag_manager: rag, embedding_provider: fakeEmb, llm_provider: llm, title: "固定标题" }),
    );
    // standard 摘要向量化 + repo 落盘（不受写作模式 gate，只受 embedding+LLM 约束）
    expect(rag.indexChapterSummary).toHaveBeenCalled();
    const summary = await summaryRepo.get(AU, 1);
    expect(summary?.standard?.text).toBe("第一章标准摘要");
  });

  it("LLM 不可用（llm_provider null）→ 不生成摘要", async () => {
    await seedDraft(1);
    const rag = makeRag();
    await confirmChapterWithMemory(baseParams({ rag_manager: rag, embedding_provider: fakeEmb, llm_provider: null }));
    expect(rag.indexChapterSummary).not.toHaveBeenCalled();
    expect(await summaryRepo.get(AU, 1)).toBeNull();
  });

  // ===== 回顾 Phase2 CAS 门控（审计⑤）=====

  // seed 到「confirm ch10 会触发回顾 target5」的状态：ch1-9 已确认（current=10）、
  // ch6-9 有 micro 摘要（generateRetrospective Step3 需 target+1..current-1 的 micro）、ch10 有草稿。
  async function seedForRetrospective() {
    for (let i = 1; i <= 9; i++) {
      await seedDraft(i);
      await coreConfirm(i);
    }
    for (let i = 6; i <= 9; i++) {
      const ch = await chapterRepo.get(AU, i);
      await summaryRepo.updateMicro(AU, i, `第${i}章微摘要`, ch!.content_hash);
    }
    await seedDraft(10, "第10章正文。");
  }

  it("回顾触发 + CAS 一致（target 章未变）→ commit（target5 摘要向量覆盖）", async () => {
    await seedForRetrospective();
    const rag = makeRag();
    const llm = createMockLLMProvider({ content: "回顾 v2 文本" });
    await confirmChapterWithMemory(
      baseParams({
        chapter_num: 10,
        draft_id: draftId(10),
        rag_manager: rag,
        embedding_provider: fakeEmb,
        llm_provider: llm,
        title: "第10章",
      }),
    );
    // commitRetrospective → indexChapterSummary(au, 5, v2Text)
    const retroCall = rag.indexChapterSummary.mock.calls.find((c) => c[1] === 5);
    expect(retroCall).toBeTruthy();
    expect(retroCall?.[2]).toBe("回顾 v2 文本");
  });

  it("回顾 CAS 不一致（Phase1 生成期间 target 章被并发编辑）→ 跳过 commit", async () => {
    await seedForRetrospective();
    const rag = makeRag();
    // fake provider 在「回顾生成」这一次调用里 await 改 ch5 → Phase2 读到的 hash ≠ Phase1 →
    // CAS 检出不一致 → 不提交（不用编辑前旧正文重建摘要 + 覆盖向量）。判据：回顾 user prompt
    // 携带后续 micro 行「第 6 章：…」，摘要 prompt 不含 —— 据此只在回顾生成时动手。
    let edited = false;
    const llm = {
      calls: [] as unknown[],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      generate: async (params: any) => {
        const isRetro =
          Array.isArray(params.messages) &&
          params.messages.some(
            (m: { content?: unknown }) => typeof m.content === "string" && m.content.includes("第 6 章"),
          );
        if (isRetro && !edited) {
          edited = true;
          await editChapterContent(AU, 5, "第5章被并发编辑的全新内容", chapterRepo, stateRepo, opsRepo);
        }
        return { content: "回顾 v2 文本", input_tokens: 0, output_tokens: 0 };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, require-yield
      generateStream: async function* (): AsyncIterable<any> {
        return;
      },
    };
    await confirmChapterWithMemory(
      baseParams({
        chapter_num: 10,
        draft_id: draftId(10),
        rag_manager: rag,
        embedding_provider: fakeEmb,
        llm_provider: llm,
        title: "第10章",
      }),
    );
    // ch5 的回顾向量覆盖不应发生（CAS 拦截）
    const retroCall = rag.indexChapterSummary.mock.calls.find((c) => c[1] === 5);
    expect(retroCall).toBeFalsy();
    expect(edited).toBe(true); // 确认编辑确实在回顾生成期间发生（否则测试无意义）
  });

  // ===== undo 记忆清理（H9a）=====

  it("undo 删向量 + 删摘要，undo 前 READY → 恢复 READY", async () => {
    await seedDraft(1);
    await coreConfirm(1);
    await stateRepo.update(AU, (st) => {
      st.index_status = IndexStatus.READY;
    });
    const removeSummarySpy = vi.spyOn(summaryRepo, "remove");
    const rag = makeRag();
    const result = await undoChapterWithMemory({
      au_id: AU,
      cast_registry: { characters: [] },
      chapter_repo: chapterRepo,
      draft_repo: draftRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
      fact_repo: factRepo,
      chapter_summary_repo: summaryRepo,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rag_manager: rag as any,
    });
    expect(result.chapter_num).toBe(1);
    expect(rag.removeChapter).toHaveBeenCalledWith(AU, 1);
    expect(removeSummarySpy).toHaveBeenCalledWith(AU, 1);
    expect((await stateRepo.get(AU)).index_status).toBe(IndexStatus.READY);
  });

  it("undo removeChapter 失败 → 保持 STALE，undo 本身不受影响", async () => {
    await seedDraft(1);
    await coreConfirm(1);
    await stateRepo.update(AU, (st) => {
      st.index_status = IndexStatus.READY;
    });
    const rag = makeRag();
    rag.removeChapter.mockRejectedValue(new Error("disk error"));
    const result = await undoChapterWithMemory({
      au_id: AU,
      cast_registry: { characters: [] },
      chapter_repo: chapterRepo,
      draft_repo: draftRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
      fact_repo: factRepo,
      chapter_summary_repo: summaryRepo,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rag_manager: rag as any,
    });
    expect(result.chapter_num).toBe(1); // undo 成功
    expect((await stateRepo.get(AU)).index_status).toBe(IndexStatus.STALE);
  });

  // ===== 审阅整改（ultracode R2/R3/R4）：补编排分支覆盖 =====

  // R2：摘要 CAS-reject 分支此前只有 retrospective 侧被测，standard/micro 侧缺对称覆盖。
  it("摘要 CAS：standard 生成期间章节被并发编辑（hash 变）→ 摘要不落盘不索引", async () => {
    await seedDraft(1);
    const rag = makeRag();
    // fake provider 在 standard 摘要生成的那次 generate 里改 ch1 → 锁内 CAS 读到的 content_hash
    // ≠ confirm 时的 result.content_hash → stillCurrent=false → 摘要作废不落盘（防止用编辑后
    // 内容算出的摘要污染 RAG）。
    let edited = false;
    const llm = {
      calls: [] as unknown[],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      generate: async () => {
        if (!edited) {
          edited = true;
          await editChapterContent(AU, 1, "第1章被并发编辑的全新内容", chapterRepo, stateRepo, opsRepo);
        }
        return { content: "章节摘要文本", input_tokens: 0, output_tokens: 0 };
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, require-yield
      generateStream: async function* (): AsyncIterable<any> {
        return;
      },
    };
    await confirmChapterWithMemory(
      baseParams({ rag_manager: rag, embedding_provider: fakeEmb, llm_provider: llm, title: "固定标题" }),
    );
    expect(edited).toBe(true); // 编辑确实在摘要生成期间发生（否则测试无意义）
    // CAS 拦截：摘要不向量化、不落盘
    expect(rag.indexChapterSummary).not.toHaveBeenCalled();
    expect((await summaryRepo.get(AU, 1))?.standard).toBeFalsy();
  });

  // R3：标题自动生成 + 写盘编排此前无集成覆盖（chapter_titles + set_chapter_title op）。
  it("标题自动生成：无 title + llm 可用 → 生成标题写入 chapter_titles + 落 set_chapter_title op", async () => {
    await seedDraft(1);
    const rag = makeRag();
    const llm = createMockLLMProvider({ content: "初入江湖" }); // ≤30 字符 → 作标题
    // 不配 embedding → 跳过 RAG/摘要，隔离标题路径
    await confirmChapterWithMemory(baseParams({ rag_manager: rag, embedding_provider: null, llm_provider: llm }));
    const st = await stateRepo.get(AU);
    expect(st.chapter_titles[1]).toBe("初入江湖");
    const ops = await opsRepo.listAll(AU);
    const titleOp = ops.find((o) => o.op_type === "set_chapter_title" && o.chapter_num === 1);
    expect(titleOp).toBeTruthy();
    expect(titleOp?.payload.title).toBe("初入江湖");
  });

  // R4：迁移时删了两处 logCatch 断言（barrel spy 失效），在引擎侧补回可观测性覆盖。
  it("reindex 失败落 logCatch（可观测性）", async () => {
    await seedDraft(1);
    const rag = makeRag();
    rag.indexChapter.mockRejectedValue(new Error("embedding offline"));
    const logSpy = vi.spyOn(loggerModule, "logCatch");
    await confirmChapterWithMemory(baseParams({ rag_manager: rag, embedding_provider: fakeEmb }));
    expect(logSpy).toHaveBeenCalledWith("rag", "Failed to index chapter 1 after confirm", expect.any(Error));
  });

  it("undo removeChapter 失败落 logCatch（可观测性）", async () => {
    await seedDraft(1);
    await coreConfirm(1);
    const rag = makeRag();
    rag.removeChapter.mockRejectedValue(new Error("disk error"));
    const logSpy = vi.spyOn(loggerModule, "logCatch");
    await undoChapterWithMemory({
      au_id: AU,
      cast_registry: { characters: [] },
      chapter_repo: chapterRepo,
      draft_repo: draftRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
      fact_repo: factRepo,
      chapter_summary_repo: summaryRepo,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rag_manager: rag as any,
    });
    expect(logSpy).toHaveBeenCalledWith("rag", "Failed to remove vectors after undo 1", expect.any(Error));
  });
});
