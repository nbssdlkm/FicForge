// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { beforeEach, describe, expect, it } from "vitest";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";
import { createAu, createFandom } from "../engine-fandom";
import { initEngine } from "../engine-instance";
import { importFromFandom, readLore, sanitizePathSegment, saveLore } from "../engine-lore";

describe("engine-lore path sanitization", () => {
  const dataDir = "/data";
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
    initEngine(adapter, dataDir);
  });

  it("replaces reserved characters with underscores for newly created path segments", () => {
    const reservedChars = [
      "/",
      "\\",
      "?",
      "#",
      "%",
      ":",
      "*",
      "\"",
      "<",
      ">",
      "|",
      "&",
      "{",
      "}",
      "[",
      "]",
      "!",
      "@",
      "$",
      "^",
      "=",
      "+",
      ";",
      ",",
      "'",
    ];

    for (const char of reservedChars) {
      expect(sanitizePathSegment(`A${char}B`)).toBe("A_B");
    }
  });

  it("preserves unicode letters, numbers, spaces, dots, hyphens, and underscores", () => {
    const name = "底特律 Become Human 第1章 - 序.章_Alpha";
    expect(sanitizePathSegment(name)).toBe(name);
  });

  it("supports reading legacy lore filenames without rewriting them", async () => {
    adapter.seed("/data/fandoms/legacy/core_worldbuilding/Detroit: Become Human?.md", "# legacy lore");

    const result = await readLore({
      fandom_path: "/data/fandoms/legacy",
      category: "core_worldbuilding",
      filename: "Detroit: Become Human?.md",
    });

    expect(result.content).toBe("# legacy lore");
  });

  it("sanitizes new lore writes and imported destinations while keeping legacy source filenames readable", async () => {
    const fandom = await createFandom("Detroit: Become Human");
    const au = await createAu(fandom.name, "RK800 / Connor", fandom.path);

    const saved = await saveLore({
      fandom_path: fandom.path,
      category: "core?worldbuilding",
      filename: "Connor: RK800?.md",
      content: "# Connor",
    });

    expect(saved.path.split("/").at(-2)).toBe("core_worldbuilding");
    expect(saved.path.split("/").at(-1)).toMatch(/^[\p{L}\p{N}._ -]+$/u);
    expect(saved.path.split("/").at(-1)).not.toMatch(/[\\/:*?"<>|#%]/);

    adapter.seed(`${fandom.path}/core_characters/Connor: RK800?.md`, "# legacy character");

    const imported = await importFromFandom({
      fandom_path: fandom.path,
      au_path: au.path,
      filenames: ["Connor: RK800?.md"],
      source_category: "core_characters",
    });

    expect(imported.imported).toEqual(["Connor: RK800?.md"]);
    expect(adapter.raw(`${au.path}/characters/Connor_ RK800_.md`)).toBe("# legacy character");
  });
});
