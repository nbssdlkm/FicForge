// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * M8-A Fact Enrichment — TDD tests (T4, T5, T6, T7, T8 partial).
 * T4: rawToExtracted enum validation
 * T5: extract_facts_from_chapter with new fields
 * T6: build_facts_layer enrichment injection (buildFactEnrichmentSuffix)
 * T7: FACTS_ENRICH_SYSTEM_PROMPT in prompt keys
 * T8: round-trip via ops (hop 3+4+5)
 *
 * Written BEFORE implementation (TDD red phase).
 */

import { describe, expect, it } from "vitest";
import { rawToExtracted } from "../facts_extraction.js";
import { extract_facts_from_chapter } from "../facts_extraction.js";
import { build_facts_layer, buildFactEnrichmentSuffix } from "../context_assembler.js";
import { createFact } from "../../domain/fact.js";
import { FactStatus } from "../../domain/enums.js";
import { getPrompts, REQUIRED_KEYS } from "../../prompts/index.js";
import type { LLMProvider, LLMResponse, LLMChunk, GenerateParams } from "../../llm/provider.js";

// ===========================================================================
// T4: rawToExtracted enum validation
// ===========================================================================

describe("T4: rawToExtracted — M8-A field validation", () => {
  it("valid time_kind 'flashback' → preserved", () => {
    const result = rawToExtracted(
      { content_clean: "Alice flashedback", time_kind: "flashback" },
      1, null,
    );
    expect(result).not.toBeNull();
    expect(result!.time_kind).toBe("flashback");
  });

  it("time_kind 'FLASHBACK' (wrong case) → null", () => {
    const result = rawToExtracted(
      { content_clean: "test content here", time_kind: "FLASHBACK" },
      1, null,
    );
    expect(result).not.toBeNull();
    expect(result!.time_kind).toBeNull();
  });

  it("time_kind 'fantasy' (invalid value) → null", () => {
    const result = rawToExtracted(
      { content_clean: "test content here", time_kind: "fantasy" },
      1, null,
    );
    expect(result).not.toBeNull();
    expect(result!.time_kind).toBeNull();
  });

  it("all 6 valid time_kind values are accepted", () => {
    for (const v of ["normal", "flashback", "insert", "dream", "parallel", "imagined"]) {
      const result = rawToExtracted(
        { content_clean: "test content here", time_kind: v },
        1, null,
      );
      expect(result).not.toBeNull();
      expect(result!.time_kind).toBe(v);
    }
  });

  it("suspense_type 'secret' → preserved", () => {
    const result = rawToExtracted(
      { content_clean: "test content here", suspense_type: "secret" },
      1, null,
    );
    expect(result).not.toBeNull();
    expect(result!.suspense_type).toBe("secret");
  });

  it("suspense_type 'bomb' (invalid) → null", () => {
    const result = rawToExtracted(
      { content_clean: "test content here", suspense_type: "bomb" },
      1, null,
    );
    expect(result).not.toBeNull();
    expect(result!.suspense_type).toBeNull();
  });

  it("story_time_order as string → null (type guard)", () => {
    const result = rawToExtracted(
      { content_clean: "test content here", story_time_order: "1" },
      1, null,
    );
    expect(result).not.toBeNull();
    expect(result!.story_time_order).toBeNull();
  });

  it("story_time_order as number → preserved", () => {
    const result = rawToExtracted(
      { content_clean: "test content here", story_time_order: 3 },
      1, null,
    );
    expect(result).not.toBeNull();
    expect(result!.story_time_order).toBe(3);
  });

  it("known_to as number (42) → null", () => {
    const result = rawToExtracted(
      { content_clean: "test content here", known_to: 42 },
      1, null,
    );
    expect(result).not.toBeNull();
    expect(result!.known_to).toBeNull();
  });

  it("known_to 'reader_only' → preserved", () => {
    const result = rawToExtracted(
      { content_clean: "test content here", known_to: "reader_only" },
      1, null,
    );
    expect(result).not.toBeNull();
    expect(result!.known_to).toBe("reader_only");
  });

  it("known_to 'all' → preserved", () => {
    const result = rawToExtracted(
      { content_clean: "test content here", known_to: "all" },
      1, null,
    );
    expect(result).not.toBeNull();
    expect(result!.known_to).toBe("all");
  });

  it("known_to as string array → preserved (with type filter)", () => {
    const result = rawToExtracted(
      { content_clean: "test content here", known_to: ["Alice", "Bob"] },
      1, null,
    );
    expect(result).not.toBeNull();
    expect(result!.known_to).toEqual(["Alice", "Bob"]);
  });

  it("known_to array with number elements → filters them out", () => {
    const result = rawToExtracted(
      { content_clean: "test content here", known_to: [1, 2, "Alice"] as unknown[] },
      1, null,
    );
    expect(result).not.toBeNull();
    // Numbers should be filtered, only "Alice" remains
    expect(result!.known_to).toEqual(["Alice"]);
  });

  it("caused_by as string (not array) → []", () => {
    const result = rawToExtracted(
      { content_clean: "test content here", caused_by: "f_123" },
      1, null,
    );
    expect(result).not.toBeNull();
    expect(result!.caused_by).toEqual([]);
  });

  it("_confidence is passed through when valid", () => {
    const confidence = { location: "high" as const, known_to: "low" as const };
    const result = rawToExtracted(
      { content_clean: "test content here", _confidence: confidence },
      1, null,
    );
    expect(result).not.toBeNull();
    expect(result!._confidence).toEqual(confidence);
  });

  it("invalid time_kind does not affect other fields", () => {
    const result = rawToExtracted(
      {
        content_clean: "test content here",
        time_kind: "fantasy",
        location: "御书房",
        action_verb: "决裂",
      },
      1, null,
    );
    expect(result).not.toBeNull();
    expect(result!.time_kind).toBeNull();
    expect(result!.location).toBe("御书房");
    expect(result!.action_verb).toBe("决裂");
  });
});

