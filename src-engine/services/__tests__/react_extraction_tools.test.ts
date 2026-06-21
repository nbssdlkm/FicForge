// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * M9 提取工具 schema + ToolDefinition 派生测试。
 */

import { describe, expect, it } from "vitest";
import {
  EXTRACTION_TOOLS,
  EXTRACTION_TOOL_SCHEMAS,
  REACT_TOOL_SEARCH,
  REACT_TOOL_PROPOSE,
  REACT_TOOL_ANNOTATE,
  REACT_TOOL_FINALIZE,
} from "../react_extraction_tools.js";
import { repairAndValidateToolArgs } from "../tool_args_repair.js";

const validate = (tool: string, raw: string) =>
  repairAndValidateToolArgs(tool, raw, EXTRACTION_TOOL_SCHEMAS[tool], {});

describe("EXTRACTION_TOOLS 派生（z.toJSONSchema 单一真相源）", () => {
  it("四个工具都有 ToolDefinition，名字对得上 schema 表", () => {
    const names = EXTRACTION_TOOLS.map((t) => t.function.name).sort();
    expect(names).toEqual([REACT_TOOL_ANNOTATE, REACT_TOOL_FINALIZE, REACT_TOOL_PROPOSE, REACT_TOOL_SEARCH].sort());
    for (const t of EXTRACTION_TOOLS) {
      expect(t.type).toBe("function");
      expect(t.function.description.length).toBeGreaterThan(0);
      expect(t.function.parameters).toHaveProperty("type", "object");
    }
  });

  it("ToolDefinition.parameters 不带 $schema 顶层键（OpenAI 不需要）", () => {
    for (const t of EXTRACTION_TOOLS) {
      expect(t.function.parameters).not.toHaveProperty("$schema");
    }
  });

  it("propose_facts 的 facts.items 暴露 evidence + 富化字段给 LLM", () => {
    const propose = EXTRACTION_TOOLS.find((t) => t.function.name === REACT_TOOL_PROPOSE)!;
    const params = propose.function.parameters as Record<string, unknown>;
    const facts = (params.properties as Record<string, { items?: Record<string, unknown> }>).facts;
    const itemProps = (facts.items?.properties ?? {}) as Record<string, unknown>;
    expect(itemProps).toHaveProperty("evidence");
    expect(itemProps).toHaveProperty("content_clean");
    expect(itemProps).toHaveProperty("time_kind");
    expect(itemProps).toHaveProperty("known_to");
  });
});

describe("search_existing_facts schema", () => {
  it("拒绝空 query", () => {
    expect(validate(REACT_TOOL_SEARCH, JSON.stringify({ query: "" })).success).toBe(false);
  });
  it("接受 query + 可选 characters/limit", () => {
    const r = validate(REACT_TOOL_SEARCH, JSON.stringify({ query: "灵力", characters: ["林晚月"], limit: 5 }));
    expect(r.success).toBe(true);
  });
  it("limit 是可选的（不传也过；不被 toJSONSchema default 逼成 required）", () => {
    expect(validate(REACT_TOOL_SEARCH, JSON.stringify({ query: "x" })).success).toBe(true);
  });
});

describe("propose_facts schema", () => {
  it("拒绝空 facts 数组", () => {
    expect(validate(REACT_TOOL_PROPOSE, JSON.stringify({ facts: [] })).success).toBe(false);
  });
  it("接受 content_clean(>=1) + characters，富化字段可省略", () => {
    const r = validate(REACT_TOOL_PROPOSE, JSON.stringify({ facts: [{ content_clean: "某事件", characters: [] }] }));
    expect(r.success).toBe(true);
  });
  it("接受带 evidence + 富化字段的完整事实", () => {
    const r = validate(REACT_TOOL_PROPOSE, JSON.stringify({
      facts: [{ content_clean: "林晚月灵力枯竭", characters: ["林晚月"], evidence: "她灵力枯竭", time_kind: "flashback", known_to: "reader_only", fact_type: "plot_event" }],
    }));
    expect(r.success).toBe(true);
  });
  it("repair: characters 传成 JSON 字符串数组也能修复", () => {
    const r = validate(REACT_TOOL_PROPOSE, JSON.stringify({ facts: [{ content_clean: "事件", characters: '["a","b"]' }] }));
    expect(r.success).toBe(true);
  });
});

describe("annotate_fact schema", () => {
  it("要求 fact_index 整数", () => {
    expect(validate(REACT_TOOL_ANNOTATE, JSON.stringify({ caused_by_fact_ids: ["f_1_aaaa"] })).success).toBe(false);
  });
  it("接受 fact_index + 可选 caused_by/thread_ids", () => {
    expect(validate(REACT_TOOL_ANNOTATE, JSON.stringify({ fact_index: 0, caused_by_fact_ids: ["f_1_aaaa"], thread_ids: ["t1"] })).success).toBe(true);
    expect(validate(REACT_TOOL_ANNOTATE, JSON.stringify({ fact_index: 2 })).success).toBe(true);
  });
});

describe("finalize_extraction schema", () => {
  it("接受空对象", () => {
    expect(validate(REACT_TOOL_FINALIZE, JSON.stringify({})).success).toBe(true);
  });
});
