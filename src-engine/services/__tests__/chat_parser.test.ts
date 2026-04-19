// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, vi } from "vitest";
import {
  detectChatFormat,
  splitByRole,
  classifyTurns,
  isJsonChatExport,
  parseChatExport,
  validateChatFormat,
  llmDetectChatStructure,
  buildChatFormatFromSamples,
  DEFAULT_THRESHOLDS,
  type ClassificationThresholds,
} from "../chat_parser.js";
import type { LLMProvider } from "../../llm/provider.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function repeat(template: string, n: number): string {
  return Array.from({ length: n }, () => template).join("\n\n");
}

function makeChat(pairs: [string, string][], userLabel = "User", aiLabel = "Assistant"): string {
  return pairs.map(([u, a]) => `${userLabel}: ${u}\n${aiLabel}: ${a}`).join("\n\n");
}

// ---------------------------------------------------------------------------
// detectChatFormat
// ---------------------------------------------------------------------------

describe("detectChatFormat", () => {
  it("#1: detects User/Assistant format (English)", () => {
    const text = makeChat(
      [["hello", "hi there"], ["continue", "sure thing"], ["more", "here you go"]],
    );
    const fmt = detectChatFormat(text);
    expect(fmt).not.toBeNull();
    expect(fmt!.name).toBe("User/Assistant");
  });

  it("#2: detects 用户/助手 format (Chinese)", () => {
    const text = repeat("用户：你好\n助手：你好呀", 3);
    const fmt = detectChatFormat(text);
    expect(fmt).not.toBeNull();
    expect(fmt!.name).toBe("用户/助手");
  });

  it("#3: detects Chatbox format", () => {
    const text = repeat("> User\nhello\n> Assistant\nhi there", 3);
    const fmt = detectChatFormat(text);
    expect(fmt).not.toBeNull();
    expect(fmt!.name).toBe("Chatbox");
  });

  it("detects Markdown heading format", () => {
    const text = repeat("### User\nhello\n### Assistant\nhi there", 3);
    const fmt = detectChatFormat(text);
    expect(fmt).not.toBeNull();
    expect(fmt!.name).toBe("Markdown");
  });

  it("#5: returns null for plain text without chat markers", () => {
    const text = "这是一篇普通的小说正文，没有任何对话标记。角色们在月光下行走。";
    expect(detectChatFormat(text)).toBeNull();
  });

  it("#6: does not detect with only 1 occurrence", () => {
    const text = "User: hello\nAssistant: hi";
    expect(detectChatFormat(text)).toBeNull();
  });

  it("returns null for empty/short content", () => {
    expect(detectChatFormat("")).toBeNull();
    expect(detectChatFormat("short")).toBeNull();
  });

  it("detects Human/Claude format", () => {
    const text = repeat("Human: hello\nClaude: hi there", 3);
    const fmt = detectChatFormat(text);
    expect(fmt).not.toBeNull();
    expect(fmt!.name).toBe("User/Assistant");
  });

  it("detects DeepSeek format", () => {
    const text = repeat("User: hello\nDeepSeek: hi there", 3);
    const fmt = detectChatFormat(text);
    expect(fmt).not.toBeNull();
  });

  it("detects Markdown heading with trailing colon (### You:)", () => {
    const text = repeat("### You:\nhello\n### Claude:\nhi there", 3);
    const fmt = detectChatFormat(text);
    expect(fmt).not.toBeNull();
    expect(fmt!.name).toBe("Markdown");
  });

  it("detects Markdown heading with single-letter Q/A", () => {
    const text = repeat("## Q\nhello\n## A\nhi there", 3);
    const fmt = detectChatFormat(text);
    expect(fmt).not.toBeNull();
    expect(fmt!.name).toBe("Markdown");
  });

  it("does not misfire on Markdown heading with words starting with Q/A", () => {
    const text = repeat("## Question\nabc\n## Answer\ndef", 3);
    const fmt = detectChatFormat(text);
    // Question/Answer 不在白名单里，Q/A 受 (?![a-zA-Z]) 保护 → 不命中
    expect(fmt).toBeNull();
  });

  it("detects Markdown Bold format (**Human:**)", () => {
    const text = repeat("**Human:** hello\n\n**Assistant:** hi there", 3);
    const fmt = detectChatFormat(text);
    expect(fmt).not.toBeNull();
    expect(fmt!.name).toBe("Markdown Bold");
  });

  it("detects Markdown Bold with Chinese roles (**问:** / **答:**)", () => {
    const text = repeat("**问：** 你好\n\n**答：** 你好呀", 3);
    const fmt = detectChatFormat(text);
    expect(fmt).not.toBeNull();
    expect(fmt!.name).toBe("Markdown Bold");
  });

  it("detects Markdown Bold with colon outside (**Human**:)", () => {
    const text = repeat("**Human**: hello\n\n**Assistant**: hi", 3);
    const fmt = detectChatFormat(text);
    expect(fmt).not.toBeNull();
    expect(fmt!.name).toBe("Markdown Bold");
  });
});

