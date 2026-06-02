// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge Lite: assemble_context_simple — 全塞模式断言。
 *
 * assemble_context 入口测试显式传 writingMode="simple"（末位参数）强制走简单分支，
 * 不依赖任何 ambient 默认（主仓库默认 writingMode="full"）。
 *
 * 同时直接调用 assemble_context_simple 验证内部装配契约，避免 facts/RAG/budget 干扰。
 */

import { describe, expect, it } from "vitest";
import {
  assemble_context,
  assemble_context_simple,
} from "../context_assembler.js";
import { createProject } from "../../domain/project.js";
import { createState } from "../../domain/state.js";
import { createChapter } from "../../domain/chapter.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";

async function seedChapter(
  repo: FileChapterRepository, au_id: string, num: number, content: string,
) {
  await repo.save(createChapter({
    au_id, chapter_num: num, content,
    chapter_id: `ch-${num}`, revision: 1,
    confirmed_at: "2026-05-03T00:00:00Z",
    content_hash: "x", provenance: "ai", generated_with: null,
  }));
}

describe("assemble_context_simple (FicForge Lite)", () => {
  it("全塞分支：包含 worldbuilding / characters / 全部章节 / 当前指令", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    const project = createProject({ project_id: "p1", au_id: "au_simple" });
    const state = createState({
      au_id: "au_simple", current_chapter: 3,
      chapter_titles: { 1: "序章", 2: "邂逅" },
    });
    await seedChapter(chapterRepo, "au_simple", 1, "第一章正文。Alice 走进酒馆。");
    await seedChapter(chapterRepo, "au_simple", 2, "第二章正文。Alice 与 Bob 相遇。");

    const characterFiles = {
      Alice: "# Alice\n红发剑客。",
      Bob: "# Bob\n冰冷的法师。",
    };
    const worldbuildingFiles = {
      Magic: "# 魔法\n源自星火。",
      Geography: "# 地理\n北境冻原。",
    };

    const result = await assemble_context_simple(
      project, state, "写第三章 决斗开始",
      chapterRepo, "au_simple",
      characterFiles, worldbuildingFiles, "zh",
    );

    expect(result.messages).toHaveLength(2);
    // 多轮对话设计（D-0044 follow-up）：worldbuilding/characters/chapters 进 system
    // message（每轮全量最新版）；user message 只含当前 status + user_input。
    const systemContent = result.messages[0].content;
    const userContent = result.messages[1].content;

    expect(systemContent).toContain("## 世界观设定");
    expect(systemContent).toContain("### Magic");
    expect(systemContent).toContain("### Geography");
    expect(systemContent).toContain("源自星火");
    expect(systemContent).toContain("北境冻原");

    expect(systemContent).toContain("## 人物设定");
    expect(systemContent).toContain("### Alice");
    expect(systemContent).toContain("### Bob");
    expect(systemContent).toContain("红发剑客");
    expect(systemContent).toContain("冰冷的法师");

    expect(systemContent).toContain("## 已写章节");
    expect(systemContent).toContain("### 第 1 章 序章");
    expect(systemContent).toContain("### 第 2 章 邂逅");
    expect(systemContent).toContain("Alice 走进酒馆");
    expect(systemContent).toContain("Alice 与 Bob 相遇");

    expect(userContent).toContain("写第三章 决斗开始");
  });

  it("无章节 / 无设定时 user content 仍可生成，仅含指令段", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    const project = createProject({ project_id: "p1", au_id: "au_empty" });
    const state = createState({ au_id: "au_empty", current_chapter: 1 });

    const result = await assemble_context_simple(
      project, state, "开始写第一章",
      chapterRepo, "au_empty",
      null, null, "zh",
    );

    expect(result.messages).toHaveLength(2);
    const userContent = result.messages[1].content;
    expect(userContent).toContain("开始写第一章");
    expect(userContent).not.toContain("## 已写章节");
    expect(userContent).not.toContain("## 世界观设定");
    expect(userContent).not.toContain("## 人物设定");
  });

  it("章节标题部分缺失时 header 退化为单纯章节号", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    const project = createProject({ project_id: "p1", au_id: "au_titles" });
    const state = createState({
      au_id: "au_titles", current_chapter: 4,
      chapter_titles: { 1: "序章" },  // 第 2 / 3 章无 title
    });
    await seedChapter(chapterRepo, "au_titles", 1, "ch1");
    await seedChapter(chapterRepo, "au_titles", 2, "ch2");
    await seedChapter(chapterRepo, "au_titles", 3, "ch3");

    const result = await assemble_context_simple(
      project, state, "继续",
      chapterRepo, "au_titles",
      null, null, "zh",
    );

    // 多轮对话设计：章节进 system message
    const systemContent = result.messages[0].content;
    expect(systemContent).toContain("### 第 1 章 序章");
    expect(systemContent).toContain("### 第 2 章\nch2");
    expect(systemContent).toContain("### 第 3 章\nch3");
    expect(systemContent).not.toContain("### 第 2 章 ");
  });

  it("context_summary 含 chapters_injected 数值", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    const project = createProject({ project_id: "p1", au_id: "au_chcount" });
    const state = createState({ au_id: "au_chcount", current_chapter: 3 });
    await seedChapter(chapterRepo, "au_chcount", 1, "x");
    await seedChapter(chapterRepo, "au_chcount", 2, "y");

    const result = await assemble_context_simple(
      project, state, "写", chapterRepo, "au_chcount", null, null, "zh",
    );
    expect(result.context_summary.chapters_injected).toBe(2);
  });

  it("budget_remaining 不为负：超 ctx 时钳到 0", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    // 故意构造 contextWindow 极小的项目，让全塞内容超出
    const project = createProject({
      project_id: "p1", au_id: "au_overflow",
      llm: { mode: "api" as never, model: "", api_base: "", api_key: "", local_model_path: "", ollama_model: "", context_window: 100 },
    });
    const state = createState({ au_id: "au_overflow", current_chapter: 1 });
    await seedChapter(chapterRepo, "au_overflow", 1, "x".repeat(2000));

    const result = await assemble_context_simple(
      project, state, "写续集", chapterRepo, "au_overflow", null, null, "zh",
    );
    expect(result.budget_report.budget_remaining).toBeGreaterThanOrEqual(0);
  });

  it("budget_report 不做截断：truncated_layers 为空，p1_tokens 为整段 user 内容", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    const project = createProject({ project_id: "p1", au_id: "au_b" });
    const state = createState({ au_id: "au_b", current_chapter: 1 });

    const result = await assemble_context_simple(
      project, state, "继续",
      chapterRepo, "au_b",
      { Alice: "# Alice\nshort" }, null, "zh",
    );

    expect(result.budget_report.truncated_layers).toEqual([]);
    expect(result.budget_report.p1_tokens).toBeGreaterThan(0);
    expect(result.budget_report.p2_tokens).toBe(0);
    expect(result.budget_report.p3_tokens).toBe(0);
    expect(result.budget_report.p4_tokens).toBe(0);
    expect(result.budget_report.p5_tokens).toBe(0);
    expect(result.budget_report.total_input_tokens).toBeGreaterThan(0);
  });

  it("context_summary 反映 simple 模式注入的 characters / worldbuilding 全集", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    const project = createProject({
      project_id: "p1", au_id: "au_s", pinned_context: ["铁律1", "铁律2"],
    });
    const state = createState({ au_id: "au_s", current_chapter: 1 });

    const result = await assemble_context_simple(
      project, state, "写",
      chapterRepo, "au_s",
      { Alice: "x", Bob: "y" }, { Magic: "z" }, "zh",
    );

    expect(result.context_summary.pinned_count).toBe(2);
    expect(result.context_summary.characters_used.sort()).toEqual(["Alice", "Bob"]);
    expect(result.context_summary.worldbuilding_used).toEqual(["Magic"]);
    expect(result.context_summary.truncated_layers).toEqual([]);
  });

  it("assemble_context 入口在 writingMode=\"simple\" 下路由到 simple 分支", async () => {
    // 显式传 writingMode="simple"（末位参数）强制走简单分支；不依赖任何 ambient 默认。
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    const project = createProject({ project_id: "p1", au_id: "au_default" });
    const state = createState({ au_id: "au_default", current_chapter: 1 });
    await seedChapter(chapterRepo, "au_default", 1, "第一章。");

    // 简版 facts / rag_results 都被忽略；显式传非空也不应出现在 user content 里。
    const result = await assemble_context(
      project, state, "写续集", [],
      chapterRepo, "au_default",
      "RAG 应该被忽略",
      { Hero: "# Hero" }, null, "zh",
      "simple",
    );

    const systemContent = result.messages[0].content;
    const userContent = result.messages[1].content;
    expect(userContent).toContain("写续集");
    expect(systemContent).toContain("### Hero");
    expect(systemContent).toContain("第一章");
    expect(userContent).not.toContain("RAG 应该被忽略");
    expect(systemContent).not.toContain("RAG 应该被忽略");
    expect(result.budget_report.truncated_layers).toEqual([]);
  });

  it("英文 prompt 模板正确切换", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    const project = createProject({ project_id: "p1", au_id: "au_en" });
    const state = createState({
      au_id: "au_en", current_chapter: 2,
      chapter_titles: { 1: "Prologue" },
    });
    await seedChapter(chapterRepo, "au_en", 1, "Once upon a time.");

    const result = await assemble_context_simple(
      project, state, "Write the next scene.",
      chapterRepo, "au_en",
      null, null, "en",
    );

    const systemContent = result.messages[0].content;
    const userContent = result.messages[1].content;
    expect(systemContent).toContain("## Confirmed Chapters");
    expect(systemContent).toContain("### Chapter 1 Prologue");
    expect(userContent).toContain("Write the next scene");
  });
});
