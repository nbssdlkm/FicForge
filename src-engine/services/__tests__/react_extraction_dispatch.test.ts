// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * M9 reactExtractFromChapter 循环测试 —— scripted mock LLM 驱动 reason→act→observe。
 *
 * 覆盖：propose→search→annotate→finalize 全链、caused_by/thread_ids 过滤防幻觉、
 * evidence grounding 门控、deviation guard 救场、maxIter degraded、per-fact 过滤。
 */

import { describe, expect, it } from "vitest";
import { reactExtractFromChapter } from "../react_extraction_dispatch.js";
import {
  REACT_TOOL_SEARCH,
  REACT_TOOL_PROPOSE,
  REACT_TOOL_ANNOTATE,
  REACT_TOOL_FINALIZE,
} from "../react_extraction_tools.js";
import { createFact, type Fact } from "../../domain/fact.js";
import { createThread } from "../../domain/thread.js";
import { ThreadStatus } from "../../domain/enums.js";
import { FileFactRepository } from "../../repositories/implementations/file_fact.js";
import { FileThreadRepository } from "../../repositories/implementations/file_thread.js";
import { FileOpsRepository } from "../../repositories/implementations/file_ops.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { add_fact } from "../facts_lifecycle.js";
import { rebuildFactsFromOps } from "../../ops/ops_projection.js";
import type { LLMProvider, LLMChunk, LLMResponse } from "../../llm/provider.js";

// 工具名常量在 scripted iter 里用到，引用一次防 unused（REACT_TOOL_SEARCH 等已在用例中使用）
void [REACT_TOOL_SEARCH, REACT_TOOL_PROPOSE, REACT_TOOL_ANNOTATE, REACT_TOOL_FINALIZE];

// 章节原文：含 evidence 子串「灵力虚弱」「结盟」用于 grounding。
const CHAPTER = "第五章。林晚月感到一阵灵力虚弱，她想起三章前那次失败的炼气。当夜她与沈砚结盟。";

function toolIter(calls: { name: string; args: object }[]): LLMChunk[] {
  const chunks: LLMChunk[] = [];
  calls.forEach((c, i) => {
    chunks.push({ delta: "", tool_call_deltas: [{ index: i, id: `call_${i}_${c.name}`, type: "function", function: { name: c.name, arguments: "" } }], is_final: false, input_tokens: i === 0 ? 10 : null, output_tokens: null, finish_reason: null });
    chunks.push({ delta: "", tool_call_deltas: [{ index: i, function: { arguments: JSON.stringify(c.args) } }], is_final: false, input_tokens: null, output_tokens: null, finish_reason: null });
  });
  chunks.push({ delta: "", is_final: true, input_tokens: null, output_tokens: 5, finish_reason: "tool_calls" });
  return chunks;
}
function textIter(text: string): LLMChunk[] {
  return [{ delta: text, is_final: true, input_tokens: 5, output_tokens: 2, finish_reason: "stop" }];
}
function scriptedProvider(iters: LLMChunk[][]): LLMProvider {
  let i = 0;
  return {
    async generate(): Promise<LLMResponse> {
      return { content: "", model: "m", input_tokens: 0, output_tokens: 0, finish_reason: "stop" };
    },
    async *generateStream(): AsyncIterable<LLMChunk> {
      const it = i < iters.length ? iters[i] : textIter("done");
      i++;
      for (const c of it) yield c;
    },
  };
}

async function seededRepos(facts: Fact[], threads: ReturnType<typeof createThread>[]) {
  const adapter = new MockAdapter();
  const factRepo = new FileFactRepository(adapter);
  for (const f of facts) await factRepo.append("au", f);
  const threadRepo = new FileThreadRepository(adapter);
  for (const t of threads) await threadRepo.add("au", t);
  return { factRepo, threadRepo };
}

