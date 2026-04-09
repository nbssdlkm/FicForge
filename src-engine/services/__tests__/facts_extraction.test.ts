// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { parseLLMOutput, extract_facts_from_chapter } from "../facts_extraction.js";
import type { LLMProvider, LLMResponse, LLMChunk, GenerateParams } from "../../llm/provider.js";

describe("parseLLMOutput", () => {
  it("parses standard JSON array", () => {
    const result = parseLLMOutput('[{"content_clean": "test"}]');
    expect(result).toHaveLength(1);
    expect(result[0].content_clean).toBe("test");
  });

  it("parses markdown code block wrapped JSON", () => {
    const result = parseLLMOutput('```json\n[{"content_clean": "test"}]\n```');
    expect(result).toHaveLength(1);
  });

  it("returns empty on invalid JSON", () => {
    expect(parseLLMOutput("not json")).toEqual([]);
  });

  it("returns empty on non-array JSON", () => {
    expect(parseLLMOutput('{"key": "value"}')).toEqual([]);
  });

  it("handles incomplete code block markers", () => {
    const result = parseLLMOutput('```json\n[{"content_clean": "test"}]');
    expect(result).toHaveLength(1);
  });
});

describe("extract_facts_from_chapter", () => {
  const mockProvider: LLMProvider = {
    async generate(params: GenerateParams): Promise<LLMResponse> {
      return {
        content: JSON.stringify([
          { content_raw: "第1章 Alice遇到Bob", content_clean: "Alice遇到Bob", characters: ["Alice"], type: "plot_event", status: "active", narrative_weight: "high" },
          { content_raw: "第1章 线索", content_clean: "神秘线索出现", characters: [], type: "foreshadowing", status: "unresolved", narrative_weight: "medium" },
        ]),
        model: "test",
        input_tokens: 100,
        output_tokens: 50,
        finish_reason: "stop",
      };
    },
    async *generateStream(): AsyncIterable<LLMChunk> { /* not used */ },
  };

  it("extracts facts from chapter", async () => {
    const results = await extract_facts_from_chapter(
      "Alice走进房间，看到了Bob。他们发现了一条线索。",
      1, [], { characters: ["Alice", "Bob"] }, null,
      mockProvider, null,
    );

    expect(results).toHaveLength(2);
    expect(results[0].content_clean).toBe("Alice遇到Bob");
    expect(results[1].fact_type).toBe("foreshadowing");
  });

  it("returns empty for empty chapter", async () => {
    const results = await extract_facts_from_chapter(
      "", 1, [], { characters: [] }, null, mockProvider, null,
    );
    expect(results).toEqual([]);
  });

  it("caps at 5 facts per chapter", async () => {
    const manyFactsProvider: LLMProvider = {
      async generate(): Promise<LLMResponse> {
        const facts = Array.from({ length: 10 }, (_, i) => ({
          content_raw: `fact ${i}`, content_clean: `fact content ${i}`,
          type: "plot_event", status: "active",
        }));
        return { content: JSON.stringify(facts), model: "test", input_tokens: 0, output_tokens: 0, finish_reason: "stop" };
      },
      async *generateStream(): AsyncIterable<LLMChunk> {},
    };

    const results = await extract_facts_from_chapter(
      "Long chapter text here. " + "Content. ".repeat(100),
      1, [], { characters: [] }, null, manyFactsProvider, null,
    );
    expect(results.length).toBeLessThanOrEqual(5);
  });
});
