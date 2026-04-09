// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { build_settings_context, call_settings_llm } from "../settings_chat.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import type { LLMProvider, LLMResponse, LLMChunk, GenerateParams } from "../../llm/provider.js";

describe("build_settings_context", () => {
  it("AU mode assembles system prompt with AU name and fandom", async () => {
    const adapter = new MockAdapter();
    adapter.seed("au1/project.yaml", "name: 测试AU\nfandom: TestFandom\n");

    const result = await build_settings_context({
      mode: "au",
      base_path: "au1",
      messages: [{ role: "user", content: "创建一个角色" }],
      adapter,
    });

    expect(result[0].role).toBe("system");
    expect(result[0].content).toContain("测试AU");
    expect(result[0].content).toContain("TestFandom");
    expect(result).toHaveLength(2); // system + 1 user message
  });

  it("Fandom mode assembles system prompt with fandom name", async () => {
    const adapter = new MockAdapter();

    const result = await build_settings_context({
      mode: "fandom",
      base_path: "fandoms/HP",
      messages: [{ role: "user", content: "添加角色" }],
      adapter,
    });

    expect(result[0].role).toBe("system");
    expect(result[0].content).toContain("HP");
  });

  it("truncates history to 10 messages", async () => {
    const adapter = new MockAdapter();
    const messages = Array.from({ length: 20 }, (_, i) => ({
      role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
      content: `msg ${i}`,
    }));

    const result = await build_settings_context({
      mode: "fandom",
      base_path: "fandoms/HP",
      messages,
      adapter,
    });

    // system + last 10 messages
    expect(result).toHaveLength(11);
    expect(result[1].content).toBe("msg 10"); // first of last 10
  });

  it("includes fandom DNA summaries in AU mode", async () => {
    const adapter = new MockAdapter();
    adapter.seed("au1/project.yaml", "name: AU\nfandom: F\n");
    adapter.seed("fandom1/core_characters/Alice.md", "## 核心本质\nAlice的核心人格特质");

    const result = await build_settings_context({
      mode: "au",
      base_path: "au1",
      fandom_path: "fandom1",
      messages: [{ role: "user", content: "test" }],
      adapter,
    });

    expect(result[0].content).toContain("Alice的核心人格特质");
  });

  it("includes AU files context", async () => {
    const adapter = new MockAdapter();
    adapter.seed("au1/project.yaml", "name: AU\nfandom: F\npinned_context:\n  - 铁律一\nwriting_style:\n  perspective: first_person\n");
    adapter.seed("au1/characters/Bob.md", "# Bob\n角色设定");

    const result = await build_settings_context({
      mode: "au",
      base_path: "au1",
      messages: [{ role: "user", content: "test" }],
      adapter,
    });

    expect(result[0].content).toContain("角色设定");
    expect(result[0].content).toContain("铁律一");
    expect(result[0].content).toContain("first_person");
  });
});

describe("call_settings_llm", () => {
  it("returns content and tool_calls", async () => {
    const mockProvider: LLMProvider = {
      async generate(_params: GenerateParams): Promise<LLMResponse> {
        return {
          content: "我建议创建角色文件",
          model: "test",
          input_tokens: 100,
          output_tokens: 50,
          finish_reason: "stop",
          tool_calls: [{
            id: "tc1",
            type: "function",
            function: { name: "create_character_file", arguments: '{"name":"Alice","content":"# Alice"}' },
          }],
        };
      },
      async *generateStream(): AsyncIterable<LLMChunk> {},
    };

    const messages = [
      { role: "system" as const, content: "system prompt" },
      { role: "user" as const, content: "创建Alice角色" },
    ];

    const result = await call_settings_llm(messages, "au", mockProvider);

    expect(result.content).toBe("我建议创建角色文件");
    expect(result.tool_calls).toHaveLength(1);
    expect(result.tool_calls[0].function.name).toBe("create_character_file");
  });

  it("returns empty tool_calls when none", async () => {
    const mockProvider: LLMProvider = {
      async generate(): Promise<LLMResponse> {
        return { content: "回复", model: "test", input_tokens: 0, output_tokens: 0, finish_reason: "stop" };
      },
      async *generateStream(): AsyncIterable<LLMChunk> {},
    };

    const result = await call_settings_llm(
      [{ role: "system", content: "sys" }, { role: "user", content: "hi" }],
      "au", mockProvider,
    );

    expect(result.tool_calls).toEqual([]);
  });
});
