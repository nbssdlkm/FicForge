// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { mergeCharactersLastSeen, scanCharactersInChapter } from "../character_scanner.js";

/** 读自有 __proto__ 数据属性的值，绕开 obj["__proto__"] 直读（会触发 noProto 且语义易误读）。 */
function ownProto(obj: Record<string, number>): unknown {
  return Object.getOwnPropertyDescriptor(obj, "__proto__")?.value;
}

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

  it("角色名为 __proto__ 也能记录：写侧用 defineProperty 而非裸赋值（盲审 R5 codex 写侧缺口）", () => {
    const result = scanCharactersInChapter("__proto__ 出场了。", { characters: ["__proto__"] }, null, 3);
    // 裸 `result["__proto__"] = 3` 会命中原型 setter 被静默丢弃 → 该角色永不入表。
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    expect(ownProto(result)).toBe(3);
    // 原型未被污染（defineProperty 建的是自有数据属性，不改 prototype）。
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  });
});

describe("mergeCharactersLastSeen", () => {
  it("逐名取较大章号，原地改 target", () => {
    const target: Record<string, number> = { Alice: 1, Bob: 3 };
    mergeCharactersLastSeen(target, { Alice: 2, Charlie: 5 });
    expect(target).toEqual({ Alice: 2, Bob: 3, Charlie: 5 });
  });

  it("已有更大章号时不回退", () => {
    const target: Record<string, number> = { Alice: 4 };
    mergeCharactersLastSeen(target, { Alice: 2 });
    expect(target.Alice).toBe(4);
  });

  it("原型键 constructor / toString / __proto__ 全部安全合并（读用 hasOwn、写用 defineProperty）", () => {
    const target: Record<string, number> = {};
    // scanned 必须经 JSON.parse 构造：对象字面量 `{ __proto__: 3 }` 会把 __proto__ 当原型指令而非
    // 自有键（不会进 Object.entries）——scanCharactersInChapter 经 setLastSeen 产出的正是自有 __proto__。
    mergeCharactersLastSeen(target, JSON.parse('{"constructor":1,"toString":2,"__proto__":3}'));
    expect(Object.hasOwn(target, "constructor")).toBe(true);
    expect(Object.hasOwn(target, "toString")).toBe(true);
    expect(Object.hasOwn(target, "__proto__")).toBe(true);
    expect(target.constructor).toBe(1);
    expect(target.toString).toBe(2);
    expect(ownProto(target)).toBe(3);
    // 原型未被污染。
    expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
    // 取 max 对原型键同样生效（第二轮更大章号覆盖）。
    mergeCharactersLastSeen(target, JSON.parse('{"__proto__":9,"constructor":0}'));
    expect(ownProto(target)).toBe(9);
    expect(target.constructor).toBe(1);
  });
});
