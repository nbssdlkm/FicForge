// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  // Backward-compatible exports
  split_into_chapters, get_split_method, parse_html, import_chapters,
  // New API
  analyzeFile, buildImportPlan, executeImport,
  type ImportConflictOptions,
} from "../import_pipeline.js";
import type { LLMProvider } from "../../llm/provider.js";
import { export_chapters } from "../export_service.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import { FileStateRepository } from "../../repositories/implementations/file_state.js";
import { FileOpsRepository } from "../../repositories/implementations/file_ops.js";

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

  // ─── LLM chat-structure fallback ────────────────────────────────────────

  function makeLlm(content: string): LLMProvider {
    return {
      generate: vi.fn().mockResolvedValue({
        content,
        model: "mock",
        input_tokens: null,
        output_tokens: null,
        finish_reason: "stop",
      }),
      generateStream: vi.fn(),
    };
  }

  // 使用非标准标记 [U] / [B]：确保规则 detectChatFormat 命中不了，必须走 LLM 兜底
  const nonStandardChat = Array.from({ length: 4 }, (_, i) =>
    `[U] 请写第${i + 1}章\n[B] ${"正文片段".repeat(500)}`,
  ).join("\n\n");

  it("falls back to LLM with custom samples when rules fail (non-standard format path)", async () => {
    const llm = makeLlm(JSON.stringify({
      isChat: true,
      matchKnownFormat: null,
      customUserSample: "[U]",
      customAssistantSample: "[B]",
    }));
    const result = await analyzeFile(nonStandardChat, "chat.md", {
      useAiAssist: true,
      llmProvider: llm,
    });
    expect(result.mode).toBe("chat");
    expect(result.chatFormat).toBe("LLM Detected");
    expect(result.stats.estimatedChapters).toBe(4);
    expect(llm.generate).toHaveBeenCalledTimes(1);
  });

  // 注：matchKnownFormat 路径的 integration 测试无法自然构造（规则 detectChatFormat 如果能命中某 KNOWN pattern ≥2 次，
  // 会抢在 LLM 之前返回；反之规则 miss 就意味着 KNOWN pattern 都命中不了 ≥2 次，LLM 就算选 known 也会被 validateChatFormat
  // 拦截）。所以集成层只测 custom 路径 + matchKnownFormat 被 validate 拦截的幻觉守卫；单元层（chat_parser.test.ts）覆盖 matchKnownFormat 解析。

  it("skips LLM when useAiAssist is off (falls back to pure text)", async () => {
    const llm = makeLlm(JSON.stringify({ isChat: true, matchKnownFormat: null, customUserSample: "[U]", customAssistantSample: "[B]" }));
    const result = await analyzeFile(nonStandardChat, "chat.md", {
      useAiAssist: false,
      llmProvider: llm,
    });
    expect(result.mode).toBe("text");
    expect(llm.generate).not.toHaveBeenCalled();
  });

  it("falls through to text mode when LLM says not a chat", async () => {
    const llm = makeLlm(JSON.stringify({ isChat: false, matchKnownFormat: null, customUserSample: null, customAssistantSample: null }));
    const result = await analyzeFile(nonStandardChat, "chat.md", {
      useAiAssist: true,
      llmProvider: llm,
    });
    expect(result.mode).toBe("text");
    // LLM 会被调至少一次（chat detect）；纯正文分支的 splitChapters 可能再调一次做 chapter pattern detect
    expect(llm.generate).toHaveBeenCalled();
    const firstCallPrompt = (llm.generate as ReturnType<typeof vi.fn>).mock.calls[0][0].messages[0].content as string;
    expect(firstCallPrompt).toContain("对话");
  });

  it("rejects custom samples when pattern fails ≥2 times in text (hallucination guard)", async () => {
    const llm = makeLlm(JSON.stringify({
      isChat: true,
      matchKnownFormat: null,
      customUserSample: "NEVER_APPEARS_IN_TEXT",
      customAssistantSample: "ALSO_MISSING",
    }));
    const result = await analyzeFile(nonStandardChat, "chat.md", {
      useAiAssist: true,
      llmProvider: llm,
    });
    expect(result.mode).toBe("text");
  });

  it("rejects matchKnownFormat when its pattern doesn't validate ≥2 in text (LLM chose wrong format)", async () => {
    // 文件格式其实是 [U]/[B]，但 LLM 错选 "Markdown Bold"
    const llm = makeLlm(JSON.stringify({
      isChat: true,
      matchKnownFormat: "Markdown Bold",
      customUserSample: null,
      customAssistantSample: null,
    }));
    const result = await analyzeFile(nonStandardChat, "chat.md", {
      useAiAssist: true,
      llmProvider: llm,
    });
    // [U]/[B] 不匹配 **Human:**/**Assistant:**，validateChatFormat 拦截 → 纯正文
    expect(result.mode).toBe("text");
  });

  it("fires onStage(\"llm-chat-detect\") before calling LLM", async () => {
    const llm = makeLlm(JSON.stringify({
      isChat: true,
      matchKnownFormat: null,
      customUserSample: "[U]",
      customAssistantSample: "[B]",
    }));
    const onStage = vi.fn();
    await analyzeFile(nonStandardChat, "chat.md", {
      useAiAssist: true,
      llmProvider: llm,
      onStage,
    });
    expect(onStage).toHaveBeenCalledWith("llm-chat-detect");
  });

  it("fires onStage(\"llm-chat-failed\") when LLM throws", async () => {
    const llm: LLMProvider = {
      generate: vi.fn().mockRejectedValue(new Error("network")),
      generateStream: vi.fn(),
    };
    const onStage = vi.fn();
    await analyzeFile(nonStandardChat, "chat.md", {
      useAiAssist: true,
      llmProvider: llm,
      onStage,
    });
    expect(onStage).toHaveBeenCalledWith("llm-chat-failed");
  });

  it("does NOT retry LLM in splitChapters when chat detect errored (avoid wasting API call)", async () => {
    const llm: LLMProvider = {
      generate: vi.fn().mockRejectedValue(new Error("network")),
      generateStream: vi.fn(),
    };
    await analyzeFile(nonStandardChat, "chat.md", {
      useAiAssist: true,
      llmProvider: llm,
    });
    expect(llm.generate).toHaveBeenCalledTimes(1);
  });

  it("treats \"isChat=true without format info\" as llm_error: fires failed + retry-guards downstream", async () => {
    const llm = makeLlm(JSON.stringify({
      isChat: true,
      matchKnownFormat: null,
      customUserSample: null,
      customAssistantSample: null,
    }));
    const onStage = vi.fn();
    await analyzeFile(nonStandardChat, "chat.md", {
      useAiAssist: true,
      llmProvider: llm,
      onStage,
    });
    expect(onStage).toHaveBeenCalledWith("llm-chat-failed");
    // LLM 未按 prompt 规则输出 → useAiAssist 应关闭避免 splitChapters 再调
    expect(llm.generate).toHaveBeenCalledTimes(1);
  });

  it("still retries LLM in splitChapters when chat detect returned hallucinated samples (LLM itself works)", async () => {
    const llm = makeLlm(JSON.stringify({
      isChat: true,
      matchKnownFormat: null,
      customUserSample: "NEVER_IN_TEXT",
      customAssistantSample: "ALSO_MISSING",
    }));
    await analyzeFile(nonStandardChat, "chat.md", {
      useAiAssist: true,
      llmProvider: llm,
    });
    expect((llm.generate as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("fires onStage(\"llm-chat-failed\") when LLM hallucinates samples", async () => {
    const llm = makeLlm(JSON.stringify({
      isChat: true,
      matchKnownFormat: null,
      customUserSample: "NEVER_IN_TEXT",
      customAssistantSample: "ALSO_MISSING",
    }));
    const onStage = vi.fn();
    await analyzeFile(nonStandardChat, "chat.md", {
      useAiAssist: true,
      llmProvider: llm,
      onStage,
    });
    expect(onStage).toHaveBeenCalledWith("llm-chat-failed");
  });

  it("does NOT fire llm-chat-failed when LLM legitimately says not a chat", async () => {
    const llm = makeLlm(JSON.stringify({ isChat: false, matchKnownFormat: null, customUserSample: null, customAssistantSample: null }));
    const onStage = vi.fn();
    await analyzeFile(nonStandardChat, "chat.md", {
      useAiAssist: true,
      llmProvider: llm,
      onStage,
    });
    expect(onStage).toHaveBeenCalledWith("llm-chat-detect");
    expect(onStage).not.toHaveBeenCalledWith("llm-chat-failed");
  });

  it("skips LLM chat detection when rules already matched", async () => {
    const text = Array.from({ length: 4 }, (_, i) =>
      `User: 写第${i + 1}章\nAssistant: ${"内容".repeat(500)}`,
    ).join("\n\n");
    const llm = makeLlm(JSON.stringify({ isChat: true, matchKnownFormat: "User/Assistant", customUserSample: null, customAssistantSample: null }));
    const onStage = vi.fn();
    const result = await analyzeFile(text, "chat.txt", {
      useAiAssist: true,
      llmProvider: llm,
      onStage,
    });
    expect(result.mode).toBe("chat");
    expect(result.chatFormat).toBe("User/Assistant");
    expect(llm.generate).not.toHaveBeenCalled();
    expect(onStage).not.toHaveBeenCalledWith("llm-chat-detect");
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
