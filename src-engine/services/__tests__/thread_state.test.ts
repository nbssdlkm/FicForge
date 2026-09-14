// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import {
  computeThreadStaleness,
  threadMemberFacts,
  regenerateThreadState,
  sortThreadFacts,
  allocateThreadOrder,
  normalizeThreadOrders,
} from "../thread_state.js";
import { createThread } from "../../domain/thread.js";
import { createFact } from "../../domain/fact.js";
import { ThreadStatus, FactStatus } from "../../domain/enums.js";
import { createMockLLMProvider } from "./mock_llm_provider.js";

const T = (over: Partial<ReturnType<typeof createThread>> = {}) =>
  createThread({
    id: "t1",
    title: "沈砚为父翻案",
    status: ThreadStatus.ACTIVE,
    updated_at: "2026-01-10T00:00:00Z",
    ...over,
  });
const F = (over: Partial<ReturnType<typeof createFact>> = {}) =>
  createFact({ id: "f", content_raw: "r", content_clean: "c", status: FactStatus.ACTIVE, chapter: 1, ...over });

describe("computeThreadStaleness", () => {
  it("挂了晚于 updated_at 的新事实 → 陈旧，计数正确", () => {
    const t = T();
    const facts = [
      F({ id: "f_old", thread_ids: ["t1"], created_at: "2026-01-05T00:00:00Z" }), // 早于 → 不算
      F({ id: "f_new1", thread_ids: ["t1"], created_at: "2026-01-12T00:00:00Z" }), // 晚于 → 算
      F({ id: "f_new2", thread_ids: ["t1"], created_at: "2026-01-15T00:00:00Z" }), // 晚于 → 算
      F({ id: "f_other", thread_ids: ["t_other"], created_at: "2026-01-20T00:00:00Z" }), // 别的线
    ];
    expect(computeThreadStaleness([t], facts)).toEqual([{ thread_id: "t1", new_fact_count: 2 }]);
  });

  it("state 刚更新（updated_at 晚于所有成员事实）→ 不陈旧", () => {
    const t = T({ updated_at: "2026-02-01T00:00:00Z" });
    const facts = [F({ id: "f1", thread_ids: ["t1"], created_at: "2026-01-12T00:00:00Z" })];
    expect(computeThreadStaleness([t], facts)).toEqual([]);
  });

  it("resolved 线不算陈旧（已收束不再挂新事实）", () => {
    const t = T({ status: ThreadStatus.RESOLVED });
    const facts = [F({ id: "f1", thread_ids: ["t1"], created_at: "2026-01-20T00:00:00Z" })];
    expect(computeThreadStaleness([t], facts)).toEqual([]);
  });

  it("冷（archived）成员事实不计入陈旧", () => {
    const t = T();
    const facts = [F({ id: "f1", thread_ids: ["t1"], created_at: "2026-01-20T00:00:00Z", archived: true })];
    expect(computeThreadStaleness([t], facts)).toEqual([]);
  });
});

describe("threadMemberFacts", () => {
  it("只取本线非冷事实，按 chapter 正序", () => {
    const t = T();
    const facts = [
      F({ id: "a", thread_ids: ["t1"], chapter: 3 }),
      F({ id: "b", thread_ids: ["t1"], chapter: 1 }),
      F({ id: "c", thread_ids: ["t_other"], chapter: 2 }),
      F({ id: "d", thread_ids: ["t1"], chapter: 2, archived: true }), // 冷 → 排除
    ];
    expect(threadMemberFacts(t, facts).map((f) => f.id)).toEqual(["b", "a"]);
  });
});

describe("regenerateThreadState", () => {
  it("从成员事实生成一句进展", async () => {
    const t = T();
    const facts = [F({ id: "f1", thread_ids: ["t1"], content_clean: "沈砚发现残页" })];
    const s = await regenerateThreadState(t, facts, createMockLLMProvider({ content: "已确认名录被篡改，准备面圣" }));
    expect(s).toBe("已确认名录被篡改，准备面圣");
  });

  it("无成员事实 → null（不调 LLM）", async () => {
    const s = await regenerateThreadState(T(), [], createMockLLMProvider({ content: "x" }));
    expect(s).toBeNull();
  });

  it("LLM 失败 → 降级 null，不抛", async () => {
    const facts = [F({ id: "f1", thread_ids: ["t1"] })];
    const s = await regenerateThreadState(T(), facts, createMockLLMProvider({ error: new Error("boom") }));
    expect(s).toBeNull();
  });

  it("空白输出 → null", async () => {
    const facts = [F({ id: "f1", thread_ids: ["t1"] })];
    const s = await regenerateThreadState(T(), facts, createMockLLMProvider({ content: "   " }));
    expect(s).toBeNull();
  });
});

