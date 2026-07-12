// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { parseCharacterCard } from "../character_card.js";

describe("parseCharacterCard", () => {
  it("解析 name + inline 数组 aliases", () => {
    const raw = "---\nname: 沈砚\naliases: [砚哥, 沈大人]\n---\n\n# 沈砚\n";
    expect(parseCharacterCard(raw)).toEqual({ name: "沈砚", aliases: ["砚哥", "沈大人"] });
  });

  it("解析 block 数组 aliases", () => {
    const raw = "---\nname: 沈砚\naliases:\n  - 砚哥\n  - 沈大人\n---\n正文";
    expect(parseCharacterCard(raw)).toEqual({ name: "沈砚", aliases: ["砚哥", "沈大人"] });
  });

  it("name trim；缺失/空白/非字符串 → null", () => {
    expect(parseCharacterCard("---\nname: '  沈砚  '\naliases: []\n---\n").name).toBe("沈砚");
    expect(parseCharacterCard("---\naliases: [砚哥]\n---\n")).toEqual({ name: null, aliases: ["砚哥"] });
    expect(parseCharacterCard("---\nname: '   '\naliases: []\n---\n").name).toBeNull();
    expect(parseCharacterCard("---\nname: 42\naliases: []\n---\n").name).toBeNull();
  });

  it("无 frontmatter → 全空", () => {
    expect(parseCharacterCard("# 沈砚\n\n正文而已")).toEqual({ name: null, aliases: [] });
  });

  it("正文以 --- 场景分割线开头（无已知键）不误吞", () => {
    const raw = "---\n时间: 深夜\n---\n正文";
    expect(parseCharacterCard(raw)).toEqual({ name: null, aliases: [] });
  });

  it("YAML 非法安全降级", () => {
    const raw = "---\nname: [unclosed\n---\n正文";
    expect(parseCharacterCard(raw)).toEqual({ name: null, aliases: [] });
  });

  it("aliases 非数组 / 项非字符串 / 空白项 → 只留合法项", () => {
    expect(parseCharacterCard("---\nname: 沈砚\naliases: 砚哥\n---\n").aliases).toEqual([]);
    const raw = "---\nname: 沈砚\naliases: [1, true, ' 砚哥 ', '', '  ']\n---\n";
    expect(parseCharacterCard(raw).aliases).toEqual(["砚哥"]);
  });

  it("卡内别名大小写不敏感去重，保首见写法", () => {
    const raw = "---\nname: 沈砚\naliases: [Yan, yan, YAN, 砚哥]\n---\n";
    expect(parseCharacterCard(raw).aliases).toEqual(["Yan", "砚哥"]);
  });

  it("别名与本卡主名相同（大小写不敏感）→ 剔除", () => {
    const raw = "---\nname: Harry\naliases: [harry, HARRY, Harry Potter]\n---\n";
    expect(parseCharacterCard(raw).aliases).toEqual(["Harry Potter"]);
  });
});