// ===========================================================================
// T5: extract_facts_from_chapter with new fields
// ===========================================================================

describe("T5: extract_facts_from_chapter — M8-A new fields", () => {
  const enrichedProvider: LLMProvider = {
    async generate(_params: GenerateParams): Promise<LLMResponse> {
      return {
        content: JSON.stringify([
          {
            content_raw: "第1章 皇帝暗中赐毒",
            content_clean: "皇帝暗中赐毒",
            characters: ["皇帝"],
            type: "plot_event",
            status: "active",
            narrative_weight: "high",
            location: "御书房",
            story_time_tag: "Y1 冬末",
            story_time_order: 2,
            time_kind: "normal",
            action_verb: "赐毒",
            caused_by: [],
            known_to: "reader_only",
            hidden_from: ["皇后"],
            suspense_type: "secret",
            _confidence: {
              location: "high",
              known_to: "high",
              time_kind: "medium",
              action_verb: "high",
              suspense_type: "high",
            },
          },
        ]),
        model: "test",
        input_tokens: 100,
        output_tokens: 80,
        finish_reason: "stop",
      };
    },
    async *generateStream(): AsyncIterable<LLMChunk> {},
  };

  it("new fields are correctly parsed from LLM response", async () => {
    const results = await extract_facts_from_chapter(
      "皇帝在御书房暗中密谋，赐毒于使者。",
      1, [], { characters: ["皇帝", "皇后"] }, null,
      enrichedProvider, null,
    );
    expect(results).toHaveLength(1);
    const f = results[0];
    expect(f.location).toBe("御书房");
    expect(f.story_time_tag).toBe("Y1 冬末");
    expect(f.story_time_order).toBe(2);
    expect(f.time_kind).toBe("normal");
    expect(f.action_verb).toBe("赐毒");
    expect(f.caused_by).toEqual([]);
    expect(f.known_to).toBe("reader_only");
    expect(f.hidden_from).toEqual(["皇后"]);
    expect(f.suspense_type).toBe("secret");
    expect(f._confidence).toEqual({
      location: "high",
      known_to: "high",
      time_kind: "medium",
      action_verb: "high",
      suspense_type: "high",
    });
  });

  it("invalid time_kind from LLM → null, other fields unaffected", async () => {
    const badProvider: LLMProvider = {
      async generate(): Promise<LLMResponse> {
        return {
          content: JSON.stringify([{
            content_raw: "第1章 test",
            content_clean: "test event here",
            type: "plot_event",
            status: "active",
            time_kind: "fantasy",  // invalid
            location: "somewhere",
          }]),
          model: "test", input_tokens: 0, output_tokens: 0, finish_reason: "stop",
        };
      },
      async *generateStream(): AsyncIterable<LLMChunk> {},
    };

    const results = await extract_facts_from_chapter(
      "Chapter content here.", 1, [], { characters: [] }, null, badProvider, null,
    );
    expect(results).toHaveLength(1);
    expect(results[0].time_kind).toBeNull();
    expect(results[0].location).toBe("somewhere");
  });

  it("LLM returns no new fields → existing fields still extracted", async () => {
    const plainProvider: LLMProvider = {
      async generate(): Promise<LLMResponse> {
        return {
          content: JSON.stringify([{
            content_raw: "第1章 Alice遇到Bob",
            content_clean: "Alice遇到Bob",
            characters: ["Alice"],
            type: "plot_event",
            status: "active",
            narrative_weight: "medium",
          }]),
          model: "test", input_tokens: 0, output_tokens: 0, finish_reason: "stop",
        };
      },
      async *generateStream(): AsyncIterable<LLMChunk> {},
    };

    const results = await extract_facts_from_chapter(
      "Alice遇到了Bob。", 1, [], { characters: ["Alice", "Bob"] }, null, plainProvider, null,
    );
    expect(results).toHaveLength(1);
    expect(results[0].content_clean).toBe("Alice遇到Bob");
    // New fields should be null/empty, not throw
    const f = results[0];
    expect(f.location == null).toBe(true);
    expect(f.time_kind == null).toBe(true);
  });
});

