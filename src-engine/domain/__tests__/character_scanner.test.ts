// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { scan_characters_in_chapter } from "../character_scanner.js";

describe("scan_characters_in_chapter", () => {
  it("empty text returns empty", () => {
    expect(scan_characters_in_chapter("", { characters: ["Alice"] })).toEqual({});
  });

  it("finds character names", () => {
    const result = scan_characters_in_chapter(
      "Alice走进房间，看到了Bob。",
      { characters: ["Alice", "Bob"] },
    );
    expect(result).toEqual({ Alice: 0, Bob: 0 });
  });

  it("maps aliases to main name", () => {
    const result = scan_characters_in_chapter(
      "小明走进房间。",
      { characters: ["明华"] },
      { 明华: ["小明"] },
      5,
    );
    expect(result).toEqual({ 明华: 5 });
  });

  it("longer name takes priority", () => {
    const result = scan_characters_in_chapter(
      "张三丰在练剑。",
      { characters: ["张三", "张三丰"] },
    );
    expect(result).toHaveProperty("张三丰");
  });

  it("empty characters list with non-empty text", () => {
    const result = scan_characters_in_chapter(
      "Alice走进房间。",
      { characters: [] },
    );
    expect(result).toEqual({});
  });

  it("missing characters key in cast_registry", () => {
    const result = scan_characters_in_chapter(
      "Alice走进房间。",
      {},
    );
    expect(result).toEqual({});
  });

  it("alias for character not in cast_registry still matches", () => {
    const result = scan_characters_in_chapter(
      "小明在看书。",
      { characters: [] },
      { 明华: ["小明"] },
      1,
    );
    expect(result).toEqual({ 明华: 1 });
  });

  it("case-sensitive matching", () => {
    const result = scan_characters_in_chapter(
      "alice walked in.",
      { characters: ["Alice"] },
    );
    // "alice" does NOT match "Alice" — case-sensitive
    expect(result).toEqual({});
  });

  it("multiple aliases for same character", () => {
    const result = scan_characters_in_chapter(
      "小明和华仔都来了。",
      { characters: [] },
      { 明华: ["小明", "华仔"] },
      2,
    );
    expect(result).toEqual({ 明华: 2 });
  });
});
