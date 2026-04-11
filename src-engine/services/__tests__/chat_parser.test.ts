// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import {
  detectChatFormat,
  splitByRole,
  classifyTurns,
  isJsonChatExport,
  parseChatExport,
  DEFAULT_THRESHOLDS,
  type ClassificationThresholds,
} from "../chat_parser.js";

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
    expect(classified[0].reason).toBe("用户消息");
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