// ===========================================================================
// T6: build_facts_layer enrichment injection
// ===========================================================================

describe("T6: build_facts_layer — M8-A enrichment suffix injection", () => {
  it("known_to 'reader_only' with high confidence → injected in output", () => {
    const fact = createFact({
      id: "f1", content_raw: "r", content_clean: "皇帝暗中赐毒",
      status: FactStatus.ACTIVE, chapter: 1,
      known_to: "reader_only" as "reader_only",
      _confidence: { known_to: "high" },
    });
    const [text] = build_facts_layer([fact], [], 10000, null, "zh");
    expect(text).toContain("known_to: reader_only");
  });

  it("B1: caused_by 渲染为「起因：<被引用事实内容>」（跨章因果进 prompt）", () => {
    const cause = createFact({
      id: "f_cause", content_raw: "r", content_clean: "沈砚发现父亲笔迹残页",
      status: FactStatus.ACTIVE, chapter: 1,
    });
    const effect = createFact({
      id: "f_effect", content_raw: "r", content_clean: "沈砚决意面圣翻案",
      status: FactStatus.ACTIVE, chapter: 3, caused_by: ["f_cause"],
    });
    const [text] = build_facts_layer([cause, effect], [], 10000, null, "zh");
    // 旧代码明确不注入 caused_by；新代码解析 fact_id → 起因短句
    expect(text).toContain("起因：沈砚发现父亲笔迹残页");
  });

  it("B1: caused_by 指向不存在的 id → 跳过，绝不渲染裸 id", () => {
    const f = createFact({
      id: "f1", content_raw: "r", content_clean: "某个事件",
      status: FactStatus.ACTIVE, chapter: 2, caused_by: ["f_nonexistent"],
    });
    const [text] = build_facts_layer([f], [], 10000, null, "zh");
    expect(text).not.toContain("起因");
    expect(text).not.toContain("f_nonexistent");
  });

  it("known_to 'all' with low confidence → NOT injected", () => {
    const fact = createFact({
      id: "f1", content_raw: "r", content_clean: "普通事件",
      status: FactStatus.ACTIVE, chapter: 1,
      known_to: "all" as "all",
      _confidence: { known_to: "low" },
    });
    const [text] = build_facts_layer([fact], [], 10000, null, "zh");
    // known_to: all is default, low confidence → not injected
    expect(text).not.toContain("known_to:");
  });

  it("no _confidence → no new fields injected", () => {
    const fact = createFact({
      id: "f1", content_raw: "r", content_clean: "普通事件",
      status: FactStatus.ACTIVE, chapter: 1,
      known_to: "reader_only" as "reader_only",
      time_kind: "flashback" as any,
      action_verb: "决裂",
      // No _confidence
    });
    const [text] = build_facts_layer([fact], [], 10000, null, "zh");
    expect(text).not.toContain("known_to:");
    expect(text).not.toContain("time_kind:");
    expect(text).not.toContain("action_verb:");
  });

  it("time_kind 'flashback' with medium confidence → injected", () => {
    const fact = createFact({
      id: "f1", content_raw: "r", content_clean: "闪回内容",
      status: FactStatus.ACTIVE, chapter: 1,
      time_kind: "flashback" as any,
      _confidence: { time_kind: "medium" },
    });
    const [text] = build_facts_layer([fact], [], 10000, null, "zh");
    expect(text).toContain("time_kind: flashback");
  });

  it("time_kind 'normal' → NOT injected (no information value)", () => {
    const fact = createFact({
      id: "f1", content_raw: "r", content_clean: "普通叙事",
      status: FactStatus.ACTIVE, chapter: 1,
      time_kind: "normal" as any,
      _confidence: { time_kind: "high" },
    });
    const [text] = build_facts_layer([fact], [], 10000, null, "zh");
    expect(text).not.toContain("time_kind:");
  });

  it("action_verb with high confidence → injected", () => {
    const fact = createFact({
      id: "f1", content_raw: "r", content_clean: "皇帝决裂",
      status: FactStatus.ACTIVE, chapter: 1,
      action_verb: "决裂",
      _confidence: { action_verb: "high" },
    });
    const [text] = build_facts_layer([fact], [], 10000, null, "zh");
    expect(text).toContain("action_verb: 决裂");
  });

  it("location with medium confidence → injected", () => {
    const fact = createFact({
      id: "f1", content_raw: "r", content_clean: "在御书房密谋",
      status: FactStatus.ACTIVE, chapter: 1,
      location: "御书房",
      _confidence: { location: "medium" },
    });
    const [text] = build_facts_layer([fact], [], 10000, null, "zh");
    expect(text).toContain("location: 御书房");
  });

  it("suspense_type with medium confidence → injected", () => {
    const fact = createFact({
      id: "f1", content_raw: "r", content_clean: "预示结局",
      status: FactStatus.ACTIVE, chapter: 1,
      suspense_type: "foreshadow" as any,
      _confidence: { suspense_type: "medium" },
    });
    const [text] = build_facts_layer([fact], [], 10000, null, "zh");
    expect(text).toContain("suspense_type: foreshadow");
  });
});