// ---------------------------------------------------------------------------
// splitByRole
// ---------------------------------------------------------------------------

describe("splitByRole", () => {
  it("splits User/Assistant conversation into turns", () => {
    const text = "User: 你好\nAssistant: 你好，有什么可以帮你的？\n\nUser: 继续\nAssistant: 好的";
    const fmt = detectChatFormat(text + "\n\nUser: a\nAssistant: b")!;
    const turns = splitByRole(text + "\n\nUser: a\nAssistant: b", fmt);
    expect(turns.length).toBeGreaterThanOrEqual(4);
    expect(turns.filter(t => t.role === "user").length).toBeGreaterThanOrEqual(2);
    expect(turns.filter(t => t.role === "assistant").length).toBeGreaterThanOrEqual(2);
  });

  it("preserves preamble as assistant turn", () => {
    const text = "这是一段前言\n\nUser: 你好\nAssistant: 嗨\n\nUser: ok\nAssistant: yep";
    const fmt = detectChatFormat(text)!;
    const turns = splitByRole(text, fmt);
    expect(turns[0].role).toBe("assistant");
    expect(turns[0].content).toContain("前言");
  });

  it("handles content with no markers", () => {
    const fmt = { name: "test", userPattern: /^User:/im, assistantPattern: /^Assistant:/im };
    const turns = splitByRole("no markers here", fmt);
    expect(turns).toHaveLength(0);
  });

  it("correctly assigns charCount", () => {
    const text = "User: 短消息\nAssistant: " + "A".repeat(1000) + "\n\nUser: 继续\nAssistant: ok";
    const fmt = detectChatFormat(text)!;
    const turns = splitByRole(text, fmt);
    const longTurn = turns.find(t => t.charCount >= 1000);
    expect(longTurn).toBeDefined();
    expect(longTurn!.role).toBe("assistant");
  });
});

// ---------------------------------------------------------------------------
// classifyTurns
// ---------------------------------------------------------------------------

