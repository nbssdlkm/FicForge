// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { buildDefaultCharacterContent, parseAliasesFromContent, setAliasesInContent } from "../lore-utils";

describe("lore-utils setAliasesInContent — 别名 YAML 序列化 round-trip（E5 已知卡：加引号根治）", () => {
  it("含 :/#/引号 的别名 setAliasesInContent → parseAliasesFromContent 读回一致", () => {
    // 旧实现裸写 `aliases: [含: 冒号, ...]`，冒号/井号/引号会写坏 frontmatter → 读侧 safeMatter
    // 降级、别名静默丢失。JSON.stringify 加引号后是合法 YAML flow 标量，读回逐字一致。
    const base = buildDefaultCharacterContent("沈砚");
    const aliases = ["含: 冒号", "含#井号", '含"引号', "普通别名"];
    const written = setAliasesInContent(base, aliases);
    expect(parseAliasesFromContent(written)).toEqual(aliases);
  });

  it("普通别名（无危险字符）仍正常 round-trip（回归）", () => {
    const base = buildDefaultCharacterContent("沈砚");
    const aliases = ["砚哥", "沈大人"];
    const written = setAliasesInContent(base, aliases);
    expect(parseAliasesFromContent(written)).toEqual(aliases);
  });

  it("空别名写成 aliases: []，读回空数组", () => {
    const base = buildDefaultCharacterContent("沈砚");
    const written = setAliasesInContent(base, []);
    expect(parseAliasesFromContent(written)).toEqual([]);
  });

  it("别名含 $& / $' 等 replace 特殊序列不损坏 frontmatter（E5 对抗审 MED 回归锁）", () => {
    const content = "---\nname: 甲\naliases: []\n---\n\n正文段。";
    const written = setAliasesInContent(content, ["技能$&效果", "a$'b"]);
    // frontmatter 只出现一次 name:，正文只出现一次
    expect(written.match(/name:/g)?.length).toBe(1);
    expect(written.match(/正文段。/g)?.length).toBe(1);
    expect(parseAliasesFromContent(written)).toEqual(["技能$&效果", "a$'b"]);
  });
});
