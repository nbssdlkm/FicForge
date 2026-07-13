// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, vi, afterEach } from "vitest";
import { parseLLMOutput, extractFactsFromChapter, buildCharacterInfoBlock } from "../facts_extraction.js";
import type { LLMProvider, LLMResponse, LLMChunk, GenerateParams } from "../../llm/provider.js";
import { initLogger } from "../../logger/index.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";

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

describe("extractFactsFromChapter", () => {
  const mockProvider: LLMProvider = {
    async generate(params: GenerateParams): Promise<LLMResponse> {
      return {
        content: JSON.stringify([
          {
            content_raw: "第1章 Alice遇到Bob",
            content_clean: "Alice遇到Bob",
            characters: ["Alice"],
            type: "plot_event",
            status: "active",
            narrative_weight: "high",
          },
          {
            content_raw: "第1章 线索",
            content_clean: "神秘线索出现",
            characters: [],
            type: "foreshadowing",
            status: "unresolved",
            narrative_weight: "medium",
          },
        ]),
        model: "test",
        input_tokens: 100,
        output_tokens: 50,
        finish_reason: "stop",
      };
    },
    async *generateStream(): AsyncIterable<LLMChunk> {
      /* not used */
    },
  };

  it("extracts facts from chapter", async () => {
    const results = await extractFactsFromChapter({
      chapter_text: "Alice走进房间，看到了Bob。他们发现了一条线索。",
      chapter_num: 1,
      existing_facts: [],
      cast_registry: { characters: ["Alice", "Bob"] },
      character_aliases: null,
      llm_provider: mockProvider,
      llm_config: null,
    });

    expect(results).toHaveLength(2);
    expect(results[0].content_clean).toBe("Alice遇到Bob");
    expect(results[1].fact_type).toBe("foreshadowing");
  });

  it("returns empty for empty chapter", async () => {
    const results = await extractFactsFromChapter({
      chapter_text: "",
      chapter_num: 1,
      existing_facts: [],
      cast_registry: { characters: [] },
      character_aliases: null,
      llm_provider: mockProvider,
      llm_config: null,
    });
    expect(results).toEqual([]);
  });

  it("caps at 5 facts per chapter", async () => {
    const manyFactsProvider: LLMProvider = {
      async generate(): Promise<LLMResponse> {
        const facts = Array.from({ length: 10 }, (_, i) => ({
          content_raw: `fact ${i}`,
          content_clean: `fact content ${i}`,
          type: "plot_event",
          status: "active",
        }));
        return {
          content: JSON.stringify(facts),
          model: "test",
          input_tokens: 0,
          output_tokens: 0,
          finish_reason: "stop",
        };
      },
      async *generateStream(): AsyncIterable<LLMChunk> {},
    };

    const results = await extractFactsFromChapter({
      chapter_text: "Long chapter text here. " + "Content. ".repeat(100),
      chapter_num: 1,
      existing_facts: [],
      cast_registry: { characters: [] },
      character_aliases: null,
      llm_provider: manyFactsProvider,
      llm_config: null,
    });
    expect(results.length).toBeLessThanOrEqual(5);
  });
});

describe("extractFactsFromChapter LLM 失败可观测（盲审 R3 M13）", () => {
  afterEach(() => vi.restoreAllMocks());

  it("LLM 调用失败时经 logCatch 记警（不再静默黑洞），仍返回空", async () => {
    const logger = initLogger(new MockAdapter(), "data");
    const warnSpy = vi.spyOn(logger, "warn");
    const boomProvider: LLMProvider = {
      async generate(): Promise<LLMResponse> {
        throw new Error("LLM backend down");
      },
      async *generateStream(): AsyncIterable<LLMChunk> {},
    };

    const results = await extractFactsFromChapter({
      chapter_text: "Alice走进房间。",
      chapter_num: 1,
      existing_facts: [],
      cast_registry: { characters: ["Alice"] },
      character_aliases: null,
      llm_provider: boomProvider,
      llm_config: null,
    });

    expect(results).toEqual([]);
    // 至少一条 facts_extraction 维的告警，携带底层错误信息
    expect(warnSpy).toHaveBeenCalledWith(
      "facts_extraction",
      expect.stringContaining("chunk"),
      expect.objectContaining({ error: expect.stringContaining("LLM backend down") }),
    );
  });

  it("用户中断（AbortError）不记警（abort 是主动取消、非错误）", async () => {
    const logger = initLogger(new MockAdapter(), "data");
    const warnSpy = vi.spyOn(logger, "warn");
    const abortProvider: LLMProvider = {
      async generate(): Promise<LLMResponse> {
        throw new DOMException("Aborted", "AbortError");
      },
      async *generateStream(): AsyncIterable<LLMChunk> {},
    };

    const results = await extractFactsFromChapter({
      chapter_text: "Alice走进房间。",
      chapter_num: 1,
      existing_facts: [],
      cast_registry: { characters: ["Alice"] },
      character_aliases: null,
      llm_provider: abortProvider,
      llm_config: null,
    });

    expect(results).toEqual([]);
    expect(warnSpy).not.toHaveBeenCalledWith("facts_extraction", expect.anything(), expect.anything());
  });
});

describe("角色别名表接通（M3 别名表批）", () => {
  it("buildCharacterInfoBlock：有别名渲别名行，无别名角色照常列出", () => {
    const block = buildCharacterInfoBlock({ characters: ["林晚月", "阿福"] }, { 林晚月: ["月月", "晚晚"] });
    expect(block).toContain("林晚月");
    expect(block).toContain("月月");
    expect(block).toContain("晚晚");
    expect(block).toContain("- 阿福");
  });

  it("buildCharacterInfoBlock：cast_registry 为空时即使供了别名表也返回空串（不渲残段）", () => {
    expect(buildCharacterInfoBlock({ characters: [] }, { 林晚月: ["月月"] })).toBe("");
    expect(buildCharacterInfoBlock({}, { 林晚月: ["月月"] })).toBe("");
  });

  it("extractFactsFromChapter：别名进提取 prompt，提取结果按表归一化", async () => {
    let prompt = "";
    const provider: LLMProvider = {
      async generate(params: GenerateParams): Promise<LLMResponse> {
        prompt = params.messages.map((m) => m.content).join("\n");
        return {
          content: JSON.stringify([
            {
              content_raw: "月月走进了房间",
              content_clean: "月月走进了房间",
              characters: ["月月"],
              known_to: ["月月"],
              type: "plot_event",
              status: "active",
              narrative_weight: "medium",
            },
          ]),
          model: "t",
          input_tokens: 0,
          output_tokens: 0,
          finish_reason: "stop",
        };
      },
      async *generateStream(): AsyncIterable<LLMChunk> {},
    };

    const results = await extractFactsFromChapter({
      chapter_text: "月月走进房间。",
      chapter_num: 1,
      existing_facts: [],
      cast_registry: { characters: ["林晚月"] },
      character_aliases: { 林晚月: ["月月"] },
      llm_provider: provider,
      llm_config: null,
    });

    expect(prompt).toContain("月月"); // 【已知角色名和别名】段真的渲进了 user message
    expect(results[0].characters).toEqual(["林晚月"]); // rawToExtracted 归一化
    expect(results[0].known_to).toEqual(["林晚月"]); // 知情名单同表归一化
  });
});