describe("classifyTurns", () => {
  function makeTurns(specs: { role: "user" | "assistant"; chars: number }[]): import("../chat_parser.js").ChatTurn[] {
    return specs.map((s, i) => ({
      index: i,
      role: s.role,
      content: "A".repeat(s.chars),
      charCount: s.chars,
    }));
  }

  it("#7: user message → skip", () => {
    const turns = makeTurns([{ role: "user", chars: 120 }]);
    const classified = classifyTurns(turns);
    expect(classified[0].classification).toBe("skip");
    expect(classified[0].assignedType).toBe("skip");
    expect(classified[0].reason).toEqual({ type: "user_message" });
  });

  it("#8: AI reply ≥ 1500 chars → chapter", () => {
    const turns = makeTurns([{ role: "assistant", chars: 2800 }]);
    const classified = classifyTurns(turns);
    expect(classified[0].classification).toBe("chapter");
    expect(classified[0].assignedChapter).toBe(1);
    expect(classified[0].assignedType).toBe("chapter");
  });

  it("#9: AI reply ≤ 300 chars → skip", () => {
    const turns = makeTurns([{ role: "assistant", chars: 150 }]);
    const classified = classifyTurns(turns);
    expect(classified[0].classification).toBe("skip");
  });

  it("#10: AI reply between thresholds → uncertain", () => {
    const turns = makeTurns([{ role: "assistant", chars: 800 }]);
    const classified = classifyTurns(turns);
    expect(classified[0].classification).toBe("uncertain");
    expect(classified[0].assignedType).toBe("skip"); // default
  });

  it("#11: custom thresholds chapterMin=500 → 800 chars becomes chapter", () => {
    const turns = makeTurns([{ role: "assistant", chars: 800 }]);
    const thresholds: ClassificationThresholds = { chapterMinChars: 500, skipMaxChars: 200 };
    const classified = classifyTurns(turns, thresholds);
    expect(classified[0].classification).toBe("chapter");
    expect(classified[0].assignedChapter).toBe(1);
  });

  it("chapter numbering increments correctly", () => {
    const turns = makeTurns([
      { role: "user", chars: 10 },
      { role: "assistant", chars: 2000 },
      { role: "user", chars: 10 },
      { role: "assistant", chars: 3000 },
      { role: "user", chars: 10 },
      { role: "assistant", chars: 1800 },
    ]);
    const classified = classifyTurns(turns);
    const chapters = classified.filter(t => t.classification === "chapter");
    expect(chapters).toHaveLength(3);
    expect(chapters[0].assignedChapter).toBe(1);
    expect(chapters[1].assignedChapter).toBe(2);
    expect(chapters[2].assignedChapter).toBe(3);
  });

  it("startChapter parameter offsets numbering", () => {
    const turns = makeTurns([{ role: "assistant", chars: 2000 }]);
    const classified = classifyTurns(turns, DEFAULT_THRESHOLDS, 60);
    expect(classified[0].assignedChapter).toBe(60);
  });

  it("mixed conversation produces correct stats", () => {
    const turns = makeTurns([
      { role: "user", chars: 50 },      // skip (user)
      { role: "assistant", chars: 2500 }, // chapter 1
      { role: "user", chars: 5 },        // skip (user)
      { role: "assistant", chars: 100 },  // skip (short)
      { role: "user", chars: 30 },       // skip (user)
      { role: "assistant", chars: 700 },  // uncertain
      { role: "user", chars: 10 },       // skip (user)
      { role: "assistant", chars: 2000 }, // chapter 2
    ]);
    const classified = classifyTurns(turns);
    expect(classified.filter(t => t.classification === "chapter")).toHaveLength(2);
    expect(classified.filter(t => t.classification === "skip")).toHaveLength(5);
    expect(classified.filter(t => t.classification === "uncertain")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// JSON chat export
// ---------------------------------------------------------------------------

describe("isJsonChatExport", () => {
  it("#4: detects ChatGPT mapping format", () => {
    const data = {
      title: "Test",
      mapping: {
        node1: { message: { author: { role: "user" }, content: { parts: ["hello"] } } },
        node2: { message: { author: { role: "assistant" }, content: { parts: ["hi"] } } },
      },
    };
    expect(isJsonChatExport(data)).toBe(true);
  });

  it("detects simple array format", () => {
    const data = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    expect(isJsonChatExport(data)).toBe(true);
  });

  it("rejects non-chat JSON", () => {
    expect(isJsonChatExport({ name: "test" })).toBe(false);
    expect(isJsonChatExport(null)).toBe(false);
    expect(isJsonChatExport([])).toBe(false);
    expect(isJsonChatExport([{ foo: "bar" }])).toBe(false);
  });
});

describe("parseChatExport", () => {
  it("parses ChatGPT mapping format", () => {
    const data = {
      mapping: {
        a: { message: { author: { role: "user" }, content: { parts: ["hello"] } } },
        b: { message: { author: { role: "assistant" }, content: { parts: ["hi there"] } } },
        c: { message: null }, // system node, should be skipped
      },
    };
    const turns = parseChatExport(data);
    expect(turns).toHaveLength(2);
    expect(turns[0].role).toBe("user");
    expect(turns[0].content).toBe("hello");
    expect(turns[1].role).toBe("assistant");
    expect(turns[1].content).toBe("hi there");
  });

  it("parses simple array format", () => {
    const data = [
      { role: "user", content: "问题" },
      { role: "assistant", content: "回答" },
      { role: "user", content: "继续" },
      { role: "assistant", content: "好的" },
    ];
    const turns = parseChatExport(data);
    expect(turns).toHaveLength(4);
    expect(turns[0].role).toBe("user");
    expect(turns[1].role).toBe("assistant");
  });

  it("handles empty/invalid data", () => {
    expect(parseChatExport(null)).toEqual([]);
    expect(parseChatExport({})).toEqual([]);
    expect(parseChatExport([])).toEqual([]);
  });

  it("skips empty content entries", () => {
    const data = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "" },      // should be skipped
      { role: "assistant", content: "   " },   // should be skipped (whitespace only)
      { role: "assistant", content: "valid" },
    ];
    const turns = parseChatExport(data);
    expect(turns).toHaveLength(2);
  });

  it("normalizes human role to user", () => {
    const data = [
      { role: "human", content: "hello" },
      { role: "assistant", content: "hi" },
    ];
    const turns = parseChatExport(data);
    expect(turns[0].role).toBe("user");
  });
});

// ---------------------------------------------------------------------------
// LLM-assisted chat detection
// ---------------------------------------------------------------------------

function makeMockLlm(content: string): LLMProvider {
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

describe("buildChatFormatFromSamples", () => {
  it("constructs pattern from plain samples", () => {
    const fmt = buildChatFormatFromSamples("User:", "Assistant:");
    expect(fmt).not.toBeNull();
    expect(fmt!.name).toBe("LLM Detected");
    expect(fmt!.userPattern.test("User: hello")).toBe(true);
    expect(fmt!.assistantPattern.test("Assistant: hi")).toBe(true);
  });

  it("escapes regex metacharacters in sample", () => {
    const fmt = buildChatFormatFromSamples("**Human:**", "**AI:**");
    expect(fmt).not.toBeNull();
    expect(fmt!.userPattern.test("**Human:** hello")).toBe(true);
    // 避免 ** 被当作正则 meta 字符：字面量 **X:** 不能匹配任意 X 包裹内容
    expect(fmt!.userPattern.test("YHumanX hello")).toBe(false);
  });

  it("returns null when samples are identical", () => {
    expect(buildChatFormatFromSamples("X:", "X:")).toBeNull();
  });

  it("returns null when either sample is empty after trim", () => {
    expect(buildChatFormatFromSamples("", "Assistant:")).toBeNull();
    expect(buildChatFormatFromSamples("User:", "   ")).toBeNull();
  });
});

describe("validateChatFormat", () => {
  it("requires each side to appear ≥ 2 times", () => {
    const fmt = buildChatFormatFromSamples("Q:", "A:")!;
    expect(validateChatFormat("Q: hi\nA: ok\nQ: more\nA: sure", fmt)).toBe(true);
    expect(validateChatFormat("Q: hi\nA: ok", fmt)).toBe(false); // 各 1 次
  });

  it("rejects text where only one side repeats", () => {
    const fmt = buildChatFormatFromSamples("User:", "Bot:")!;
    expect(validateChatFormat("User: a\nUser: b\nUser: c\nBot: x", fmt)).toBe(false);
  });
});

describe("llmDetectChatStructure", () => {
  it("parses valid LLM response", async () => {
    const llm = makeMockLlm(JSON.stringify({
      isChat: true,
      userSample: "**Human:**",
      assistantSample: "**Assistant:**",
    }));
    const result = await llmDetectChatStructure("**Human:** hi\n**Assistant:** hello", llm);
    expect(result.isChat).toBe(true);
    expect(result.userSample).toBe("**Human:**");
    expect(result.assistantSample).toBe("**Assistant:**");
  });

  it("strips markdown code fence from LLM response", async () => {
    const llm = makeMockLlm("```json\n" + JSON.stringify({
      isChat: true,
      userSample: "You:",
      assistantSample: "Bot:",
    }) + "\n```");
    const result = await llmDetectChatStructure("text", llm);
    expect(result.isChat).toBe(true);
    expect(result.userSample).toBe("You:");
  });

  it("returns isChat=false when LLM says not a chat", async () => {
    const llm = makeMockLlm(JSON.stringify({
      isChat: false,
      userSample: null,
      assistantSample: null,
    }));
    const result = await llmDetectChatStructure("plain novel text", llm);
    expect(result.isChat).toBe(false);
    expect(result.userSample).toBeNull();
  });

  it("returns isChat=false when LLM returns missing samples despite isChat=true", async () => {
    const llm = makeMockLlm(JSON.stringify({
      isChat: true,
      userSample: "Human:",
      assistantSample: null,
    }));
    const result = await llmDetectChatStructure("text", llm);
    expect(result.isChat).toBe(false);
  });

  it("returns isChat=false on invalid JSON", async () => {
    const llm = makeMockLlm("not json");
    const result = await llmDetectChatStructure("text", llm);
    expect(result.isChat).toBe(false);
  });

  it("tolerates LLM adding prose around JSON (common with weaker models)", async () => {
    const llm = makeMockLlm('好的，根据分析：\n{"isChat": true, "userSample": "Q:", "assistantSample": "A:"}\n希望有帮助！');
    const result = await llmDetectChatStructure("text", llm);
    expect(result.isChat).toBe(true);
    expect(result.userSample).toBe("Q:");
    expect(result.assistantSample).toBe("A:");
  });

  it("tolerates LLM wrapping JSON with prose and indentation", async () => {
    const llm = makeMockLlm('Here is the result:\n\n    {"isChat": false, "userSample": null, "assistantSample": null}\n\nDone.');
    const result = await llmDetectChatStructure("text", llm);
    expect(result.isChat).toBe(false);
  });

  it("returns isChat=false when response has no JSON braces at all", async () => {
    const llm = makeMockLlm("I analyzed the text and I think it is a chat.");
    const result = await llmDetectChatStructure("text", llm);
    expect(result.isChat).toBe(false);
  });

  it("returns isChat=false when provider throws", async () => {
    const llm: LLMProvider = {
      generate: vi.fn().mockRejectedValue(new Error("network")),
      generateStream: vi.fn(),
    };
    const result = await llmDetectChatStructure("text", llm);
    expect(result.isChat).toBe(false);
  });

  it("truncates input to 3000 chars when calling LLM", async () => {
    const llm = makeMockLlm(JSON.stringify({ isChat: false, userSample: null, assistantSample: null }));
    const longText = "a".repeat(10000);
    await llmDetectChatStructure(longText, llm);
    const call = (llm.generate as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const userMsg = call.messages[0].content as string;
    expect(userMsg).toContain("a".repeat(3000));
    expect(userMsg).not.toContain("a".repeat(3001));
  });
});