const SEED_FACT = createFact({ id: "f_seed_3", content_raw: "r", content_clean: "林晚月炼气失败灵力枯竭", characters: ["林晚月"], chapter: 3 });
const SEED_THREAD = createThread({ id: "t_seed", title: "林晚月修炼线", status: ThreadStatus.ACTIVE });

const silentTelemetry = { emit() {} };

describe("reactExtractFromChapter — happy path", () => {
  it("propose→search→annotate→finalize：caused_by + thread_ids 都落到事实上，status ok", async () => {
    const { factRepo, threadRepo } = await seededRepos([SEED_FACT], [SEED_THREAD]);
    const provider = scriptedProvider([
      toolIter([{ name: REACT_TOOL_PROPOSE, args: { facts: [{ content_clean: "林晚月灵力虚弱", characters: ["林晚月"], evidence: "灵力虚弱" }] } }]),
      toolIter([{ name: REACT_TOOL_SEARCH, args: { query: "灵力", characters: ["林晚月"] } }]),
      toolIter([{ name: REACT_TOOL_ANNOTATE, args: { fact_index: 0, caused_by_fact_ids: ["f_seed_3"], thread_ids: ["t_seed"] } }]),
      toolIter([{ name: REACT_TOOL_FINALIZE, args: {} }]),
    ]);

    const res = await reactExtractFromChapter(CHAPTER, 5, [], { characters: ["林晚月"] }, null, provider, {
      factRepo, threadRepo, auPath: "au", _telemetry_override: silentTelemetry,
    });

    expect(res.status).toBe("ok");
    expect(res.facts).toHaveLength(1);
    expect(res.facts[0].caused_by).toEqual(["f_seed_3"]);
    expect(res.facts[0].thread_ids).toEqual(["t_seed"]);
    expect(res.facts[0].content_clean).toBe("林晚月灵力虚弱");
  });
});

describe("reactExtractFromChapter — 防幻觉过滤", () => {
  it("annotate 编造的 fact_id / thread_id 被丢弃（只保真实存在的）", async () => {
    const { factRepo, threadRepo } = await seededRepos([SEED_FACT], [SEED_THREAD]);
    const provider = scriptedProvider([
      toolIter([{ name: REACT_TOOL_PROPOSE, args: { facts: [{ content_clean: "某事件发生了", characters: [], evidence: "结盟" }] } }]),
      toolIter([{ name: REACT_TOOL_ANNOTATE, args: { fact_index: 0, caused_by_fact_ids: ["f_seed_3", "f_HALLUCINATED"], thread_ids: ["t_seed", "t_FAKE"] } }]),
      toolIter([{ name: REACT_TOOL_FINALIZE, args: {} }]),
    ]);
    const res = await reactExtractFromChapter(CHAPTER, 5, [], { characters: [] }, null, provider, {
      factRepo, threadRepo, auPath: "au", _telemetry_override: silentTelemetry,
    });
    expect(res.facts[0].caused_by).toEqual(["f_seed_3"]); // 幻觉 id 被丢
    expect(res.facts[0].thread_ids).toEqual(["t_seed"]);
  });

  it("ungrounded 因果边仍挂上，但标 _confidence.caused_by=low（flag 不 gate；人审兜底）", async () => {
    const { factRepo, threadRepo } = await seededRepos([SEED_FACT], [SEED_THREAD]);
    const provider = scriptedProvider([
      // evidence「皇宫夜宴」不在 CHAPTER 里 → ungrounded（content_clean 须 ≥5 字才不被 per-fact 过滤）
      toolIter([{ name: REACT_TOOL_PROPOSE, args: { facts: [{ content_clean: "这是一条无依据事实", characters: [], evidence: "皇宫夜宴" }] } }]),
      toolIter([{ name: REACT_TOOL_ANNOTATE, args: { fact_index: 0, caused_by_fact_ids: ["f_seed_3"] } }]),
      toolIter([{ name: REACT_TOOL_FINALIZE, args: {} }]),
    ]);
    const res = await reactExtractFromChapter(CHAPTER, 5, [], { characters: [] }, null, provider, {
      factRepo, threadRepo, auPath: "au", _telemetry_override: silentTelemetry,
    });
    expect(res.facts).toHaveLength(1);
    expect(res.facts[0].caused_by).toEqual(["f_seed_3"]); // 真实 id → 挂上
    expect((res.facts[0]._confidence as { caused_by?: string })?.caused_by).toBe("low"); // 但标低置信
  });
});

