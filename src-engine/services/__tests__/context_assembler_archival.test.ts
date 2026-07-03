// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * TDD tests for context_assembler archival filter (Phase B cold-tier injection).
 */

import { describe, expect, it } from "vitest";
import { build_facts_layer, build_instruction } from "../context_assembler.js";
import { createFact } from "../../domain/fact.js";
import { createState } from "../../domain/state.js";
import { FactStatus, NarrativeWeight } from "../../domain/enums.js";

describe("context_assembler archival filter", () => {
  it("archived=true fact is excluded from P3", () => {
    const facts = [
      createFact({
        id: "f1",
        content_raw: "r",
        content_clean: "cold archived fact",
        status: FactStatus.ACTIVE,
        archived: true,
      }),
      createFact({
        id: "f2",
        content_raw: "r",
        content_clean: "warm active fact",
        status: FactStatus.ACTIVE,
        archived: false,
      }),
    ];

    const [text] = build_facts_layer(facts, [], 10000, null, "zh");

    expect(text).not.toContain("cold archived fact");
    expect(text).toContain("warm active fact");
  });

  it("archived=false fact is included in P3", () => {
    const facts = [
      createFact({
        id: "f1",
        content_raw: "r",
        content_clean: "active fact",
        status: FactStatus.ACTIVE,
        archived: false,
      }),
    ];

    const [text] = build_facts_layer(facts, [], 10000, null, "zh");

    expect(text).toContain("active fact");
  });

  it("fact without archived field (undefined) treated as active (backward compat)", () => {
    // Old facts have no 'archived' field — must not be filtered out
    const fact = createFact({
      id: "f1",
      content_raw: "r",
      content_clean: "old fact no archived field",
      status: FactStatus.ACTIVE,
    });
    // Simulate old fact: remove archived field entirely
    delete (fact as unknown as Record<string, unknown>).archived;

    const [text] = build_facts_layer([fact], [], 10000, null, "zh");

    expect(text).toContain("old fact no archived field");
  });

  it("archived unresolved fact is excluded from P3", () => {
    const facts = [
      createFact({
        id: "f1",
        content_raw: "r",
        content_clean: "archived unresolved",
        status: FactStatus.UNRESOLVED,
        archived: true,
      }),
    ];

    const [text] = build_facts_layer(facts, [], 10000, null, "zh");

    expect(text).not.toContain("archived unresolved");
    expect(text).toBe("");
  });

  it("returns correct facts_archived_count in context_summary (via build_facts_layer result)", () => {
    // build_facts_layer itself doesn't return ContextSummary, so we test the filter side-effect:
    // 2 archived + 1 active => only 1 appears in P3
    const facts = [
      createFact({
        id: "f1", content_raw: "r", content_clean: "archived1",
        status: FactStatus.ACTIVE, archived: true,
      }),
      createFact({
        id: "f2", content_raw: "r", content_clean: "archived2",
        status: FactStatus.ACTIVE, archived: true,
      }),
      createFact({
        id: "f3", content_raw: "r", content_clean: "active1",
        status: FactStatus.ACTIVE, archived: false,
      }),
    ];

    const [text] = build_facts_layer(facts, [], 10000, null, "zh");

    expect(text).toContain("active1");
    expect(text).not.toContain("archived1");
    expect(text).not.toContain("archived2");
  });
});

describe("build_instruction archival filter（审计⑥：冷 fact 不进 FOCUS_GOAL / 本章特别注意）", () => {
  it("已归档 fact 即便仍挂在 chapter_focus 里，也不作为 FOCUS_GOAL 注入", () => {
    const cold = createFact({
      id: "fc", content_raw: "r", content_clean: "冷藏的伏笔线",
      status: FactStatus.UNRESOLVED, narrative_weight: NarrativeWeight.LOW, archived: true,
    });
    const warm = createFact({
      id: "fw", content_raw: "r", content_clean: "热的推进目标",
      status: FactStatus.UNRESOLVED, narrative_weight: NarrativeWeight.HIGH, archived: false,
    });
    const state = createState({ au_id: "au1" });
    state.current_chapter = 5;
    state.chapter_focus = ["fc", "fw"]; // archive_fact 不清 focus → 冷 fact 可能残留在此

    const text = build_instruction(state, "继续", [cold, warm], "zh");

    expect(text).toContain("热的推进目标");
    expect(text).not.toContain("冷藏的伏笔线");
  });

  it("已归档的高权重 unresolved fact 不进「本章特别注意」", () => {
    const focusFact = createFact({
      id: "ff", content_raw: "r", content_clean: "焦点目标",
      status: FactStatus.UNRESOLVED, narrative_weight: NarrativeWeight.HIGH, archived: false,
    });
    const coldHigh = createFact({
      id: "fc", content_raw: "r", content_clean: "冷藏高权重悬念",
      status: FactStatus.UNRESOLVED, narrative_weight: NarrativeWeight.HIGH, archived: true,
    });
    const state = createState({ au_id: "au1" });
    state.current_chapter = 5;
    state.chapter_focus = ["ff"]; // 有一个热焦点 → 进入 focus 分支（含「本章特别注意」子块）

    const text = build_instruction(state, "继续", [focusFact, coldHigh], "zh");

    expect(text).toContain("焦点目标");
    expect(text).not.toContain("冷藏高权重悬念");
  });
});

describe("ContextSummary facts_archived_count", () => {
  it("createContextSummary has facts_archived_count defaulting to 0", async () => {
    const { createContextSummary } = await import("../../domain/context_summary.js");
    const cs = createContextSummary();
    expect(cs.facts_archived_count).toBe(0);
  });

  it("createContextSummary accepts facts_archived_count partial", async () => {
    const { createContextSummary } = await import("../../domain/context_summary.js");
    const cs = createContextSummary({ facts_archived_count: 5 });
    expect(cs.facts_archived_count).toBe(5);
  });
});
