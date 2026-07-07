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

  it("M28: saveLore 回传实际落盘的 sanitized filename/category（供 undo/modify 回填读写闭环）", async () => {
    // 传入含全角标点的名字：磁盘名会被 sanitize 成 _；返回值必须是磁盘真名，
    // 否则调用方用传入名去 undo/read 会找不到文件（写读双路径不对称，M28）。
    const saved = await saveLore({
      au_path: "au1",
      category: "characters",
      filename: "林黛玉：初见？.md",
      content: "# 林黛玉",
    });

    // 返回的 filename/category 与磁盘 path 末两段一致，且是 sanitize 后的白名单形态。
    expect(saved.category).toBe("characters");
    expect(saved.filename).toBe(saved.path.split("/").at(-1));
    expect(saved.filename).not.toMatch(/[：？]/); // 全角标点已被换掉
    expect(saved.filename).toMatch(/^[\p{L}\p{N}._ -]+$/u);
    // 用返回的真名能读回内容（闭环验证）。
    const back = await readLore({ au_path: "au1", category: saved.category, filename: saved.filename });
    expect(back.content).toBe("# 林黛玉");
  });
});