describe("reactExtractFromChapter — 内联挂边（propose 时直接填，真 LLM 主路径）", () => {
  it("propose 内联 thread_ids + caused_by_fact_ids（带 evidence）→ finalize，无需 annotate 步", async () => {
    const { factRepo, threadRepo } = await seededRepos([SEED_FACT], [SEED_THREAD]);
    const provider = scriptedProvider([
      toolIter([{ name: REACT_TOOL_PROPOSE, args: { facts: [{
        content_clean: "林晚月与沈砚当夜结盟", characters: ["林晚月"],
        evidence: "与沈砚结盟", thread_ids: ["t_seed"], caused_by_fact_ids: ["f_seed_3"],
      }] } }]),
      toolIter([{ name: REACT_TOOL_FINALIZE, args: {} }]),
    ]);
    const res = await reactExtractFromChapter(CHAPTER, 5, [], { characters: ["林晚月"] }, null, provider, {
      factRepo, threadRepo, auPath: "au", _telemetry_override: silentTelemetry,
    });
    expect(res.status).toBe("ok");
    expect(res.facts).toHaveLength(1);
    expect(res.facts[0].thread_ids).toEqual(["t_seed"]);
    expect(res.facts[0].caused_by).toEqual(["f_seed_3"]); // grounded（evidence「与沈砚结盟」≥4字在章里）→ 不标 low
    expect((res.facts[0]._confidence as { caused_by?: string } | undefined)?.caused_by).toBeUndefined();
  });

  it("内联挂边：编造的 thread_id / fact_id 被过滤", async () => {
    const { factRepo, threadRepo } = await seededRepos([SEED_FACT], [SEED_THREAD]);
    const provider = scriptedProvider([
      toolIter([{ name: REACT_TOOL_PROPOSE, args: { facts: [{
        content_clean: "某个有效的事实内容", characters: [],
        evidence: "结盟", thread_ids: ["t_seed", "t_FAKE"], caused_by_fact_ids: ["f_seed_3", "f_FAKE"],
      }] } }]),
      toolIter([{ name: REACT_TOOL_FINALIZE, args: {} }]),
    ]);
    const res = await reactExtractFromChapter(CHAPTER, 5, [], { characters: [] }, null, provider, {
      factRepo, threadRepo, auPath: "au", _telemetry_override: silentTelemetry,
    });
    expect(res.facts[0].thread_ids).toEqual(["t_seed"]);
    expect(res.facts[0].caused_by).toEqual(["f_seed_3"]);
  });
});

