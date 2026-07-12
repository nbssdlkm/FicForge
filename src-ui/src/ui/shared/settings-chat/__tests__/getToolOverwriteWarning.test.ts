// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 盲审 R3 M9：settings-chat 的同名覆盖判据现复用 lore-utils 的 toCanonicalCreateKey
 * 单一真相源（此前是私有拷贝，漂移会让「是否已存在」两处结论不一 → 静默覆盖用户文件）。
 * 此文件锁「大小写 / 空格-下划线 / .md 后缀」都经同一规范化判为同名。
 */

import { describe, expect, it } from "vitest";
import { getToolOverwriteWarning } from "../types";

const t = (key: string) => key; // 直接回 key，便于断言「有无警告」

describe("getToolOverwriteWarning 同名判据（复用 lore-utils canonical key）", () => {
  it("大小写 / 空格→下划线 / .md 变体都判为已存在（规范化命中）", () => {
    const existingChars = new Set(["alice_smith.md"]);
    for (const variant of ["Alice Smith", "ALICE_SMITH", "alice smith.md", "  Alice_Smith  "]) {
      const warning = getToolOverwriteWarning("create_character_file", { name: variant }, existingChars, new Set(), t);
      expect(warning, `变体 "${variant}" 应判为已存在`).not.toBeNull();
    }
  });

  it("不同名不误报", () => {
    const warning = getToolOverwriteWarning(
      "create_character_file",
      { name: "Bob" },
      new Set(["alice_smith.md"]),
      new Set(),
      t,
    );
    expect(warning).toBeNull();
  });

  it("世界观文件走 worldbuilding 集合，与角色集合隔离", () => {
    const chars = new Set(["alice.md"]);
    const world = new Set(["magic_system.md"]);
    // 角色名撞世界观集合不应报（分类隔离）
    expect(getToolOverwriteWarning("create_character_file", { name: "magic system" }, chars, world, t)).toBeNull();
    // 世界观名撞世界观集合应报
    expect(
      getToolOverwriteWarning("create_worldbuilding_file", { name: "Magic System" }, chars, world, t),
    ).not.toBeNull();
  });
});
