import { describe, expect, it } from "vitest";
import { get_tools_for_mode } from "../settings_tools.js";

describe("get_tools_for_mode('simple') — 物理收紧 disabled tools", () => {
  it("不含 add_fact / modify_fact / update_core_includes", () => {
    const tools = get_tools_for_mode("simple");
    const names = tools.map((t) => (t as { function: { name: string } }).function.name);
    expect(names).not.toContain("add_fact");
    expect(names).not.toContain("modify_fact");
    expect(names).not.toContain("update_core_includes");
  });

  it("包含 6 modify + 2 view + 1 chat_reply（共 9 个）", () => {
    const tools = get_tools_for_mode("simple");
    const names = tools.map((t) => (t as { function: { name: string } }).function.name);
    expect(names).toContain("create_character_file");
    expect(names).toContain("modify_character_file");
    expect(names).toContain("create_worldbuilding_file");
    expect(names).toContain("modify_worldbuilding_file");
    expect(names).toContain("add_pinned_context");
    expect(names).toContain("update_writing_style");
    expect(names).toContain("show_chapter");
    expect(names).toContain("show_setting");
    expect(names).toContain("chat_reply");
    expect(tools).toHaveLength(9);
  });
});

describe("get_tools_for_mode 主仓库行为回归红线", () => {
  it("au mode 仍含全部 9 个 _AU_TOOLS（不受简版改动影响）", () => {
    const tools = get_tools_for_mode("au");
    const names = tools.map((t) => (t as { function: { name: string } }).function.name);
    expect(tools).toHaveLength(9);
    expect(names).toContain("add_fact");
    expect(names).toContain("modify_fact");
    expect(names).toContain("update_core_includes");
  });

  it("fandom mode 仍含 4 个 _FANDOM_TOOLS（不受简版改动影响）", () => {
    const tools = get_tools_for_mode("fandom");
    expect(tools).toHaveLength(4);
  });
});
