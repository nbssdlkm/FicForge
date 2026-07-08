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
import { REACT_MAX_FACTS_PER_CHAPTER } from "../react_extraction_context.js";
import {
  REACT_TOOL_SEARCH,
  REACT_TOOL_PROPOSE,
  REACT_TOOL_ANNOTATE,
  REACT_TOOL_FINALIZE,
} from "../react_extraction_tools.js";
import { createFact, type Fact, type FactFieldConfidence } from "../../domain/fact.js";
import { buildFactEnrichmentSuffix } from "../context_assembler.js";
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

describe("reactExtractFromChapter — L16 软上限计数透传", () => {
  it("propose 超 REACT_MAX_FACTS_PER_CHAPTER 条 → 多余被丢，cappedCount = 超出数", async () => {
    const over = 2;
    const n = REACT_MAX_FACTS_PER_CHAPTER + over;
    // n 条各不相同、evidence 均 grounded（「结盟」在 CHAPTER 里）→ 无重复/无 grounding 丢弃，
    // 唯一被丢的原因就是软上限。
    const facts = Array.from({ length: n }, (_, i) => ({
      content_clean: `事件编号第${i}条内容各不相同`,
      characters: [],
      evidence: "结盟",
    }));
    const provider = scriptedProvider([
      toolIter([{ name: REACT_TOOL_PROPOSE, args: { facts } }]),
      toolIter([{ name: REACT_TOOL_FINALIZE, args: {} }]),
    ]);
    const res = await reactExtractFromChapter(CHAPTER, 5, [], { characters: [] }, null, provider, {
      _telemetry_override: silentTelemetry,
    });
    expect(res.facts).toHaveLength(REACT_MAX_FACTS_PER_CHAPTER);
    expect(res.cappedCount).toBe(over);
  });

  it("未触发上限时 cappedCount = 0", async () => {
    const provider = scriptedProvider([
      toolIter([{ name: REACT_TOOL_PROPOSE, args: { facts: [{ content_clean: "只有一条事实内容", characters: [], evidence: "结盟" }] } }]),
      toolIter([{ name: REACT_TOOL_FINALIZE, args: {} }]),
    ]);
    const res = await reactExtractFromChapter(CHAPTER, 5, [], { characters: [] }, null, provider, {
      _telemetry_override: silentTelemetry,
    });
    expect(res.cappedCount).toBe(0);
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

  it("H-fix：loose-parse 路径下 raw.caused_by 的幻觉 id 被 knownFactIds 过滤", async () => {
    // fact_type 非法 → proposeFactsSchema 校验失败 → 走 dispatch 的裸 JSON.parse 兜底（zod 不再
    // 剥掉 schema 外的 raw.caused_by）。这条 raw 用的是 caused_by（非 caused_by_fact_ids），
    // 混了真实 seeded id + 幻觉 id。旧代码 rawToExtracted 无过滤读入 → 幻觉 id 落库；新代码统一过滤。
    const { factRepo, threadRepo } = await seededRepos([SEED_FACT], [SEED_THREAD]);
    const provider = scriptedProvider([
      toolIter([{ name: REACT_TOOL_PROPOSE, args: { facts: [{
        content_clean: "林晚月与人结盟对抗强敌", characters: ["林晚月"],
        fact_type: "NOT_A_REAL_ENUM", caused_by: ["f_seed_3", "f_HALLUCINATED"],
      }] } }]),
      toolIter([{ name: REACT_TOOL_FINALIZE, args: {} }]),
    ]);
    const res = await reactExtractFromChapter(CHAPTER, 5, [], { characters: ["林晚月"] }, null, provider, {
      factRepo, threadRepo, auPath: "au", _telemetry_override: silentTelemetry,
    });
    expect(res.facts).toHaveLength(1);
    expect(res.facts[0].caused_by).toEqual(["f_seed_3"]); // 幻觉 f_HALLUCINATED 被丢（旧代码会保留）
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
    expect(res).toEqual({ facts: [], status: "ok", cappedCount: 0 });
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

  it("一章 propose 超量 → 按 REACT_MAX_FACTS_PER_CHAPTER 软上限截断（防过度提取）", async () => {
    const facts = Array.from({ length: REACT_MAX_FACTS_PER_CHAPTER + 4 }, (_, i) => ({ content_clean: `第${i}条独立有效的事实内容`, characters: [] }));
    const provider = scriptedProvider([
      toolIter([{ name: REACT_TOOL_PROPOSE, args: { facts } }]),
      toolIter([{ name: REACT_TOOL_FINALIZE, args: {} }]),
    ]);
    const res = await reactExtractFromChapter(CHAPTER, 5, [], { characters: [] }, null, provider, { _telemetry_override: silentTelemetry });
    expect(res.facts).toHaveLength(REACT_MAX_FACTS_PER_CHAPTER);
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

describe("reactExtractFromChapter — H10 富化字段置信度合成（回归锚：删合成逻辑必挂）", () => {
  it("propose 带 location+known_to+time_kind → _confidence 各字段=medium，且 P3 注入门控产出非空后缀", async () => {
    const provider = scriptedProvider([
      toolIter([{ name: REACT_TOOL_PROPOSE, args: { facts: [{
        content_clean: "林晚月在藏书阁察觉灵力虚弱",
        characters: ["林晚月"],
        location: "藏书阁",
        known_to: ["林晚月"],
        time_kind: "flashback",
      }] } }]),
      toolIter([{ name: REACT_TOOL_FINALIZE, args: {} }]),
    ]);
    const res = await reactExtractFromChapter(CHAPTER, 5, [], { characters: ["林晚月"] }, null, provider, { _telemetry_override: silentTelemetry });
    expect(res.facts).toHaveLength(1);
    const c = res.facts[0]._confidence as FactFieldConfidence;
    expect(c?.location).toBe("medium");
    expect(c?.known_to).toBe("medium");
    expect(c?.time_kind).toBe("medium");
    // 未出现的字段不合成（不凭空造置信度）
    expect(c?.action_verb).toBeUndefined();
    expect(c?.suspense_type).toBeUndefined();
    // 关键回归锚：门控（_confidence 存在 + per-field ≥ medium）现在放行 ReAct 提取的富化字段
    const suffix = buildFactEnrichmentSuffix(res.facts[0] as unknown as Fact);
    expect(suffix).not.toBe("");
    expect(suffix).toContain("location: 藏书阁");
    expect(suffix).toContain("known_to: 林晚月");
    expect(suffix).toContain("time_kind: flashback");
  });

  it("已有 _confidence.caused_by=low（未 grounded 因果）不被合成覆盖（merge 不 replace）", async () => {
    const { factRepo, threadRepo } = await seededRepos([SEED_FACT], [SEED_THREAD]);
    const provider = scriptedProvider([
      // evidence「皇宫夜宴」不在 CHAPTER → ungrounded → 内联 caused_by 标 low；location 同时出现
      toolIter([{ name: REACT_TOOL_PROPOSE, args: { facts: [{
        content_clean: "这是一条无依据的因果事实",
        characters: [],
        evidence: "皇宫夜宴",
        caused_by_fact_ids: ["f_seed_3"],
        location: "御书房",
      }] } }]),
      toolIter([{ name: REACT_TOOL_FINALIZE, args: {} }]),
    ]);
    const res = await reactExtractFromChapter(CHAPTER, 5, [], { characters: [] }, null, provider, {
      factRepo, threadRepo, auPath: "au", _telemetry_override: silentTelemetry,
    });
    const c = res.facts[0]._confidence as FactFieldConfidence;
    expect(c?.caused_by).toBe("low");     // grounding 标的 low 存活
    expect(c?.location).toBe("medium");   // 合成的 medium 并存
  });

  it("富化字段全空 → 不凭空造 _confidence（保持 undefined，与门控 `!c` 短路语义兼容）", async () => {
    const provider = scriptedProvider([
      toolIter([{ name: REACT_TOOL_PROPOSE, args: { facts: [{ content_clean: "无任何富化字段的事实", characters: [] }] } }]),
      toolIter([{ name: REACT_TOOL_FINALIZE, args: {} }]),
    ]);
    const res = await reactExtractFromChapter(CHAPTER, 5, [], { characters: [] }, null, provider, { _telemetry_override: silentTelemetry });
    expect(res.facts).toHaveLength(1);
    expect(res.facts[0]._confidence).toBeUndefined();
    expect(buildFactEnrichmentSuffix(res.facts[0] as unknown as Fact)).toBe("");
  });

  it("端到端：ReAct 提取 → add_fact 落库 → jsonl 读回 + ops rebuild 的 fact 过门控均产非空后缀", async () => {
    const provider = scriptedProvider([
      toolIter([{ name: REACT_TOOL_PROPOSE, args: { facts: [{
        content_clean: "林晚月与沈砚在城郊结盟",
        characters: ["林晚月"],
        location: "城郊",
        action_verb: "结盟",
        suspense_type: "secret",
        known_to: "reader_only",
      }] } }]),
      toolIter([{ name: REACT_TOOL_FINALIZE, args: {} }]),
    ]);
    const res = await reactExtractFromChapter(CHAPTER, 5, [], { characters: ["林晚月"] }, null, provider, { _telemetry_override: silentTelemetry });
    const extracted = res.facts[0];

    // 模拟 UI 确认落库（extractedEnrichment spread 等价形状：仅带有值的富化键 + _confidence）
    const adapter = new MockAdapter();
    const factRepo = new FileFactRepository(adapter);
    const opsRepo = new FileOpsRepository(adapter);
    await add_fact("au_e2e", 5, {
      content_raw: extracted.content_raw,
      content_clean: extracted.content_clean,
      characters: extracted.characters,
      type: extracted.fact_type,
      narrative_weight: extracted.narrative_weight,
      location: extracted.location,
      action_verb: extracted.action_verb,
      suspense_type: extracted.suspense_type,
      known_to: extracted.known_to,
      _confidence: extracted._confidence,
    }, factRepo, opsRepo);

    // jsonl 读回 → 门控放行
    const persisted = (await factRepo.list_all("au_e2e"))[0];
    const suffix = buildFactEnrichmentSuffix(persisted);
    expect(suffix).toContain("location: 城郊");
    expect(suffix).toContain("action_verb: 结盟");
    expect(suffix).toContain("suspense_type: secret");
    expect(suffix).toContain("known_to: reader_only");

    // ops 快照 rebuild → 门控同样放行（_confidence 走 ops payload 存活）
    const rebuilt = rebuildFactsFromOps(await opsRepo.list_all("au_e2e"));
    expect(buildFactEnrichmentSuffix(rebuilt[0])).toBe(suffix);
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
