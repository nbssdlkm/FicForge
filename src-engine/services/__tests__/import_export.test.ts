// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import { split_into_chapters, get_split_method, parse_html, import_chapters } from "../import_pipeline.js";
import { export_chapters } from "../export_service.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import { FileStateRepository } from "../../repositories/implementations/file_state.js";
import { FileOpsRepository } from "../../repositories/implementations/file_ops.js";

// ===========================================================================
// split_into_chapters
// ===========================================================================

describe("split_into_chapters", () => {
  it("empty text returns empty", () => {
    expect(split_into_chapters("")).toEqual([]);
  });

  it("standard Chinese chapter titles", () => {
    const text = "第一章 黄昏\n内容1\n\n第二章 黎明\n内容2";
    const result = split_into_chapters(text);
    expect(result).toHaveLength(2);
    expect(result[0].title).toContain("第一章");
    expect(result[0].content).toContain("内容1");
    expect(result[1].title).toContain("第二章");
  });

  it("English chapter titles", () => {
    const text = "Chapter 1 Introduction\nContent 1\n\nChapter 2 Rising\nContent 2";
    const result = split_into_chapters(text);
    expect(result).toHaveLength(2);
    expect(result[0].title).toContain("Chapter 1");
  });

  it("integer sequence titles", () => {
    const text = "1\n内容一\n\n2\n内容二\n\n3\n内容三";
    const result = split_into_chapters(text);
    expect(result).toHaveLength(3);
    expect(result[0].chapter_num).toBe(1);
  });

  it("auto-split for long text without titles", () => {
    const text = ("这是一段很长的文本。" + "A".repeat(200) + "\n\n").repeat(20);
    const result = split_into_chapters(text);
    expect(result.length).toBeGreaterThan(1);
    expect(result[0].title).toContain("自动分段");
  });

  it("single short text returns one chapter", () => {
    const text = "短文本内容。";
    const result = split_into_chapters(text);
    expect(result).toHaveLength(1);
  });

  it("preserves pre-title content in first chapter", () => {
    const text = "前言内容\n\n第一章 开始\n正文内容";
    const result = split_into_chapters(text);
    expect(result[0].content).toContain("前言内容");
  });
});

describe("get_split_method", () => {
  it("detects title method", () => {
    expect(get_split_method("第一章 标题\n内容")).toBe("title");
  });

  it("detects integer method", () => {
    expect(get_split_method("1\n内容\n2\n内容")).toBe("integer");
  });

  it("falls back to auto", () => {
    expect(get_split_method("无标题的纯文本")).toBe("auto_3000");
  });
});

describe("parse_html", () => {
  it("removes script and style tags", () => {
    const html = '<script>alert("xss")</script><style>body{}</style><p>内容</p>';
    const result = parse_html(html);
    expect(result).not.toContain("script");
    expect(result).not.toContain("style");
    expect(result).toContain("内容");
  });

  it("converts br to newline", () => {
    const result = parse_html("行1<br>行2<br/>行3");
    expect(result).toContain("行1\n行2\n行3");
  });

  it("removes HTML tags", () => {
    const result = parse_html("<p><strong>加粗</strong>文本</p>");
    expect(result).toContain("加粗文本");
  });

  it("decodes HTML entities", () => {
    const result = parse_html("&amp; &lt; &gt; &quot;");
    expect(result).toContain("& < > \"");
  });
});

// ===========================================================================
// import_chapters
// ===========================================================================

describe("import_chapters", () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
  });

  it("imports chapters and initializes state", async () => {
    const chapterRepo = new FileChapterRepository(adapter);
    const stateRepo = new FileStateRepository(adapter);
    const opsRepo = new FileOpsRepository(adapter);

    const result = await import_chapters({
      au_id: "au1",
      chapters: [
        { chapter_num: 1, title: "第一章", content: "Alice走进房间。" },
        { chapter_num: 2, title: "第二章", content: "Bob离开了。" },
      ],
      chapter_repo: chapterRepo, state_repo: stateRepo, ops_repo: opsRepo,
      cast_registry: { characters: ["Alice", "Bob"] },
    });

    expect(result.total_chapters).toBe(2);
    expect(result.state_initialized).toBe(true);
    expect(result.characters_found).toContain("Alice");

    // State initialized
    const state = await stateRepo.get("au1");
    expect(state.current_chapter).toBe(3);

    // Chapters saved
    expect(await chapterRepo.exists("au1", 1)).toBe(true);
    expect(await chapterRepo.exists("au1", 2)).toBe(true);

    // Chapter has correct provenance
    const ch = await chapterRepo.get("au1", 1);
    expect(ch.provenance).toBe("imported");

    // Ops logged
    const ops = await opsRepo.list_all("au1");
    expect(ops).toHaveLength(1);
    expect(ops[0].op_type).toBe("import_project");
  });

  it("empty chapters list", async () => {
    const result = await import_chapters({
      au_id: "au1", chapters: [],
      chapter_repo: new FileChapterRepository(adapter),
      state_repo: new FileStateRepository(adapter),
      ops_repo: new FileOpsRepository(adapter),
    });
    expect(result.total_chapters).toBe(0);
  });
});

// ===========================================================================
// export_chapters
// ===========================================================================

describe("export_chapters", () => {
  let adapter: MockAdapter;
  let chapterRepo: FileChapterRepository;

  beforeEach(async () => {
    adapter = new MockAdapter();
    chapterRepo = new FileChapterRepository(adapter);

    // Import some chapters first
    const stateRepo = new FileStateRepository(adapter);
    const opsRepo = new FileOpsRepository(adapter);
    await import_chapters({
      au_id: "au1",
      chapters: [
        { chapter_num: 1, title: "第一章", content: "第一章内容" },
        { chapter_num: 2, title: "第二章", content: "第二章内容" },
        { chapter_num: 3, title: "第三章", content: "第三章内容" },
      ],
      chapter_repo: chapterRepo, state_repo: stateRepo, ops_repo: opsRepo,
    });
  });

  it("exports all chapters as txt", async () => {
    const text = await export_chapters({
      au_id: "au1", chapter_repo: chapterRepo, format: "txt",
    });
    expect(text).toContain("第一章内容");
    expect(text).toContain("第二章内容");
    expect(text).toContain("第三章内容");
  });

  it("exports range", async () => {
    const text = await export_chapters({
      au_id: "au1", chapter_repo: chapterRepo,
      start_chapter: 2, end_chapter: 2,
    });
    expect(text).toContain("第二章内容");
    expect(text).not.toContain("第一章内容");
    expect(text).not.toContain("第三章内容");
  });

  it("md format includes markdown headers", async () => {
    const text = await export_chapters({
      au_id: "au1", chapter_repo: chapterRepo, format: "md",
      chapter_titles: { 1: "黄昏", 2: "黎明" },
    });
    expect(text).toContain("## 第1章 黄昏");
    expect(text).toContain("## 第2章 黎明");
  });

  it("returns empty for non-existent range", async () => {
    const text = await export_chapters({
      au_id: "au1", chapter_repo: chapterRepo,
      start_chapter: 100,
    });
    expect(text).toBe("");
  });
});
