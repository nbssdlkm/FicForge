// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { get_tools_for_mode } from "../settings_tools.js";

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
