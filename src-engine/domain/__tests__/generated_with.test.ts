// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 盲审 R3 M8：GeneratedWith ↔ YAML 映射的单一真相源。此前 file_draft / file_chapter
 * 各手抄一份读/写映射（4 处），新增字段会在某些副本被静默丢弃。此文件锁 round-trip
 * 覆盖全字段 —— 若将来给 interface 加字段却漏改 mapper，全字段断言会红。
 */

import { describe, expect, it } from "vitest";
import {
  createGeneratedWith,
  generatedWithFromYaml,
  generatedWithToYaml,
  type GeneratedWith,
} from "../generated_with.js";

const FULL: GeneratedWith = {
  mode: "api",
  model: "deepseek-v4-flash",
  temperature: 0.8,
  top_p: 0.95,
  input_tokens: 1234,
  output_tokens: 567,
  char_count: 3000,
  duration_ms: 4200,
  generated_at: "2026-07-11T00:00:00Z",
};

describe("generatedWithFromYaml / generatedWithToYaml", () => {
  it("round-trip 保留全部字段（防新增字段被静默丢弃）", () => {
    const yaml = generatedWithToYaml(FULL);
    // toYaml 的键集合必须与 interface 键完全一致（漏字段即断链）
    expect(Object.keys(yaml).sort()).toEqual(Object.keys(FULL).sort());
    const back = generatedWithFromYaml(yaml);
    expect(back).toEqual(FULL);
  });

  it("缺失 / 非对象输入 → null（frontmatter 无 generated_with 时）", () => {
    expect(generatedWithFromYaml(undefined)).toBeNull();
    expect(generatedWithFromYaml(null)).toBeNull();
    expect(generatedWithFromYaml("nope")).toBeNull();
    expect(generatedWithFromYaml(42)).toBeNull();
  });

  it("部分字段缺失时以 createGeneratedWith 默认值补齐（数值归零、字符串空）", () => {
    const partial = generatedWithFromYaml({ model: "gpt-4o", temperature: 0.7 });
    expect(partial).toEqual(createGeneratedWith({ model: "gpt-4o", temperature: 0.7 }));
    expect(partial?.mode).toBe("");
    expect(partial?.input_tokens).toBe(0);
  });

  it("字符串型数值被 Number 归一（YAML 反序列化可能给字符串）", () => {
    const coerced = generatedWithFromYaml({ input_tokens: "100", duration_ms: "250" });
    expect(coerced?.input_tokens).toBe(100);
    expect(coerced?.duration_ms).toBe(250);
  });
});
