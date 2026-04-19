// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import {
  // Backward-compatible exports
  split_into_chapters, get_split_method, parse_html, import_chapters,
  // New API
  analyzeFile, buildImportPlan, executeImport,
  type ImportConflictOptions,
} from "../import_pipeline.js";
import { export_chapters } from "../export_service.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import { FileStateRepository } from "../../repositories/implementations/file_state.js";
import { FileOpsRepository } from "../../repositories/implementations/file_ops.js";

class FailingWriteAdapter extends MockAdapter {
  constructor(private readonly shouldFailWrite: (path: string) => boolean) {
    super();
  }

  override async writeFile(path: string, content: string): Promise<void> {
    if (this.shouldFailWrite(path)) {
      throw new Error(`write failed: ${path}`);
    }
    await super.writeFile(path, content);
  }
}

// ===========================================================================
// Backward-compatible: split_into_chapters (旧测试保留)
// ===========================================================================

describe("split_into_chapters (backward compat)", () => {
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

describe("get_split_method (backward compat)", () => {
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
// Backward-compatible: import_chapters (旧测试保留)
// ===========================================================================

describe("import_chapters (backward compat)", () => {
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

    const state = await stateRepo.get("au1");
    expect(state.current_chapter).toBe(3);

    expect(await chapterRepo.exists("au1", 1)).toBe(true);
    expect(await chapterRepo.exists("au1", 2)).toBe(true);

    const ch = await chapterRepo.get("au1", 1);
    expect(ch.provenance).toBe("imported");

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
// export_chapters (保留原测试)
// ===========================================================================

describe("export_chapters", () => {
  let adapter: MockAdapter;
  let chapterRepo: FileChapterRepository;

  beforeEach(async () => {
    adapter = new MockAdapter();
    chapterRepo = new FileChapterRepository(adapter);

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

// ===========================================================================
// New API: analyzeFile
// ===========================================================================

describe("analyzeFile", () => {
  it("detects AI chat format", async () => {
    const text = Array.from({ length: 5 }, (_, i) =>
      `User: 写第${i + 1}章\nAssistant: ${"正文内容".repeat(500)}`,
    ).join("\n\n");
    const result = await analyzeFile(text, "对话.txt");
    expect(result.mode).toBe("chat");
    expect(result.chatFormat).toBe("User/Assistant");
    expect(result.turns).toBeDefined();
    expect(result.stats.estimatedChapters).toBeGreaterThan(0);
  });

  it("detects pure text format", async () => {
    const text = "第一章 开始\n正文1\n\n第二章 发展\n正文2";
    const result = await analyzeFile(text, "小说.txt");
    expect(result.mode).toBe("text");
    expect(result.chapters).toHaveLength(2);
    expect(result.splitMethod).toBe("standard_headers");
  });

  it("handles JSON chat export", async () => {
    const data = [
      { role: "user", content: "写一章" },
      { role: "assistant", content: "A".repeat(2000) },
      { role: "user", content: "继续" },
      { role: "assistant", content: "B".repeat(2000) },
    ];
    const result = await analyzeFile(JSON.stringify(data), "export.json");
    expect(result.mode).toBe("chat");
    expect(result.chatFormat).toBe("JSON");
    expect(result.stats.estimatedChapters).toBe(2);
  });

  it("handles JSONL (SillyTavern) format", async () => {
    const lines = [
      JSON.stringify({ role: "user", content: "写一章" }),
      JSON.stringify({ role: "assistant", content: "A".repeat(2000) }),
      JSON.stringify({ role: "user", content: "继续" }),
      JSON.stringify({ role: "assistant", content: "B".repeat(2000) }),
    ].join("\n");
    const result = await analyzeFile(lines, "chat.jsonl");
    expect(result.mode).toBe("chat");
    expect(result.chatFormat).toBe("JSONL");
    expect(result.stats.estimatedChapters).toBe(2);
  });

  it("#26: handles very short file", async () => {
    const result = await analyzeFile("短文本。", "short.txt");
    expect(result.mode).toBe("text");
    expect(result.chapters).toHaveLength(1);
  });

  it("applies custom thresholds", async () => {
    const text = Array.from({ length: 3 }, (_, i) =>
      `User: 写第${i + 1}章\nAssistant: ${"内容".repeat(300)}`,
    ).join("\n\n");
    // With default threshold (1500), 600-char replies would be uncertain
    const defaultResult = await analyzeFile(text, "test.txt");
    expect(defaultResult.stats.estimatedChapters).toBe(0); // all uncertain/skip

    // With lower threshold (500), they become chapters
    const customResult = await analyzeFile(text, "test.txt", {
      thresholds: { chapterMinChars: 500, skipMaxChars: 100 },
    });
    expect(customResult.stats.estimatedChapters).toBe(3);
  });
});

// ===========================================================================
// New API: buildImportPlan
// ===========================================================================

describe("buildImportPlan", () => {
  it("#16: multi-file chapter numbering continues", () => {
    const analysis1 = makeTextAnalysis("file1.txt", 59);
    const analysis2 = makeTextAnalysis("file2.txt", 30);

    const plan = buildImportPlan([analysis1, analysis2], {
      mode: "append", startChapter: 1, settingsMode: "merge",
    });

    expect(plan.chapters).toHaveLength(89);
    expect(plan.chapters[0].chapterNum).toBe(1);
    expect(plan.chapters[58].chapterNum).toBe(59); // last of file1
    expect(plan.chapters[59].chapterNum).toBe(60); // first of file2
    expect(plan.chapters[88].chapterNum).toBe(89); // last of file2
  });

  it("#17: 'continue' merges into previous chapter", () => {
    const analysis = makeChatAnalysis("chat.txt", [
      { type: "chapter", chars: 2000 },
      { type: "chapter_continue", chars: 1500 },
      { type: "chapter", chars: 2500 },
    ]);

    const plan = buildImportPlan([analysis], {
      mode: "append", startChapter: 1, settingsMode: "merge",
    });

    expect(plan.chapters).toHaveLength(2);
    // First chapter merged (2000 + 1500 = 3500 chars of content)
    expect(plan.chapters[0].content.length).toBeGreaterThan(3000);
    expect(plan.chapters[0].sourceTurns).toHaveLength(2);
    expect(plan.chapters[1].chapterNum).toBe(2);
  });

  it("collects settings from chat turns", () => {
    const analysis = makeChatAnalysis("chat.txt", [
      { type: "chapter", chars: 2000 },
      { type: "setting", chars: 800 },
      { type: "chapter", chars: 2500 },
      { type: "setting", chars: 600 },
    ]);

    const plan = buildImportPlan([analysis], {
      mode: "append", startChapter: 1, settingsMode: "merge",
    });

    expect(plan.chapters).toHaveLength(2);
    expect(plan.settings).toHaveLength(2);
  });

  it("#18: append mode with startChapter", () => {
    const analysis = makeTextAnalysis("file.txt", 10);
    const plan = buildImportPlan([analysis], {
      mode: "append", startChapter: 51, settingsMode: "merge",
    });

    expect(plan.chapters[0].chapterNum).toBe(51);
    expect(plan.chapters[9].chapterNum).toBe(60);
  });
});

// ===========================================================================
// New API: executeImport
// ===========================================================================

describe("executeImport", () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
  });

  it("#22: end-to-end multi-file import", async () => {
    const chapterRepo = new FileChapterRepository(adapter);
    const stateRepo = new FileStateRepository(adapter);
    const opsRepo = new FileOpsRepository(adapter);

    // Simulate 3 files producing chapters
    const plan = buildImportPlan(
      [
        makeTextAnalysis("file1.txt", 3),
        makeTextAnalysis("file2.txt", 2),
      ],
      { mode: "append", startChapter: 1, settingsMode: "merge" },
    );

    const result = await executeImport(plan, {
      auId: "au1",
      chapterRepo, stateRepo, opsRepo, adapter,
    });

    expect(result.chaptersImported).toBe(5);
    expect(await chapterRepo.exists("au1", 1)).toBe(true);
    expect(await chapterRepo.exists("au1", 5)).toBe(true);

    const state = await stateRepo.get("au1");
    expect(state.current_chapter).toBe(6);

    const ops = await opsRepo.list_all("au1");
    expect(ops).toHaveLength(1);
    expect(ops[0].op_type).toBe("import_chapters");
  });

  it("#23: mixed format import", async () => {
    const chapterRepo = new FileChapterRepository(adapter);
    const stateRepo = new FileStateRepository(adapter);
    const opsRepo = new FileOpsRepository(adapter);

    // Text file + chat file
    const textAnalysis = makeTextAnalysis("novel.txt", 2);
    const chatAnalysis = makeChatAnalysis("chat.txt", [
      { type: "chapter", chars: 2000 },
      { type: "setting", chars: 800 },
    ]);

    const plan = buildImportPlan(
      [textAnalysis, chatAnalysis],
      { mode: "append", startChapter: 1, settingsMode: "merge" },
    );

    const result = await executeImport(plan, {
      auId: "au1",
      chapterRepo, stateRepo, opsRepo, adapter,
    });

    expect(result.chaptersImported).toBe(3); // 2 from text + 1 from chat
    expect(result.settingsImported).toBe(1);
  });

  it("settings merge mode creates single file", async () => {
    const chapterRepo = new FileChapterRepository(adapter);
    const stateRepo = new FileStateRepository(adapter);
    const opsRepo = new FileOpsRepository(adapter);

    const analysis = makeChatAnalysis("chat.txt", [
      { type: "chapter", chars: 2000 },
      { type: "setting", chars: 800 },
      { type: "setting", chars: 600 },
    ]);

    const plan = buildImportPlan([analysis], {
      mode: "append", startChapter: 1, settingsMode: "merge",
    });

    await executeImport(plan, {
      auId: "au1", chapterRepo, stateRepo, opsRepo, adapter,
    });

    const settingsContent = await adapter.readFile("au1/worldbuilding/导入设定.md");
    expect(settingsContent).toContain("导入设定");
    expect(settingsContent).toContain("---"); // separator between settings
  });

  it("settings separate mode creates multiple files", async () => {
    const chapterRepo = new FileChapterRepository(adapter);
    const stateRepo = new FileStateRepository(adapter);
    const opsRepo = new FileOpsRepository(adapter);

    const analysis = makeChatAnalysis("chat.txt", [
      { type: "chapter", chars: 2000 },
      { type: "setting", chars: 800 },
      { type: "setting", chars: 600 },
    ]);

    const plan = buildImportPlan([analysis], {
      mode: "append", startChapter: 1, settingsMode: "separate",
    });

    await executeImport(plan, {
      auId: "au1", chapterRepo, stateRepo, opsRepo, adapter,
    });

    const file1 = await adapter.readFile("au1/worldbuilding/导入设定_1.md");
    const file2 = await adapter.readFile("au1/worldbuilding/导入设定_2.md");
    expect(file1).toContain("导入设定 1");
    expect(file2).toContain("导入设定 2");
  });

  it("rolls back settings files before commit when settings write fails", async () => {
    const failingAdapter = new FailingWriteAdapter((path) => path.includes("/worldbuilding/") && path.endsWith("_2.md"));
    const chapterRepo = new FileChapterRepository(failingAdapter);
    const stateRepo = new FileStateRepository(failingAdapter);
    const opsRepo = new FileOpsRepository(failingAdapter);

    const analysis = makeChatAnalysis("chat.txt", [
      { type: "chapter", chars: 2000 },
      { type: "setting", chars: 800 },
      { type: "setting", chars: 600 },
    ]);

    const plan = buildImportPlan([analysis], {
      mode: "append", startChapter: 1, settingsMode: "separate",
    });

    await expect(executeImport(plan, {
      auId: "au1", chapterRepo, stateRepo, opsRepo, adapter: failingAdapter,
    })).rejects.toThrow("write failed");

    expect(failingAdapter.allFiles().filter((path) => path.includes("/worldbuilding/"))).toEqual([]);
    expect(await chapterRepo.exists("au1", 1)).toBe(false);
    expect(await opsRepo.list_all("au1")).toHaveLength(0);
  });

  it("progress callback fires", async () => {
    const chapterRepo = new FileChapterRepository(adapter);
    const stateRepo = new FileStateRepository(adapter);
    const opsRepo = new FileOpsRepository(adapter);

    const plan = buildImportPlan(
      [makeTextAnalysis("file.txt", 3)],
      { mode: "append", startChapter: 1, settingsMode: "merge" },
    );

    const progressCalls: number[] = [];
    await executeImport(plan, {
      auId: "au1", chapterRepo, stateRepo, opsRepo, adapter,
      onProgress: (p) => progressCalls.push(p.chaptersDone),
    });

    expect(progressCalls).toEqual([1, 2, 3]);
  });

  it("#21: empty AU skips conflict", async () => {
    const chapterRepo = new FileChapterRepository(adapter);
    const stateRepo = new FileStateRepository(adapter);
    const opsRepo = new FileOpsRepository(adapter);

    const plan = buildImportPlan(
      [makeTextAnalysis("file.txt", 5)],
      { mode: "append", startChapter: 1, settingsMode: "merge" },
    );

    const result = await executeImport(plan, {
      auId: "au1", chapterRepo, stateRepo, opsRepo, adapter,
    });

    expect(result.chaptersImported).toBe(5);
    expect(result.trashedChapters).toEqual([]);
  });

  it("append to existing AU preserves state fields", async () => {
    const chapterRepo = new FileChapterRepository(adapter);
    const stateRepo = new FileStateRepository(adapter);
    const opsRepo = new FileOpsRepository(adapter);

    // First import: 3 chapters
    const plan1 = buildImportPlan(
      [makeTextAnalysis("file1.txt", 3)],
      { mode: "append", startChapter: 1, settingsMode: "merge" },
    );
    await executeImport(plan1, {
      auId: "au1", chapterRepo, stateRepo, opsRepo, adapter,
    });

    const stateAfterFirst = await stateRepo.get("au1");
    expect(stateAfterFirst.current_chapter).toBe(4);

    // Second import: 2 more chapters appended
    const plan2 = buildImportPlan(
      [makeTextAnalysis("file2.txt", 2)],
      { mode: "append", startChapter: 4, settingsMode: "merge" },
    );
    const result2 = await executeImport(plan2, {
      auId: "au1", chapterRepo, stateRepo, opsRepo, adapter,
    });

    expect(result2.chaptersImported).toBe(2);
    const stateAfterSecond = await stateRepo.get("au1");
    // current_chapter = max(4, 5+1) = 6
    expect(stateAfterSecond.current_chapter).toBe(6);
    // Existing state fields like au_id preserved
    expect(stateAfterSecond.au_id).toBe("au1");
    // 5 chapters total
    expect(await chapterRepo.exists("au1", 1)).toBe(true);
    expect(await chapterRepo.exists("au1", 5)).toBe(true);
    // 2 ops logged (one per import)
    const ops = await opsRepo.list_all("au1");
    expect(ops).toHaveLength(2);
  });
});

// ===========================================================================
// Test helpers
// ===========================================================================

function makeTextAnalysis(filename: string, chapterCount: number): import("../import_pipeline.js").FileAnalysis {
  const chapters = Array.from({ length: chapterCount }, (_, i) => ({
    chapter_num: i + 1,
    title: `Chapter ${i + 1}`,
    content: `Content of chapter ${i + 1}. ${"Lorem ipsum ".repeat(50)}`,
  }));

  return {
    filename,
    fileFormat: "txt",
    mode: "text" as const,
    chapters,
    splitMethod: "standard_headers",
    stats: {
      totalChars: chapters.reduce((sum, c) => sum + c.content.length, 0),
      estimatedChapters: chapterCount,
      settingsCount: 0,
      skippedCount: 0,
    },
  };
}

function makeChatAnalysis(
  filename: string,
  specs: { type: "chapter" | "chapter_continue" | "setting" | "skip"; chars: number }[],
): import("../import_pipeline.js").FileAnalysis {
  let chapterNum = 1;
  const turns: import("../chat_parser.js").ClassifiedTurn[] = specs.map((spec, i) => ({
    index: i,
    role: "assistant" as const,
    content: "X".repeat(spec.chars),
    charCount: spec.chars,
    classification: (spec.type === "chapter" || spec.type === "chapter_continue" ? "chapter" : spec.type === "setting" ? "uncertain" : "skip") as "chapter" | "setting" | "skip" | "uncertain",
    reason: "test",
    assignedChapter: spec.type === "chapter" ? chapterNum++ : null,
    assignedType: spec.type,
  }));

  return {
    filename,
    fileFormat: "txt",
    mode: "chat" as const,
    chatFormat: "User/Assistant",
    turns,
    stats: {
      totalChars: specs.reduce((sum, s) => sum + s.chars, 0),
      estimatedChapters: specs.filter((s) => s.type === "chapter").length,
      settingsCount: specs.filter((s) => s.type === "setting").length,
      skippedCount: specs.filter((s) => s.type === "skip").length,
    },
  };
}