describe("T6: buildFactEnrichmentSuffix — pure function (M8-A)", () => {
  it("returns empty string when no _confidence", () => {
    const fact = createFact({
      id: "f1", content_raw: "r", content_clean: "c",
      known_to: "reader_only" as "reader_only",
      time_kind: "flashback" as any,
    });
    const suffix = buildFactEnrichmentSuffix(fact);
    expect(suffix).toBe("");
  });

  it("returns parenthesized suffix with high-confidence fields", () => {
    const fact = createFact({
      id: "f1", content_raw: "r", content_clean: "c",
      known_to: "reader_only" as "reader_only",
      time_kind: "flashback" as any,
      action_verb: "决裂",
      _confidence: { known_to: "high", time_kind: "medium", action_verb: "high" },
    });
    const suffix = buildFactEnrichmentSuffix(fact);
    expect(suffix).toContain("known_to: reader_only");
    expect(suffix).toContain("time_kind: flashback");
    expect(suffix).toContain("action_verb: 决裂");
    // Should be parenthesized
    expect(suffix.startsWith(" (")).toBe(true);
    expect(suffix.endsWith(")")).toBe(true);
  });

  it("low confidence fields are NOT included in suffix", () => {
    const fact = createFact({
      id: "f1", content_raw: "r", content_clean: "c",
      known_to: "reader_only" as "reader_only",
      location: "某地",
      _confidence: { known_to: "high", location: "low" },
    });
    const suffix = buildFactEnrichmentSuffix(fact);
    expect(suffix).toContain("known_to: reader_only");
    expect(suffix).not.toContain("location:");
  });

  it("time_kind 'normal' is NOT included even if high confidence", () => {
    const fact = createFact({
      id: "f1", content_raw: "r", content_clean: "c",
      time_kind: "normal" as any,
      _confidence: { time_kind: "high" },
    });
    const suffix = buildFactEnrichmentSuffix(fact);
    expect(suffix).not.toContain("time_kind:");
  });
});

// ===========================================================================
// T7: FACTS_ENRICH_SYSTEM_PROMPT in prompt keys
// ===========================================================================

