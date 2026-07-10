// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { SETTINGS_MUTATING_TOOL_NAMES, SIMPLE_MUTATING_TOOL_NAMES, get_tools_for_mode } from "../settings_tools.js";

describe("settings_tools", () => {
  it("AU mode returns 9 tools", () => {
    const tools = get_tools_for_mode("au");
    expect(tools).toHaveLength(9);
    const names = tools.map((t) => (t.function as { name: string }).name);
    expect(names).toContain("create_character_file");
    expect(names).toContain("add_fact");
    expect(names).toContain("update_core_includes");
  });

  it("Fandom mode returns 4 tools", () => {
    const tools = get_tools_for_mode("fandom");
    expect(tools).toHaveLength(4);
    const names = tools.map((t) => (t.function as { name: string }).name);
    expect(names).toContain("create_core_character_file");
  });

  it("unknown mode throws", () => {
    expect(() => get_tools_for_mode("invalid")).toThrow("不支持的设定模式");
  });

  it("returns copies, not references", () => {
    const a = get_tools_for_mode("au");
    const b = get_tools_for_mode("au");
    expect(a).not.toBe(b);
  });
});

describe("工具名契约单一真相源（盲审 2026-07-11）", () => {
  const defNames = (mode: string) =>
    get_tools_for_mode(mode).map((tool) => (tool.function as { name: string }).name);

  it("SETTINGS_MUTATING_TOOL_NAMES ≡ au+fandom 工具定义的修改类全集（去重）", () => {
    const fromDefs = new Set([...defNames("au"), ...defNames("fandom")]);
    expect([...fromDefs].sort()).toEqual([...SETTINGS_MUTATING_TOOL_NAMES].sort());
  });

  it("SIMPLE_TOOL_SCHEMAS 的 key ≡ 修改类契约 + view/chat_reply（zod 镜像不许漂移 —— B5 对抗审：第四份平行清单收口）", async () => {
    const { SIMPLE_TOOL_SCHEMAS, SIMPLE_TOOL_PATH_FIELDS } = await import("../simple_tools_zod.js");
    const expected = [...SIMPLE_MUTATING_TOOL_NAMES, "show_chapter", "show_setting", "chat_reply"];
    expect(Object.keys(SIMPLE_TOOL_SCHEMAS).sort()).toEqual(expected.sort());
    // pathFields 的 key 必须是 schema 的子集（悬空 key = 改名残留）
    for (const key of Object.keys(SIMPLE_TOOL_PATH_FIELDS)) {
      expect(Object.keys(SIMPLE_TOOL_SCHEMAS)).toContain(key);
    }
  });

  it("SIMPLE_MUTATING_TOOL_NAMES ≡ simple 下发工具集的修改类子集（去掉 view/chat_reply）", () => {
    const simple = defNames("simple").filter(
      (name) => !["show_chapter", "show_setting", "chat_reply"].includes(name),
    );
    expect(simple.sort()).toEqual([...SIMPLE_MUTATING_TOOL_NAMES].sort());
  });
});