// ===========================================================================
// REQ-140 编排板
// ===========================================================================

describe("computeThreadStaleness (REQ-140 dormant 跳过)", () => {
  it("dormant 线休眠期间不算陈旧（不烦用户）", () => {
    const t = T({ status: ThreadStatus.DORMANT });
    const facts = [F({ id: "f1", thread_ids: ["t1"], created_at: "2026-01-20T00:00:00Z" })];
    expect(computeThreadStaleness([t], facts)).toEqual([]);
  });
});

describe("sortThreadFacts (REQ-140)", () => {
  it("全部无显式序号 → 派生序（章号升序再 created_at），与旧行为一致", () => {
    const facts = [
      F({ id: "a", thread_ids: ["t1"], chapter: 3, created_at: "2026-01-03T00:00:00Z" }),
      F({ id: "b", thread_ids: ["t1"], chapter: 1, created_at: "2026-01-01T00:00:00Z" }),
      F({ id: "c", thread_ids: ["t1"], chapter: 1, created_at: "2026-01-02T00:00:00Z" }),
      F({ id: "x", thread_ids: ["t_other"], chapter: 0 }),
    ];
    expect(sortThreadFacts(facts, "t1").map((f) => f.id)).toEqual(["b", "c", "a"]);
  });

  it("有显式序号的按序号排在前，无序号按派生序排尾部（混合）", () => {
    const facts = [
      F({ id: "a", thread_ids: ["t1"], chapter: 1, thread_order: { t1: 20 } }),
      F({ id: "b", thread_ids: ["t1"], chapter: 5 }), // 无章序靠后但无序号 → 尾部
      F({ id: "c", thread_ids: ["t1"], chapter: 3, thread_order: { t1: 10 } }),
    ];
    expect(sortThreadFacts(facts, "t1").map((f) => f.id)).toEqual(["c", "a", "b"]);
  });

  it("同一 fact 挂两条线，各自序号独立排序", () => {
    const shared = F({ id: "s", thread_ids: ["t1", "t2"], chapter: 2, thread_order: { t1: 10, t2: 20 } });
    const facts = [
      shared,
      F({ id: "a", thread_ids: ["t1"], chapter: 1, thread_order: { t1: 20 } }),
      F({ id: "b", thread_ids: ["t2"], chapter: 1, thread_order: { t2: 10 } }),
    ];
    expect(sortThreadFacts(facts, "t1").map((f) => f.id)).toEqual(["s", "a"]);
    expect(sortThreadFacts(facts, "t2").map((f) => f.id)).toEqual(["b", "s"]);
  });

  it("冷 fact 不被排序函数过滤（调用方职责），成员判定不变", () => {
    const facts = [F({ id: "a", thread_ids: ["t1"], chapter: 1, archived: true })];
    expect(sortThreadFacts(facts, "t1").map((f) => f.id)).toEqual(["a"]);
  });
});

describe("allocateThreadOrder (REQ-140)", () => {
  it("空线首节点 = GAP；尾部 = max+GAP；头部 = min-GAP（可负）", () => {
    expect(allocateThreadOrder(undefined, undefined)).toBe(10);
    expect(allocateThreadOrder(30, undefined)).toBe(40);
    expect(allocateThreadOrder(undefined, 10)).toBe(0);
  });

  it("中间插入取中点（floor）；间隙 <2 → null（调用方归一化后重试）", () => {
    expect(allocateThreadOrder(10, 20)).toBe(15);
    expect(allocateThreadOrder(10, 12)).toBe(11);
    expect(allocateThreadOrder(10, 11)).toBeNull();
  });
});

describe("normalizeThreadOrders (REQ-140)", () => {
  it("按数组顺序归一化为 10/20/30…", () => {
    const facts = [F({ id: "a" }), F({ id: "b" }), F({ id: "c" })];
    expect(normalizeThreadOrders(facts)).toEqual({ a: 10, b: 20, c: 30 });
  });
});