describe("reactExtractFromChapter — 终止 / 降级语义", () => {
  it("无 factRepo/threadRepo：propose→finalize 仍产出事实（caused_by 空），status ok", async () => {
    const provider = scriptedProvider([
      toolIter([{ name: REACT_TOOL_PROPOSE, args: { facts: [{ content_clean: "独立事实无因果", characters: [] }] } }]),
      toolIter([{ name: REACT_TOOL_FINALIZE, args: {} }]),
    ]);
    const res = await reactExtractFromChapter(CHAPTER, 5, [], { characters: [] }, null, provider, { _telemetry_override: silentTelemetry });
    expect(res.status).toBe("ok");
    expect(res.facts).toHaveLength(1);
    expect(res.facts[0].caused_by ?? []).toEqual([]);
  });

  it("deviation guard：iter0 纯文本（还没 propose）被掰回，后续 propose 成功", async () => {
    const provider = scriptedProvider([
      textIter("我先想想这一章有哪些事实……"), // 纯文本，proposedFacts 空 → guard 注 hint continue
      toolIter([{ name: REACT_TOOL_PROPOSE, args: { facts: [{ content_clean: "被救回的事实", characters: [] }] } }]),
      toolIter([{ name: REACT_TOOL_FINALIZE, args: {} }]),
    ]);
    const res = await reactExtractFromChapter(CHAPTER, 5, [], { characters: [] }, null, provider, { _telemetry_override: silentTelemetry });
    expect(res.facts).toHaveLength(1);
    expect(res.facts[0].content_clean).toBe("被救回的事实");
  });

  it("maxIter 未收尾（从不 finalize）→ status degraded，但已提议的事实仍返回", async () => {
    const provider = scriptedProvider([
      toolIter([{ name: REACT_TOOL_PROPOSE, args: { facts: [{ content_clean: "第一批事实", characters: [] }] } }]),
      toolIter([{ name: REACT_TOOL_SEARCH, args: { query: "x" } }]),
    ]);
    const res = await reactExtractFromChapter(CHAPTER, 5, [], { characters: [] }, null, provider, {
      maxIter: 2, _telemetry_override: silentTelemetry,
    });
    expect(res.status).toBe("degraded");
    expect(res.facts).toHaveLength(1);
  });

  it("空章节 → 空结果 status ok（不跑 LLM）", async () => {
    const provider = scriptedProvider([textIter("never called")]);
    const res = await reactExtractFromChapter("   ", 5, [], { characters: [] }, null, provider, { _telemetry_override: silentTelemetry });
    expect(res).toEqual({ facts: [], status: "ok" });
  });
});

describe("reactExtractFromChapter — round-trip 闭环（最高优先级）", () => {
  it("提取产出的 caused_by + thread_ids 经 add_fact → list_all + ops rebuild 读回一致", async () => {
    const { factRepo, threadRepo } = await seededRepos([SEED_FACT], [SEED_THREAD]);
    const provider = scriptedProvider([
      toolIter([{ name: REACT_TOOL_PROPOSE, args: { facts: [{ content_clean: "林晚月灵力虚弱", characters: ["林晚月"], fact_type: "plot_event", evidence: "灵力虚弱" }] } }]),
      toolIter([{ name: REACT_TOOL_SEARCH, args: { query: "灵力", characters: ["林晚月"] } }]),
      toolIter([{ name: REACT_TOOL_ANNOTATE, args: { fact_index: 0, caused_by_fact_ids: ["f_seed_3"], thread_ids: ["t_seed"] } }]),
      toolIter([{ name: REACT_TOOL_FINALIZE, args: {} }]),
    ]);
    const res = await reactExtractFromChapter(CHAPTER, 5, [], { characters: ["林晚月"] }, null, provider, {
      factRepo, threadRepo, auPath: "au", _telemetry_override: silentTelemetry,
    });
    const extracted = res.facts[0];
    expect(extracted.caused_by).toEqual(["f_seed_3"]);
    expect(extracted.thread_ids).toEqual(["t_seed"]);

    // 模拟 UI 确认步：把提取候选（含 caused_by/thread_ids）落库（add_fact）。新建独立 AU 的 repo。
    const adapter2 = new MockAdapter();
    const factRepo2 = new FileFactRepository(adapter2);
    const opsRepo2 = new FileOpsRepository(adapter2);
    const created = await add_fact("au2", 5, {
      content_raw: extracted.content_raw,
      content_clean: extracted.content_clean,
      characters: extracted.characters,
      type: extracted.fact_type,
      narrative_weight: extracted.narrative_weight,
      caused_by: extracted.caused_by,
      thread_ids: extracted.thread_ids,
    }, factRepo2, opsRepo2);
    expect(created.caused_by).toEqual(["f_seed_3"]);
    expect(created.thread_ids).toEqual(["t_seed"]);

    // hop2: jsonl read-back
    const persisted = (await factRepo2.list_all("au2"))[0];
    expect(persisted.caused_by).toEqual(["f_seed_3"]);
    expect(persisted.thread_ids).toEqual(["t_seed"]);

    // hop5+6: ops 快照 → rebuild 还原
    const ops = await opsRepo2.list_all("au2");
    const rebuilt = rebuildFactsFromOps(ops);
    expect(rebuilt[0].caused_by).toEqual(["f_seed_3"]);
    expect(rebuilt[0].thread_ids).toEqual(["t_seed"]);
  });
});

