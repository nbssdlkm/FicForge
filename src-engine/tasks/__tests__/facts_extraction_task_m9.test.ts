// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 批量提取任务 M9 接线测试：reactExtractionEnabled 时逐章走 ReAct（产 thread_ids），
 * 关闭时走原批量单次调用。
 */

import { describe, expect, it } from "vitest";
import { createFactsExtractionTask, type FactsExtractionParams } from "../impl/facts_extraction_task.js";
import { createFact, type Fact } from "../../domain/fact.js";
import { createThread } from "../../domain/thread.js";
import { ThreadStatus } from "../../domain/enums.js";
import type { TaskContext, TaskEvent } from "../types.js";
import type { LLMProvider, LLMChunk, LLMResponse } from "../../llm/provider.js";

function toolIter(calls: { name: string; args: object }[]): LLMChunk[] {
  const chunks: LLMChunk[] = [];
  calls.forEach((c, i) => {
    chunks.push({
      delta: "",
      tool_call_deltas: [
        { index: i, id: `c_${i}_${c.name}`, type: "function", function: { name: c.name, arguments: "" } },
      ],
      is_final: false,
      input_tokens: i === 0 ? 5 : null,
      output_tokens: null,
      finish_reason: null,
    });
    chunks.push({
      delta: "",
      tool_call_deltas: [{ index: i, function: { arguments: JSON.stringify(c.args) } }],
      is_final: false,
      input_tokens: null,
      output_tokens: null,
      finish_reason: null,
    });
  });
  chunks.push({ delta: "", is_final: true, input_tokens: null, output_tokens: 3, finish_reason: "tool_calls" });
  return chunks;
}
function scriptedProvider(iters: LLMChunk[][]): LLMProvider {
  let i = 0;
  return {
    async generate(): Promise<LLMResponse> {
      return { content: "", model: "m", input_tokens: 0, output_tokens: 0, finish_reason: "stop" };
    },
    async *generateStream(): AsyncIterable<LLMChunk> {
      const it =
        i < iters.length
          ? iters[i]
          : [{ delta: "done", is_final: true, input_tokens: 1, output_tokens: 1, finish_reason: "stop" } as LLMChunk];
      i++;
      for (const c of it) yield c;
    },
  };
}

const SEED_THREAD = createThread({ id: "t1", title: "主线", status: ThreadStatus.ACTIVE });

function mockDeps(provider: LLMProvider, facts: Fact[] = [], threads = [SEED_THREAD]) {
  return {
    chapterRepo: { get_content_only: async (_au: string, n: number) => `第${n}章正文，林晚月现身。` } as never,
    factRepo: { list_all: async () => facts } as never,
    projectRepo: { get: async () => ({ cast_registry: { characters: ["林晚月"] } }) } as never,
    threadRepo: { list: async () => threads } as never,
    llmProvider: provider,
  };
}

async function runTask(params: FactsExtractionParams, deps: ReturnType<typeof mockDeps>) {
  const task = createFactsExtractionTask(params, deps);
  const ctx: TaskContext = { signal: new AbortController().signal, saveCheckpoint: async () => {} };
  const gen = task.execute(ctx);
  let r = await gen.next();
  while (!r.done) r = (await gen.next()) as IteratorResult<TaskEvent, never>;
  return r.value;
}

describe("批量提取任务 — M9 接线", () => {
  const params = (over: Partial<FactsExtractionParams> = {}): FactsExtractionParams => ({
    auPath: "au",
    fromChapter: 1,
    toChapter: 2,
    batchSize: 2,
    language: "zh",
    ...over,
  });

  it("reactExtractionEnabled：逐章走 ReAct，每章事实带内联 thread_ids", async () => {
    // 2 章，每章 propose（内联 thread_ids）+ finalize = 4 个 generateStream 脚本
    const provider = scriptedProvider([
      toolIter([
        {
          name: "propose_facts",
          args: { facts: [{ content_clean: "第一章的事实内容", characters: ["林晚月"], thread_ids: ["t1"] }] },
        },
      ]),
      toolIter([{ name: "finalize_extraction", args: {} }]),
      toolIter([
        {
          name: "propose_facts",
          args: { facts: [{ content_clean: "第二章的事实内容", characters: ["林晚月"], thread_ids: ["t1"] }] },
        },
      ]),
      toolIter([{ name: "finalize_extraction", args: {} }]),
    ]);
    const res = await runTask(params({ reactExtractionEnabled: true }), mockDeps(provider));
    expect(res.facts).toHaveLength(2);
    expect(res.facts.every((f) => (f.thread_ids ?? []).includes("t1"))).toBe(true);
  });

  it("reactExtractionEnabled=false：走原批量单次调用（无 thread_ids）", async () => {
    // 批量路径走 extractFactsBatch（一次 generate JSON），非工具循环
    const provider: LLMProvider = {
      async generate(): Promise<LLMResponse> {
        return {
          content: JSON.stringify([{ content_clean: "批量提取的事实", characters: ["林晚月"], chapter: 1 }]),
          model: "m",
          input_tokens: 1,
          output_tokens: 1,
          finish_reason: "stop",
        };
      },
      async *generateStream(): AsyncIterable<LLMChunk> {
        yield { delta: "", is_final: true, input_tokens: 1, output_tokens: 1, finish_reason: "stop" };
      },
    };
    const res = await runTask(params({ reactExtractionEnabled: false }), mockDeps(provider));
    expect(res.facts.length).toBeGreaterThan(0);
    expect(res.facts.every((f) => (f.thread_ids ?? []).length === 0)).toBe(true);
  });

  it("characterAliases 透传：进提取 prompt 已知角色段 + 提取结果按表归一化", async () => {
    let prompt = "";
    const provider: LLMProvider = {
      async generate(p): Promise<LLMResponse> {
        prompt = p.messages.map((m) => m.content).join("\n");
        return {
          content: JSON.stringify([{ content_clean: "月月做了某事", characters: ["月月"], chapter: 1 }]),
          model: "m",
          input_tokens: 1,
          output_tokens: 1,
          finish_reason: "stop",
        };
      },
      async *generateStream(): AsyncIterable<LLMChunk> {
        yield { delta: "", is_final: true, input_tokens: 1, output_tokens: 1, finish_reason: "stop" };
      },
    };
    const res = await runTask(params({ reactExtractionEnabled: false, toChapter: 1 }), {
      ...mockDeps(provider),
      characterAliases: { 林晚月: ["月月"] },
    });
    expect(prompt).toContain("月月");
    expect(res.facts[0].characters).toEqual(["林晚月"]);
  });
});
