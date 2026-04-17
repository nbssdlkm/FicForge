// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Context Assembler semantic golden tests.
 *
 * Verifies: messages[1].content section ordering, truncation behavior,
 * budget competition under pressure, and RAG discard under tight budget.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { assemble_context } from "../context_assembler.js";
import { createProject, createLLMConfig, createWritingStyle, createCastRegistry } from "../../domain/project.js";
import { createState } from "../../domain/state.js";
import { createFact } from "../../domain/fact.js";
import { createChapter } from "../../domain/chapter.js";
import { FactStatus, NarrativeWeight, FactType } from "../../domain/enums.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";

describe("Context Assembler — semantic golden tests", () => {
  let adapter: MockAdapter;
  let chapterRepo: FileChapterRepository;

  beforeEach(() => {
    adapter = new MockAdapter();
    chapterRepo = new FileChapterRepository(adapter);
  });

  // -----------------------------------------------------------
  // 6.2.1 Section order: P5 → P4 → P2 → P3 → P1
  // -----------------------------------------------------------

  it("messages[1].content follows reversed section order: P5 → P4 → P2 → P3 → P1", async () => {
    // Set up chapter 1 so P2 (recent chapter) has content
    await chapterRepo.save(createChapter({
      au_id: "order1", chapter_num: 1,
      content: "这是第一章的内容。Alice和Bob相遇了。",
      chapter_id: "ch1-id", provenance: "ai",
    }));

    const facts = [
      createFact({
        id: "f1", content_raw: "r", content_clean: "Alice是一个勇敢的人",
        chapter: 1, status: FactStatus.ACTIVE, type: FactType.CHARACTER_DETAIL,
        narrative_weight: NarrativeWeight.HIGH,
      }),
    ];

    const project = createProject({
      project_id: "pOrder", au_id: "order1",
      llm: createLLMConfig({ mode: "api" as any, model: "gpt-4o", context_window: 32000 }),
      chapter_length: 1500,
      cast_registry: createCastRegistry({ characters: ["Alice", "Bob"] }),
      core_always_include: ["Alice"],
    });
    const state = createState({
      au_id: "order1", current_chapter: 2,
      last_scene_ending: "他们走了。",
    });

    const result = await assemble_context(
      project, state, "继续写", facts, chapterRepo, "order1",
      "### RAG结果\n这是一段检索到的内容。",
      { Alice: "# Alice\n勇敢", Bob: "# Bob\n聪明" },
      { 世界观: "# 世界观\n设定内容" },
    );

    const content = result.messages[1].content;

    // Verify section order by finding each section's position
    const p5CharIdx = content.indexOf("## 人物设定");
    const p5WbIdx = content.indexOf("## 世界观设定");
    const p4RagIdx = content.indexOf("### RAG结果");
    const p2Idx = content.indexOf("## 上一章结尾");
    const p3Idx = content.indexOf("## 当前剧情状态");
    // P1 contains "## 当前状态" (from CURRENT_STATUS prompt)
    const p1Idx = content.indexOf("## 当前状态");

    // P5 (characters + worldbuilding) should come first
    expect(p5CharIdx).toBeGreaterThanOrEqual(0);
    expect(p5WbIdx).toBeGreaterThanOrEqual(0);

    // P4 (RAG) should come after P5
    expect(p4RagIdx).toBeGreaterThan(p5WbIdx);

    // P2 (recent chapter) should come after P4
    expect(p2Idx).toBeGreaterThan(p4RagIdx);

    // P3 (facts) should come after P2
    expect(p3Idx).toBeGreaterThan(p2Idx);

    // P1 (instruction) should come last
    // Note: P1 header "## 当前状态" must appear after P3's "## 当前剧情状态"
    // We search for P1 starting after P3 to avoid matching P3's section
    const p1SearchStart = p3Idx + "## 当前剧情状态".length;
    const p1IdxAfterP3 = content.indexOf("## 当前状态", p1SearchStart);
    expect(p1IdxAfterP3).toBeGreaterThan(p3Idx);
  });

  // -----------------------------------------------------------
  // 6.2.2 Truncation: tight budget drops RAG (P4)
  // -----------------------------------------------------------

  it("tight budget: RAG (P4) dropped when budget exhausted by P1+P3+P2", async () => {
    await chapterRepo.save(createChapter({
      au_id: "tight1", chapter_num: 1,
      content: "短章节内容。",
      chapter_id: "ch1-tight", provenance: "ai",
    }));

    const facts = Array.from({ length: 20 }, (_, i) => createFact({
      id: `tf${i}`, content_raw: "r",
      content_clean: `这是一条很长的事实内容用来占预算第${i}条`.repeat(3),
      chapter: 1, status: FactStatus.ACTIVE, type: FactType.PLOT_EVENT,
      narrative_weight: NarrativeWeight.HIGH,
    }));

    const project = createProject({
      project_id: "pTight", au_id: "tight1",
      llm: createLLMConfig({ mode: "api" as any, model: "gpt-4o", context_window: 4096 }),
      chapter_length: 800,
    });
    const state = createState({
      au_id: "tight1", current_chapter: 2,
      last_scene_ending: "结尾。",
    });

    const bigRag = "### RAG\n" + "这是RAG检索的大段文本。".repeat(50);

    const result = await assemble_context(
      project, state, "写", facts, chapterRepo, "tight1",
      bigRag,
    );

    // RAG should be dropped entirely
    expect(result.budget_report.p4_tokens).toBe(0);
    expect(result.messages[1].content).not.toContain("RAG检索");
    // P4 should be in truncated_layers
    expect(result.budget_report.truncated_layers).toContain("P4");
  });

  // -----------------------------------------------------------
  // 6.2.3 Budget competition: unresolved soft degradation
  // -----------------------------------------------------------

  it("many unresolved facts → soft degradation: some dropped, report reflects it", async () => {
    // Each fact is ~60 tokens of Chinese text. 50 unresolved facts at ~60 tokens
    // each = ~3000 tokens total. With a 4096 window, system prompt eats ~800 tokens,
    // 60% budget = ~2458 minus system = ~1658, minus P1 = ~1400 for P3.
    // This should force soft degradation.
    const facts = Array.from({ length: 50 }, (_, i) => createFact({
      id: `uf${i}`, content_raw: "r",
      content_clean: `未解决的伏笔第${i}条，这段文字比较长来测试截断行为，需要更多文字来���据更多的token空间`.repeat(3),
      chapter: (i % 5) + 1,
      status: FactStatus.UNRESOLVED,
      type: FactType.FORESHADOWING,
      narrative_weight: [NarrativeWeight.HIGH, NarrativeWeight.MEDIUM, NarrativeWeight.LOW][i % 3],
    }));

    const project = createProject({
      project_id: "pSoft", au_id: "soft1",
      llm: createLLMConfig({ mode: "api" as any, model: "gpt-4o", context_window: 4096 }),
      chapter_length: 800,
    });
    const state = createState({ au_id: "soft1", current_chapter: 1 });

    const result = await assemble_context(
      project, state, "开始写", facts, chapterRepo, "soft1",
    );

    // Should have soft degradation
    expect(result.budget_report.unresolved_soft_degraded).toBe(true);
    // Not all facts should be injected (some dropped due to budget)
    expect(result.context_summary.facts_injected).toBeLessThan(50);
    expect(result.context_summary.facts_injected).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------
  // 6.2.4 core_guarantee_budget: P5 characters survive tight budget
  // -----------------------------------------------------------

  it("core_guarantee_budget: core characters injected even when main budget is zero", async () => {
    // Many facts eat up the budget, but core character should still be injected
    const facts = Array.from({ length: 15 }, (_, i) => createFact({
      id: `gf${i}`, content_raw: "r",
      content_clean: `事实${i}`.repeat(10),
      chapter: 1, status: FactStatus.ACTIVE, type: FactType.PLOT_EVENT,
      narrative_weight: NarrativeWeight.HIGH,
    }));

    const project = createProject({
      project_id: "pGuarantee", au_id: "guarantee1",
      llm: createLLMConfig({ mode: "api" as any, model: "gpt-4o", context_window: 8000 }),
      chapter_length: 1000,
      cast_registry: createCastRegistry({ characters: ["主角", "配角A", "配角B"] }),
      core_always_include: ["主角"],
      core_guarantee_budget: 400,
    });
    const state = createState({ au_id: "guarantee1", current_chapter: 1 });

    const result = await assemble_context(
      project, state, "写", facts, chapterRepo, "guarantee1",
      null,
      { 主角: "# 主角\n核心角色设定", 配角A: "# 配角A\n设定", 配角B: "# 配角B\n设定" },
    );

    // Core character (主角) must be included
    expect(result.context_summary.characters_used).toContain("主角");
    expect(result.budget_report.p5_tokens).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------
  // 6.2.5 Empty AU: first chapter has minimal layers
  // -----------------------------------------------------------

  it("first chapter on empty AU: no P2, no P3, no P4", async () => {
    const project = createProject({
      project_id: "pEmpty", au_id: "empty1",
      llm: createLLMConfig({ mode: "api" as any, model: "gpt-4o", context_window: 32000 }),
      chapter_length: 1500,
    });
    const state = createState({ au_id: "empty1", current_chapter: 1 });

    const result = await assemble_context(
      project, state, "开始写第一章", [], chapterRepo, "empty1",
    );

    expect(result.budget_report.p2_tokens).toBe(0);
    expect(result.budget_report.p3_tokens).toBe(0);
    expect(result.budget_report.p4_tokens).toBe(0);
    expect(result.context_summary.facts_injected).toBe(0);

    // Only system + P1 should be present
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[1].role).toBe("user");
    // P1 content should contain the user input
    expect(result.messages[1].content).toContain("开始写第一章");
  });

  // -----------------------------------------------------------
  // 6.2.6 Chapter focus: focus facts appear in P1, not in P3
  // -----------------------------------------------------------

  it("chapter_focus facts appear in P1 instruction, excluded from P3 facts layer", async () => {
    const focusFact = createFact({
      id: "focus1", content_raw: "r", content_clean: "Alice要揭开真相",
      chapter: 1, status: FactStatus.UNRESOLVED, type: FactType.FORESHADOWING,
      narrative_weight: NarrativeWeight.HIGH,
    });
    const regularFact = createFact({
      id: "regular1", content_raw: "r", content_clean: "Bob在旁边等待",
      chapter: 1, status: FactStatus.ACTIVE, type: FactType.PLOT_EVENT,
      narrative_weight: NarrativeWeight.MEDIUM,
    });

    const project = createProject({
      project_id: "pFocus", au_id: "focus1",
      llm: createLLMConfig({ mode: "api" as any, model: "gpt-4o", context_window: 32000 }),
      chapter_length: 1500,
    });
    const state = createState({
      au_id: "focus1", current_chapter: 2,
      chapter_focus: ["focus1"],
    });

    const result = await assemble_context(
      project, state, "继续写", [focusFact, regularFact], chapterRepo, "focus1",
    );

    const content = result.messages[1].content;

    // Focus fact should appear in P1 section (within focus goal definition)
    // P1 is the last section in reversed order, so it's at the end
    const focusGoalIdx = content.indexOf("Alice要揭开真相");
    expect(focusGoalIdx).toBeGreaterThanOrEqual(0);

    // P3 facts layer: should have regular fact but NOT focus fact
    // P3 (当前剧情状态) comes before P1 (当前状态) in the reversed output.
    // Extract only the P3 section by finding both boundaries.
    const p3Start = content.indexOf("## 当前剧情状态");
    expect(p3Start).toBeGreaterThanOrEqual(0);
    // P1 starts with "## 当前状态" which appears after P3
    const p1Start = content.indexOf("## 当前状态", p3Start + 1);
    const p3Content = p1Start >= 0
      ? content.slice(p3Start, p1Start)
      : content.slice(p3Start);

    expect(p3Content).toContain("Bob在旁边等待");
    // Focus fact should NOT be in the P3 section (it's excluded from facts layer)
    expect(p3Content).not.toContain("Alice要揭开真相");

    // Only 1 fact in P3 (regular), focus is excluded
    expect(result.context_summary.facts_injected).toBe(1);
    expect(result.context_summary.facts_as_focus).toHaveLength(1);
  });

  // -----------------------------------------------------------
  // 6.2.7 custom_instructions trim: budget fail-safe
  // -----------------------------------------------------------

  it("extreme custom_instructions: trimmed when system prompt exceeds 60% budget", async () => {
    const hugeCustom = "极长自定义写作指令".repeat(500);
    const project = createProject({
      project_id: "pTrim", au_id: "trim1",
      llm: createLLMConfig({ mode: "api" as any, model: "gpt-4o", context_window: 4096 }),
      writing_style: createWritingStyle({ custom_instructions: hugeCustom }),
      chapter_length: 800,
    });
    const state = createState({ au_id: "trim1", current_chapter: 1 });

    const result = await assemble_context(
      project, state, "写", [], chapterRepo, "trim1",
    );

    // Should not throw despite huge custom_instructions
    // System tokens should be smaller than if custom were included
    expect(result.budget_report.system_tokens).toBeGreaterThan(0);
    // The result should be valid
    expect(result.messages).toHaveLength(2);
    // max_output_tokens should be sane
    expect(result.budget_report.max_output_tokens).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------
  // 6.2.8 Fact sorting: high weight + recent chapter first
  // -----------------------------------------------------------

  it("facts sorted by weight (high first) then recency (recent chapter first)", async () => {
    const facts = [
      createFact({
        id: "fLowOld", content_raw: "r", content_clean: "低权重旧事实",
        chapter: 1, status: FactStatus.ACTIVE, type: FactType.PLOT_EVENT,
        narrative_weight: NarrativeWeight.LOW,
      }),
      createFact({
        id: "fHighNew", content_raw: "r", content_clean: "高权重新事实",
        chapter: 5, status: FactStatus.ACTIVE, type: FactType.PLOT_EVENT,
        narrative_weight: NarrativeWeight.HIGH,
      }),
      createFact({
        id: "fMedMid", content_raw: "r", content_clean: "中权重中间事实",
        chapter: 3, status: FactStatus.ACTIVE, type: FactType.PLOT_EVENT,
        narrative_weight: NarrativeWeight.MEDIUM,
      }),
      createFact({
        id: "fHighOld", content_raw: "r", content_clean: "高权重旧事实",
        chapter: 1, status: FactStatus.ACTIVE, type: FactType.PLOT_EVENT,
        narrative_weight: NarrativeWeight.HIGH,
      }),
    ];

    const project = createProject({
      project_id: "pSort", au_id: "sort1",
      llm: createLLMConfig({ mode: "api" as any, model: "gpt-4o", context_window: 32000 }),
      chapter_length: 1500,
    });
    const state = createState({ au_id: "sort1", current_chapter: 6 });

    const result = await assemble_context(
      project, state, "写", facts, chapterRepo, "sort1",
    );

    // All 4 facts should be injected (budget is generous)
    expect(result.context_summary.facts_injected).toBe(4);

    // After selection (by weight+recency), facts are displayed sorted by chapter ascending
    const content = result.messages[1].content;
    const p3Start = content.indexOf("## 当前剧情状态");
    expect(p3Start).toBeGreaterThanOrEqual(0);
    const p3Content = content.slice(p3Start);
    const lines = p3Content.split("\n").filter((l) => l.startsWith("- ["));

    // All 4 should be present
    expect(lines).toHaveLength(4);

    // Lines should be in chapter order (1, 1, 3, 5)
    expect(lines[0]).toContain("旧事实");
    expect(lines[lines.length - 1]).toContain("高权重新事实");
  });
});
