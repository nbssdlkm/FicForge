// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { scanCharactersInChapter } from "../character_scanner.js";

describe("scan_characters_in_chapter", () => {
  it("empty text returns empty", () => {
    expect(scanCharactersInChapter("", { characters: ["Alice"] })).toEqual({});
  });

  it("finds character names", () => {
    const result = scanCharactersInChapter("Alice走进房间，看到了Bob。", { characters: ["Alice", "Bob"] });
    expect(result).toEqual({ Alice: 0, Bob: 0 });
  });

  it("maps aliases to main name", () => {
    const result = scanCharactersInChapter("小明走进房间。", { characters: ["明华"] }, { 明华: ["小明"] }, 5);
    expect(result).toEqual({ 明华: 5 });
  });

  it("longer name takes priority", () => {
    const result = scanCharactersInChapter("张三丰在练剑。", { characters: ["张三", "张三丰"] });
    expect(result).toHaveProperty("张三丰");
  });

  it("empty characters list with non-empty text", () => {
    const result = scanCharactersInChapter("Alice走进房间。", { characters: [] });
    expect(result).toEqual({});
  });

  it("missing characters key in cast_registry", () => {
    const result = scanCharactersInChapter("Alice走进房间。", {});
    expect(result).toEqual({});
  });

  it("alias for character not in cast_registry still matches", () => {
    const result = scanCharactersInChapter("小明在看书。", { characters: [] }, { 明华: ["小明"] }, 1);
    expect(result).toEqual({ 明华: 1 });
  });

  it("case-sensitive matching", () => {
    const result = scanCharactersInChapter("alice walked in.", { characters: ["Alice"] });
    // "alice" does NOT match "Alice" — case-sensitive
    expect(result).toEqual({});
  });

  it("multiple aliases for same character", () => {
    const result = scanCharactersInChapter("小明和华仔都来了。", { characters: [] }, { 明华: ["小明", "华仔"] }, 2);
    expect(result).toEqual({ 明华: 2 });
  });

  it("角色名为 Object.prototype 键（constructor / toString）也能记录，不被原型链误判去重（E5 正确性 L3）", () => {
    const result = scanCharactersInChapter("constructor 与 toString 都出场了。", {
      characters: ["constructor", "toString"],
    });
    // 裸 `mainName in result` 会因原型链把首次出现误判为已匹配而 continue 跳过 → 永不入表。
    expect(Object.hasOwn(result, "constructor")).toBe(true);
    expect(Object.hasOwn(result, "toString")).toBe(true);
    expect(result.constructor).toBe(0);
    expect(result.toString).toBe(0);
  });
});
