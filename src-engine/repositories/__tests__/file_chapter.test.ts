// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import { FileChapterRepository } from "../implementations/file_chapter.js";
import { createChapter } from "../../domain/chapter.js";
import { createGeneratedWith } from "../../domain/generated_with.js";
import { MockAdapter } from "./mock_adapter.js";

describe("FileChapterRepository", () => {
  let adapter: MockAdapter;
  let repo: FileChapterRepository;

  beforeEach(() => {
    adapter = new MockAdapter();
    repo = new FileChapterRepository(adapter);
  });

  it("save and get round-trip", async () => {
    const chapter = createChapter({
      au_id: "au1",
      chapter_num: 1,
      content: "这是第一章的内容。夕阳西下。",
      chapter_id: "uuid-001",
      revision: 1,
      confirmed_focus: ["f1", "f2"],
      provenance: "ai",
    });
    await repo.save(chapter);

    const loaded = await repo.get("au1", 1);
    expect(loaded.content).toContain("这是第一章的内容");
    expect(loaded.chapter_id).toBe("uuid-001");
    expect(loaded.confirmed_focus).toEqual(["f1", "f2"]);
    expect(loaded.provenance).toBe("ai");
  });

  it("get auto-repairs missing fields", async () => {
    // Seed a chapter with no frontmatter
    adapter.seed("au1/chapters/main/ch0001.md", "纯正文，没有 frontmatter。");

    const loaded = await repo.get("au1", 1);
    expect(loaded.chapter_id).toBeTruthy(); // auto-generated UUID
    expect(loaded.confirmed_at).toBeTruthy();
    expect(loaded.content_hash).toBeTruthy();
    expect(["ai", "imported"]).toContain(loaded.provenance); // auto-repaired
    expect(loaded.revision).toBe(1);
  });

  it("throws on missing chapter", async () => {
    await expect(repo.get("au1", 99)).rejects.toThrow("Chapter not found");
  });

  it("delete removes file", async () => {
    const chapter = createChapter({ au_id: "au1", chapter_num: 1, content: "test" });
    await repo.save(chapter);
    expect(await repo.exists("au1", 1)).toBe(true);

    await repo.delete("au1", 1);
    expect(await repo.exists("au1", 1)).toBe(false);
  });

  it("list_main returns sorted chapters", async () => {
    await repo.save(createChapter({ au_id: "au1", chapter_num: 3, content: "ch3" }));
    await repo.save(createChapter({ au_id: "au1", chapter_num: 1, content: "ch1" }));
    await repo.save(createChapter({ au_id: "au1", chapter_num: 2, content: "ch2" }));

    const chapters = await repo.list_main("au1");
    expect(chapters.map((c) => c.chapter_num)).toEqual([1, 2, 3]);
  });

  it("get_content_only strips frontmatter", async () => {
    await repo.save(createChapter({ au_id: "au1", chapter_num: 1, content: "纯正文内容" }));
    const content = await repo.get_content_only("au1", 1);
    expect(content).toContain("纯正文内容");
    expect(content).not.toContain("chapter_id");
  });

  it("backup_chapter creates versioned backup", async () => {
    await repo.save(createChapter({ au_id: "au1", chapter_num: 1, content: "original" }));
    const backupPath = await repo.backup_chapter("au1", 1);
    expect(backupPath).toContain("ch0001_v1.md");

    // Second backup
    const backupPath2 = await repo.backup_chapter("au1", 1);
    expect(backupPath2).toContain("ch0001_v2.md");
  });

  it("preserves generated_with metadata", async () => {
    const gw = createGeneratedWith({
      mode: "api",
      model: "gpt-4o",
      temperature: 0.8,
      input_tokens: 5000,
      output_tokens: 1500,
    });
    await repo.save(createChapter({
      au_id: "au1",
      chapter_num: 1,
      content: "test",
      generated_with: gw,
    }));

    const loaded = await repo.get("au1", 1);
    expect(loaded.generated_with).not.toBeNull();
    expect(loaded.generated_with!.model).toBe("gpt-4o");
    expect(loaded.generated_with!.temperature).toBe(0.8);
  });
});
