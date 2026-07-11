// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { computeThreadStaleness, threadMemberFacts, regenerateThreadState } from "../thread_state.js";
import { createThread } from "../../domain/thread.js";
import { createFact } from "../../domain/fact.js";
import { ThreadStatus, FactStatus } from "../../domain/enums.js";
import type { LLMProvider } from "../../llm/provider.js";

function mockLLM(content: string): LLMProvider {
  return {
    async generate() {
      return { content, model: "m", input_tokens: 0, output_tokens: 0, finish_reason: "stop" };
    },
    async *generateStream() { /* unused */ },
  };
}
function throwingLLM(): LLMProvider {
  return {
    async generate() { throw new Error("boom"); },
    async *generateStream() { /* unused */ },
  };
}

const T = (over: Partial<ReturnType<typeof createThread>> = {}) =>
  createThread({ id: "t1", title: "沈砚为父翻案", status: ThreadStatus.ACTIVE, updated_at: "2026-01-10T00:00:00Z", ...over });
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
    const s = await regenerateThreadState(t, facts, mockLLM("已确认名录被篡改，准备面圣"));
    expect(s).toBe("已确认名录被篡改，准备面圣");
  });

  it("无成员事实 → null（不调 LLM）", async () => {
    const s = await regenerateThreadState(T(), [], mockLLM("x"));
    expect(s).toBeNull();
  });

  it("LLM 失败 → 降级 null，不抛", async () => {
    const facts = [F({ id: "f1", thread_ids: ["t1"] })];
    const s = await regenerateThreadState(T(), facts, throwingLLM());
    expect(s).toBeNull();
  });

  it("空白输出 → null", async () => {
    const facts = [F({ id: "f1", thread_ids: ["t1"] })];
    const s = await regenerateThreadState(T(), facts, mockLLM("   "));
    expect(s).toBeNull();
  });
});
