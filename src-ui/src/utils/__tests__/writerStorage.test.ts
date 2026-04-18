// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  readSavedContextSummaries,
  saveContextSummaries,
  readSavedGenerateRequest,
  saveGenerateRequest,
  getSkipFactsPromptDefault,
  setSkipFactsPromptPersisted,
  hasSeenSettingsModeTooltip,
  markSettingsModeTooltipSeen,
} from "../writerStorage";

// Mock localStorage
const store = new Map<string, string>();
const mockLocalStorage = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => store.set(key, value)),
  removeItem: vi.fn((key: string) => store.delete(key)),
};

Object.defineProperty(globalThis, "window", {
  value: { localStorage: mockLocalStorage },
  writable: true,
});
Object.defineProperty(globalThis, "localStorage", {
  value: mockLocalStorage,
  writable: true,
});

describe("writerStorage", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Context Summary
  // ---------------------------------------------------------------------------

  it("saveContextSummaries + readSavedContextSummaries roundtrip", () => {
    const summaries = {
      "draft_a": {
        characters_used: ["Alice"],
        worldbuilding_used: ["magic"],
        facts_injected: 3,
        facts_as_focus: ["f1"],
        pinned_count: 1,
        rag_chunks_retrieved: 2,
        rag_chunks: [],
        total_input_tokens: 1000,
        truncated_layers: [],
        truncated_characters: [],
      },
    };
    saveContextSummaries("au1", 1, summaries);
    const result = readSavedContextSummaries("au1", 1);
    expect(result).toEqual(summaries);
  });

  it("roundtrip preserves valid rag_chunks", () => {
    const summaries = {
      "draft_a": {
        characters_used: [],
        worldbuilding_used: [],
        facts_injected: 0,
        facts_as_focus: [],
        pinned_count: 0,
        rag_chunks_retrieved: 2,
        rag_chunks: [
          { content: "alpha", collection: "chapters" as const, score: 0.8, chapter_num: 3 },
          { content: "beta", collection: "characters" as const, score: 0.6, source_file: "lin.md" },
        ],
        total_input_tokens: 100,
        truncated_layers: [],
        truncated_characters: [],
      },
    };
    saveContextSummaries("au1", 1, summaries);
    expect(readSavedContextSummaries("au1", 1)).toEqual(summaries);
  });

  it("normalize drops invalid rag_chunks elements (unknown collection / NaN / missing content)", () => {
    const stored = {
      "draft_a": {
        characters_used: [],
        worldbuilding_used: [],
        facts_injected: 0,
        facts_as_focus: [],
        pinned_count: 0,
        rag_chunks_retrieved: 4,
        rag_chunks: [
          { content: "ok", collection: "chapters", score: 0.5, chapter_num: 1 },
          { content: "bad-score", collection: "chapters", score: Number.NaN },
          { content: "bad-coll", collection: "mystery", score: 0.3 },
          { collection: "chapters", score: 0.4 }, // no content
        ],
        total_input_tokens: 0,
        truncated_layers: [],
        truncated_characters: [],
      },
    };
    store.set("ficforge.writer.contextSummary:au1:1", JSON.stringify(stored));
    const result = readSavedContextSummaries("au1", 1);
    expect(result.draft_a.rag_chunks).toEqual([
      { content: "ok", collection: "chapters", score: 0.5, chapter_num: 1 },
    ]);
  });

  it("normalize backfills missing rag_chunks as []", () => {
    const legacy = {
      "draft_a": {
        characters_used: [],
        worldbuilding_used: [],
        facts_injected: 0,
        facts_as_focus: [],
        pinned_count: 0,
        rag_chunks_retrieved: 0,
        // rag_chunks omitted (legacy localStorage)
        total_input_tokens: 0,
        truncated_layers: [],
        truncated_characters: [],
      },
    };
    store.set("ficforge.writer.contextSummary:au1:1", JSON.stringify(legacy));
    const result = readSavedContextSummaries("au1", 1);
    expect(result.draft_a.rag_chunks).toEqual([]);
  });

  it("saveContextSummaries with empty object removes key", () => {
    saveContextSummaries("au1", 1, { "x": { characters_used: [], worldbuilding_used: [], facts_injected: 0, facts_as_focus: [], pinned_count: 0, rag_chunks_retrieved: 0, rag_chunks: [], total_input_tokens: 0, truncated_layers: [], truncated_characters: [] } });
    saveContextSummaries("au1", 1, {});
    expect(mockLocalStorage.removeItem).toHaveBeenCalled();
  });

  it("readSavedContextSummaries returns {} on bad JSON", () => {
    store.set("ficforge.writer.contextSummary:au1:1", "not-json");
    expect(readSavedContextSummaries("au1", 1)).toEqual({});
  });

  it("saveContextSummaries swallows localStorage error", () => {
    mockLocalStorage.setItem.mockImplementationOnce(() => { throw new Error("QuotaExceeded"); });
    expect(() => saveContextSummaries("au1", 1, { "x": { characters_used: [], worldbuilding_used: [], facts_injected: 0, facts_as_focus: [], pinned_count: 0, rag_chunks_retrieved: 0, rag_chunks: [], total_input_tokens: 0, truncated_layers: [], truncated_characters: [] } })).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Generate Request
  // ---------------------------------------------------------------------------

  it("saveGenerateRequest + readSavedGenerateRequest roundtrip", () => {
    const req = { inputType: "instruction" as const, userInput: "hello" };
    saveGenerateRequest("au1", 1, req);
    expect(readSavedGenerateRequest("au1", 1)).toEqual(req);
  });

  it("readSavedGenerateRequest returns null on bad data", () => {
    store.set("ficforge.writer.generateRequest:au1:1", '{"inputType":"bad"}');
    expect(readSavedGenerateRequest("au1", 1)).toBeNull();
  });

  it("saveGenerateRequest swallows localStorage error", () => {
    mockLocalStorage.setItem.mockImplementationOnce(() => { throw new Error("QuotaExceeded"); });
    expect(() => saveGenerateRequest("au1", 1, { inputType: "continue", userInput: "" })).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Skip Facts Prompt
  // ---------------------------------------------------------------------------

  it("getSkipFactsPromptDefault returns false by default", () => {
    expect(getSkipFactsPromptDefault()).toBe(false);
  });

  it("setSkipFactsPromptPersisted(true) → getSkipFactsPromptDefault returns true", () => {
    setSkipFactsPromptPersisted(true);
    expect(getSkipFactsPromptDefault()).toBe(true);
  });

  it("setSkipFactsPromptPersisted(false) removes key", () => {
    setSkipFactsPromptPersisted(true);
    setSkipFactsPromptPersisted(false);
    expect(getSkipFactsPromptDefault()).toBe(false);
  });

  it("getSkipFactsPromptDefault swallows localStorage error", () => {
    mockLocalStorage.getItem.mockImplementationOnce(() => { throw new Error("SecurityError"); });
    expect(getSkipFactsPromptDefault()).toBe(false);
  });

  it("setSkipFactsPromptPersisted swallows localStorage error", () => {
    mockLocalStorage.setItem.mockImplementationOnce(() => { throw new Error("QuotaExceeded"); });
    expect(() => setSkipFactsPromptPersisted(true)).not.toThrow();
  });

  // ---------------------------------------------------------------------------
  // Settings Mode Tooltip
  // ---------------------------------------------------------------------------

  it("hasSeenSettingsModeTooltip returns false when key not set", () => {
    expect(hasSeenSettingsModeTooltip()).toBe(false);
  });

  it("markSettingsModeTooltipSeen → hasSeenSettingsModeTooltip returns true", () => {
    markSettingsModeTooltipSeen();
    expect(hasSeenSettingsModeTooltip()).toBe(true);
  });

  it("hasSeenSettingsModeTooltip swallows localStorage error → returns true", () => {
    mockLocalStorage.getItem.mockImplementationOnce(() => { throw new Error("SecurityError"); });
    expect(hasSeenSettingsModeTooltip()).toBe(true);
  });

  it("markSettingsModeTooltipSeen swallows localStorage error", () => {
    mockLocalStorage.setItem.mockImplementationOnce(() => { throw new Error("QuotaExceeded"); });
    expect(() => markSettingsModeTooltipSeen()).not.toThrow();
  });
});
