// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 契约测试：验证 tool schema 中的枚举值与 domain enum 定义一致。
 * 防止前后端枚举漂移（P1: importance / fact_type 错位的根因）。
 */

import { describe, expect, it } from "vitest";
import { get_tools_for_mode } from "../settings_tools.js";
import {
  FactType,
  FACT_TYPE_VALUES,
  FactStatus,
  FACT_STATUS_VALUES,
  NarrativeWeight,
  NARRATIVE_WEIGHT_VALUES,
} from "../enums.js";

function getToolSchema(mode: string, toolName: string) {
  const tools = get_tools_for_mode(mode);
  const tool = tools.find(
    (t) => (t as Record<string, unknown>).type === "function"
      && ((t as Record<string, Record<string, unknown>>).function.name === toolName),
  );
  if (!tool) throw new Error(`Tool ${toolName} not found in mode ${mode}`);
  const fn = (tool as Record<string, Record<string, unknown>>).function;
  return (fn.parameters as Record<string, Record<string, unknown>>).properties as Record<string, Record<string, unknown>>;
}

describe("tool schema ↔ domain enum 契约", () => {
  it("add_fact.fact_type matches FactType values", () => {
    const props = getToolSchema("au", "add_fact");
    const schemaEnum = props.fact_type.enum as string[];
    expect(schemaEnum.sort()).toEqual([...FACT_TYPE_VALUES].sort());
  });

  it("add_fact.narrative_weight matches NarrativeWeight values", () => {
    const props = getToolSchema("au", "add_fact");
    const schemaEnum = props.narrative_weight.enum as string[];
    expect(schemaEnum.sort()).toEqual([...NARRATIVE_WEIGHT_VALUES].sort());
  });

  it("add_fact.status is a subset of FactStatus values", () => {
    const props = getToolSchema("au", "add_fact");
    const schemaEnum = props.status.enum as string[];
    for (const v of schemaEnum) {
      expect(FACT_STATUS_VALUES as readonly string[]).toContain(v);
    }
  });

  it("modify_fact.status matches full FactStatus values", () => {
    const props = getToolSchema("au", "modify_fact");
    const schemaEnum = props.status.enum as string[];
    expect(schemaEnum.sort()).toEqual([...FACT_STATUS_VALUES].sort());
  });

  it("modify_fact.narrative_weight matches NarrativeWeight values", () => {
    const props = getToolSchema("au", "modify_fact");
    const schemaEnum = props.narrative_weight.enum as string[];
    expect(schemaEnum.sort()).toEqual([...NARRATIVE_WEIGHT_VALUES].sort());
  });

  it("create_character_file.importance uses valid domain values", () => {
    const props = getToolSchema("au", "create_character_file");
    const schemaEnum = props.importance.enum as string[];
    // importance 不是 domain enum，但必须与 UI 校验一致
    expect(schemaEnum).toEqual(["main", "supporting", "minor"]);
  });
});