describe("T7: FACTS_ENRICH_SYSTEM_PROMPT prompt key (M8-A)", () => {
  it("FACTS_ENRICH_SYSTEM_PROMPT is in REQUIRED_KEYS", () => {
    expect(REQUIRED_KEYS).toContain("FACTS_ENRICH_SYSTEM_PROMPT");
  });

  it("total key count is 67 (M8-A +1 + M10-A +4 + M8-B +1)", () => {
    expect(REQUIRED_KEYS.length).toBe(67);
  });

  it("zh module has FACTS_ENRICH_SYSTEM_PROMPT and it is non-empty", () => {
    const zh = getPrompts("zh");
    expect(zh.FACTS_ENRICH_SYSTEM_PROMPT).toBeDefined();
    expect(zh.FACTS_ENRICH_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("en module has FACTS_ENRICH_SYSTEM_PROMPT and it is non-empty", () => {
    const en = getPrompts("en");
    expect(en.FACTS_ENRICH_SYSTEM_PROMPT).toBeDefined();
    expect(en.FACTS_ENRICH_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// T8: round-trip via ops (hop 3+4+5)
// ===========================================================================

describe("T8: ops round-trip with new enrichment fields (M8-A)", () => {
  it("add_fact op with new fields → rebuildFactsFromOps preserves them", async () => {
    const { rebuildFactsFromOps } = await import("../../ops/ops_projection.js");
    const { createOpsEntry } = await import("../../domain/ops_entry.js");

    const ops = [
      createOpsEntry({
        op_id: "a_enrich_01",
        op_type: "add_fact",
        target_id: "f_enrich_01",
        chapter_num: 1,
        timestamp: "2026-06-20T00:00:00Z",
        payload: {
          content_clean: "皇帝暗中赐毒",
          status: "active",
          fact: {
            id: "f_enrich_01",
            content_raw: "第1章 皇帝暗中赐毒",
            content_clean: "皇帝暗中赐毒",
            characters: ["皇帝"],
            chapter: 1,
            status: "active",
            type: "plot_event",
            narrative_weight: "high",
            source: "extract_auto",
            timeline: "现在线",
            story_time: "",
            resolves: null,
            revision: 1,
            created_at: "2026-06-20T00:00:00Z",
            updated_at: "2026-06-20T00:00:00Z",
            // New M8-A fields
            location: "御书房",
            story_time_tag: "Y1 冬末",
            story_time_order: 2,
            time_kind: "normal",
            action_verb: "赐毒",
            caused_by: ["f_000_prev"],
            known_to: "reader_only",
            hidden_from: ["皇后"],
            suspense_type: "secret",
            _confidence: { location: "high", known_to: "high" },
          },
        },
      }),
    ];

    const facts = rebuildFactsFromOps(ops);
    expect(facts).toHaveLength(1);
    const f = facts[0];
    expect(f.location).toBe("御书房");
    expect(f.story_time_tag).toBe("Y1 冬末");
    expect(f.story_time_order).toBe(2);
    expect(f.time_kind).toBe("normal");
    expect(f.action_verb).toBe("赐毒");
    expect(f.caused_by).toEqual(["f_000_prev"]);
    expect(f.known_to).toBe("reader_only");
    expect(f.hidden_from).toEqual(["皇后"]);
    expect(f.suspense_type).toBe("secret");
    expect(f._confidence).toEqual({ location: "high", known_to: "high" });
  });

  it("edit_fact op with new enrichment field in EDITABLE_FIELDS → updates fact", async () => {
    const { rebuildFactsFromOps } = await import("../../ops/ops_projection.js");
    const { createOpsEntry } = await import("../../domain/ops_entry.js");

    const ops = [
      createOpsEntry({
        op_id: "a1",
        op_type: "add_fact",
        target_id: "f_edit_01",
        chapter_num: 1,
        timestamp: "2026-06-20T00:00:00Z",
        payload: {
          content_clean: "initial",
          status: "active",
          fact: {
            id: "f_edit_01",
            content_raw: "r",
            content_clean: "initial",
            characters: [],
            chapter: 1,
            status: "active",
            type: "plot_event",
            narrative_weight: "medium",
            source: "manual",
            timeline: "",
            story_time: "",
            resolves: null,
            revision: 1,
            created_at: "2026-06-20T00:00:00Z",
            updated_at: "2026-06-20T00:00:00Z",
            location: "初始地点",
            known_to: "all",
            caused_by: [],
            hidden_from: [],
          },
        },
      }),
      createOpsEntry({
        op_id: "e1",
        op_type: "edit_fact",
        target_id: "f_edit_01",
        chapter_num: 1,
        timestamp: "2026-06-20T00:01:00Z",
        payload: {
          updated_fields: {
            location: "御花园",
            known_to: "reader_only",
            action_verb: "密谈",
          },
        },
      }),
    ];

    const facts = rebuildFactsFromOps(ops);
    expect(facts).toHaveLength(1);
    const f = facts[0];
    expect(f.location).toBe("御花园");
    expect(f.known_to).toBe("reader_only");
    expect(f.action_verb).toBe("密谈");
  });
});