describe("reactExtractFromChapter — codex 二审修复回归", () => {
  it("propose 某条 enrichment 形状不符（time_kind=null）不拖死整批，事实仍逐条提取（宽松解析）", async () => {
    const provider = scriptedProvider([
      toolIter([{ name: REACT_TOOL_PROPOSE, args: { facts: [
        { content_clean: "带坏字段的有效事实", characters: [], time_kind: null },  // strict schema 会拒
      ] } }]),
      toolIter([{ name: REACT_TOOL_FINALIZE, args: {} }]),
    ]);
    const res = await reactExtractFromChapter(CHAPTER, 5, [], { characters: [] }, null, provider, { _telemetry_override: silentTelemetry });
    expect(res.facts).toHaveLength(1);
    expect(res.facts[0].content_clean).toBe("带坏字段的有效事实");
  });

  it("annotate 分两次补 caused_by → 合并不覆盖（union）", async () => {
    const adapter = new MockAdapter();
    const factRepo = new FileFactRepository(adapter);
    await factRepo.append("au", SEED_FACT);
    await factRepo.append("au", createFact({ id: "f_seed_2", content_raw: "r", content_clean: "另一条更早的事实", characters: [], chapter: 2 }));
    const provider = scriptedProvider([
      toolIter([{ name: REACT_TOOL_PROPOSE, args: { facts: [{ content_clean: "承前的事实内容", characters: [], evidence: "灵力虚弱" }] } }]),
      toolIter([{ name: REACT_TOOL_ANNOTATE, args: { fact_index: 0, caused_by_fact_ids: ["f_seed_3"] } }]),
      toolIter([{ name: REACT_TOOL_ANNOTATE, args: { fact_index: 0, caused_by_fact_ids: ["f_seed_2"] } }]),
      toolIter([{ name: REACT_TOOL_FINALIZE, args: {} }]),
    ]);
    const res = await reactExtractFromChapter(CHAPTER, 5, [], { characters: [] }, null, provider, {
      factRepo, auPath: "au", _telemetry_override: silentTelemetry,
    });
    expect((res.facts[0].caused_by ?? []).sort()).toEqual(["f_seed_2", "f_seed_3"]);
  });

  it("空手纯文本收尾（guard 用尽仍不 propose）→ status degraded（让 wrapper 兜底）", async () => {
    const provider = scriptedProvider([
      textIter("本章似乎没有值得记录的事实。"),
      textIter("确实没有。"),
      textIter("结束。"),
    ]);
    const res = await reactExtractFromChapter(CHAPTER, 5, [], { characters: [] }, null, provider, { _telemetry_override: silentTelemetry });
    expect(res.facts).toHaveLength(0);
    expect(res.status).toBe("degraded");
  });
});

describe("reactExtractFromChapter — per-fact 过滤", () => {
  it("propose 里过短的 content_clean 被 rawToExtracted 逐条丢，不退整批", async () => {
    const provider = scriptedProvider([
      toolIter([{ name: REACT_TOOL_PROPOSE, args: { facts: [{ content_clean: "abc", characters: [] }, { content_clean: "够长的有效事实内容", characters: [] }] } }]),
      toolIter([{ name: REACT_TOOL_FINALIZE, args: {} }]),
    ]);
    const res = await reactExtractFromChapter(CHAPTER, 5, [], { characters: [] }, null, provider, { _telemetry_override: silentTelemetry });
    expect(res.facts).toHaveLength(1);
    expect(res.facts[0].content_clean).toBe("够长的有效事实内容");
  });
});
