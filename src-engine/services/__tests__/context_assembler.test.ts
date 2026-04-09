// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import {
  build_system_prompt,
  build_instruction,
  build_facts_layer,
  build_core_settings_layer,
  assemble_context,
} from "../context_assembler.js";
import { createProject } from "../../domain/project.js";
import { createState } from "../../domain/state.js";
import { createFact } from "../../domain/fact.js";
import { FactStatus, NarrativeWeight } from "../../domain/enums.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";

describe("build_system_prompt", () => {
  it("includes SYSTEM_NOVELIST", () => {
    const project = createProject({ project_id: "p1", au_id: "au1" });
    const result = build_system_prompt(project, false, "zh");
    expect(result).toContain("你是一位专业的小说作者");
  });

  it("includes pinned_context", () => {
    const project = createProject({ project_id: "p1", au_id: "au1", pinned_context: ["永远不要让Alice哭泣"] });
    const result = build_system_prompt(project, false, "zh");
    expect(result).toContain("永远不要让Alice哭泣");
  });

  it("trim_custom removes custom_instructions", () => {
    const project = createProject({
      project_id: "p1", au_id: "au1",
      writing_style: { perspective: "third_person" as any, pov_character: "", emotion_style: "implicit" as any, custom_instructions: "写得更诗意" },
    });
    const withCustom = build_system_prompt(project, false, "zh");
    const withoutCustom = build_system_prompt(project, true, "zh");
    expect(withCustom).toContain("写得更诗意");
    expect(withoutCustom).not.toContain("写得更诗意");
  });

  it("first_person includes pov character", () => {
    const project = createProject({
      project_id: "p1", au_id: "au1",
      writing_style: { perspective: "first_person" as any, pov_character: "Alice", emotion_style: "implicit" as any, custom_instructions: "" },
    });
    const result = build_system_prompt(project, false, "zh");
    expect(result).toContain("Alice");
    expect(result).toContain("第一人称");
  });

  it("chapter_length_max is 1.3x", () => {
    const project = createProject({ project_id: "p1", au_id: "au1", chapter_length: 2000 });
    const result = build_system_prompt(project, false, "zh");
    expect(result).toContain("2000");
    expect(result).toContain("2600"); // 2000 * 1.3
  });
});

describe("build_instruction", () => {
  it("includes current chapter", () => {
    const state = createState({ au_id: "au1", current_chapter: 5 });
    const result = build_instruction(state, "继续写", [], "zh");
    expect(result).toContain("第5章");
  });

  it("includes focus goal when chapter_focus set", () => {
    const state = createState({ au_id: "au1", chapter_focus: ["f1"] });
    const facts = [
      createFact({ id: "f1", content_raw: "r", content_clean: "A and B are getting closer", status: FactStatus.UNRESOLVED }),
    ];
    const result = build_instruction(state, "写", facts, "zh");
    expect(result).toContain("A and B are getting closer");
    expect(result).toContain("核心推进目标");
  });

  it("includes pacing instruction when unresolved facts but no focus", () => {
    const state = createState({ au_id: "au1" });
    const facts = [
      createFact({ id: "f1", content_raw: "r", content_clean: "c", status: FactStatus.UNRESOLVED }),
    ];
    const result = build_instruction(state, "写", facts, "zh");
    expect(result).toContain("叙事节奏");
  });
});

describe("build_facts_layer", () => {
  it("returns empty for no eligible facts", () => {
    const [text, degraded] = build_facts_layer([], [], 1000, null, "zh");
    expect(text).toBe("");
    expect(degraded).toBe(false);
  });

  it("includes active and unresolved facts", () => {
    const facts = [
      createFact({ id: "f1", content_raw: "r", content_clean: "active fact", status: FactStatus.ACTIVE, chapter: 1 }),
      createFact({ id: "f2", content_raw: "r", content_clean: "unresolved fact", status: FactStatus.UNRESOLVED, chapter: 2 }),
    ];
    const [text] = build_facts_layer(facts, [], 10000, null, "zh");
    expect(text).toContain("[active] active fact");
    expect(text).toContain("[unresolved] unresolved fact");
  });

  it("soft degrades when over budget", () => {
    const facts = Array.from({ length: 20 }, (_, i) =>
      createFact({
        id: `f${i}`, content_raw: "r",
        content_clean: "很长的事实内容".repeat(10),
        status: FactStatus.UNRESOLVED,
        narrative_weight: NarrativeWeight.MEDIUM,
        chapter: i,
      }),
    );
    const [text, degraded] = build_facts_layer(facts, [], 100, null, "zh");
    expect(degraded).toBe(true);
    expect(text).toContain("未解决伏笔暂未展示");
  });

  it("sorts by weight and recency", () => {
    const facts = [
      createFact({ id: "f1", content_raw: "r", content_clean: "low ch1", status: FactStatus.ACTIVE, narrative_weight: NarrativeWeight.LOW, chapter: 1 }),
      createFact({ id: "f2", content_raw: "r", content_clean: "high ch2", status: FactStatus.ACTIVE, narrative_weight: NarrativeWeight.HIGH, chapter: 2 }),
    ];
    const [text] = build_facts_layer(facts, [], 10000, null, "zh");
    // high weight should appear, and facts sorted by chapter in final output
    expect(text).toContain("high ch2");
  });
});

describe("build_core_settings_layer", () => {
  it("injects core_always_include first (guarantee budget)", () => {
    const project = createProject({
      project_id: "p1", au_id: "au1",
      core_always_include: ["Alice"],
      core_guarantee_budget: 400,
    });
    const charFiles = {
      Alice: "# Alice\nShe is the protagonist.",
      Bob: "# Bob\nHe is a friend.",
    };
    const [text, injected, truncated] = build_core_settings_layer(project, charFiles, 50, null, "zh");
    // With only 50 tokens budget but 400 guarantee, Alice should still be injected
    expect(injected).toContain("Alice");
  });

  it("returns empty when no files", () => {
    const project = createProject({ project_id: "p1", au_id: "au1" });
    const [text] = build_core_settings_layer(project, null, 1000, null, "zh");
    expect(text).toBe("");
  });
});

describe("assemble_context", () => {
  it("empty AU first chapter", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    const project = createProject({ project_id: "p1", au_id: "au1" });
    const state = createState({ au_id: "au1", current_chapter: 1 });

    const result = await assemble_context(
      project, state, "开始写第一章", [],
      chapterRepo, "au1",
    );

    expect(result.messages).toHaveLength(2);
    expect(result.messages[0].role).toBe("system");
    expect(result.messages[1].role).toBe("user");
    expect(result.budget_report.context_window).toBeGreaterThan(0);
    expect(result.context_summary.pinned_count).toBe(0);
  });

  it("throws on budget exceeded", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    // Very long pinned_context with tiny context window
    const project = createProject({
      project_id: "p1", au_id: "au1",
      pinned_context: Array.from({ length: 100 }, (_, i) => `铁律${i}：` + "很长的规则描述".repeat(50)),
      llm: { mode: "api" as any, model: "", api_base: "", api_key: "", local_model_path: "", ollama_model: "", context_window: 100 },
    });
    const state = createState({ au_id: "au1" });

    await expect(
      assemble_context(project, state, "写", [], chapterRepo, "au1"),
    ).rejects.toThrow("system_prompt_exceeds_budget");
  });

  it("budget_report tracks all layers", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    const project = createProject({ project_id: "p1", au_id: "au1" });
    const state = createState({ au_id: "au1", current_chapter: 1 });
    const facts = [
      createFact({ id: "f1", content_raw: "r", content_clean: "active fact", status: FactStatus.ACTIVE }),
    ];

    const result = await assemble_context(
      project, state, "继续", facts,
      chapterRepo, "au1",
    );

    expect(result.budget_report.system_tokens).toBeGreaterThan(0);
    expect(result.budget_report.p1_tokens).toBeGreaterThan(0);
    expect(result.budget_report.max_output_tokens).toBeGreaterThan(0);
  });
});
