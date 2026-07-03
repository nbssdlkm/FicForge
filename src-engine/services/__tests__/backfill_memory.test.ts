// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect, vi } from "vitest";
import {
  backfill_chapter_memory,
  type BackfillMemoryTarget,
} from "../backfill_memory.js";

function target(
  n: number,
  opts: { needSummary?: boolean; extractFacts?: boolean } = {},
): BackfillMemoryTarget {
  return {
    chapterNum: n,
    content: `第 ${n} 章正文`,
    contentHash: `h${n}`,
    needSummary: opts.needSummary ?? false,
    extractFacts: opts.extractFacts ?? false,
  };
}

/** 默认回调:摘要生成成功、提取出 1 条、落盘成功(factsAdded 跟随传入 facts 数)。 */
function deps(targets: BackfillMemoryTarget[], over: Partial<Parameters<typeof backfill_chapter_memory>[0]> = {}) {
  return {
    targets,
    generateSummary: vi.fn(async (t: BackfillMemoryTarget) => `摘要-${t.chapterNum}`),
    extractFacts: vi.fn(async (t: BackfillMemoryTarget) => [{ chapter: t.chapterNum }]),
    persistChapter: vi.fn(async (_t: BackfillMemoryTarget, p: { facts: unknown[] }) => ({
      persisted: true,
      factsAdded: p.facts.length,
    })),
    ...over,
  };
}

describe("backfill_chapter_memory", () => {
  it("仅摘要的章:调 generateSummary、不调 extractFacts,落盘后计 summariesGenerated + indexed", async () => {
    const d = deps([target(1, { needSummary: true, extractFacts: false })]);
    const res = await backfill_chapter_memory(d);
    expect(d.generateSummary).toHaveBeenCalledTimes(1);
    expect(d.extractFacts).not.toHaveBeenCalled();
    // persist 拿到 summaryText 非空、facts 空
    expect(d.persistChapter.mock.calls[0][1]).toEqual({ summaryText: "摘要-1", facts: [] });
    expect(res).toEqual({
      total: 1, summariesGenerated: 1, factsChapters: 0, factsAdded: 0,
      indexed: 1, skipped: 0, failed: 0, aborted: false,
    });
  });

  it("仅笔记的章:不调 generateSummary、调 extractFacts,计 factsChapters + factsAdded", async () => {
    const d = deps([target(1, { needSummary: false, extractFacts: true })]);
    const res = await backfill_chapter_memory(d);
    expect(d.generateSummary).not.toHaveBeenCalled();
    expect(d.extractFacts).toHaveBeenCalledTimes(1);
    expect(d.persistChapter.mock.calls[0][1]).toEqual({ summaryText: null, facts: [{ chapter: 1 }] });
    expect(res).toMatchObject({ summariesGenerated: 0, factsChapters: 1, factsAdded: 1, indexed: 1 });
  });

  it("两者都要的章:摘要 + 笔记都计,indexed 计一次", async () => {
    const d = deps([target(1, { needSummary: true, extractFacts: true })]);
    const res = await backfill_chapter_memory(d);
    expect(res).toMatchObject({ summariesGenerated: 1, factsChapters: 1, factsAdded: 1, indexed: 1 });
  });

  it("摘要生成降级返回 null:仍落笔记/索引,summariesGenerated=0、persist 收到 summaryText=null", async () => {
    const d = deps([target(1, { needSummary: true, extractFacts: true })], {
      generateSummary: vi.fn(async () => null),
    });
    const res = await backfill_chapter_memory(d);
    expect(d.persistChapter.mock.calls[0][1].summaryText).toBeNull();
    expect(res).toMatchObject({ summariesGenerated: 0, factsChapters: 1, factsAdded: 1, indexed: 1, failed: 0 });
  });

  it("提取出 0 条笔记的章:indexed 计、factsChapters 不计(无新笔记)", async () => {
    const d = deps([target(1, { extractFacts: true })], {
      extractFacts: vi.fn(async () => []),
      persistChapter: vi.fn(async () => ({ persisted: true, factsAdded: 0 })),
    });
    const res = await backfill_chapter_memory(d);
    expect(res).toMatchObject({ factsChapters: 0, factsAdded: 0, indexed: 1 });
  });

  it("CAS 拒绝(persist persisted=false):计 skipped,不计 indexed/summaries/facts", async () => {
    const d = deps([target(1, { needSummary: true, extractFacts: true })], {
      persistChapter: vi.fn(async () => ({ persisted: false, factsAdded: 0 })),
    });
    const res = await backfill_chapter_memory(d);
    expect(res).toMatchObject({ skipped: 1, indexed: 0, summariesGenerated: 0, factsChapters: 0, failed: 0 });
  });

  it("某章回调抛错:计 failed 并继续整批", async () => {
    const d = deps([target(1, { needSummary: true }), target(2, { needSummary: true })], {
      generateSummary: vi.fn(async (t: BackfillMemoryTarget) => {
        if (t.chapterNum === 1) throw new Error("LLM 503");
        return `摘要-${t.chapterNum}`;
      }),
    });
    const res = await backfill_chapter_memory(d);
    expect(res).toMatchObject({ total: 2, summariesGenerated: 1, failed: 1, aborted: false });
  });

  it("逐章进度上报,顺序正确", async () => {
    const progress: number[] = [];
    const d = deps([target(1, { needSummary: true }), target(2, { needSummary: true }), target(3, { needSummary: true })], {
      onProgress: (info: { done: number }) => progress.push(info.done),
    });
    await backfill_chapter_memory(d);
    expect(progress).toEqual([1, 2, 3]);
  });

  it("章边界中断:已补保留,后续章不起", async () => {
    const controller = new AbortController();
    const d = deps([target(1, { needSummary: true }), target(2, { needSummary: true }), target(3, { needSummary: true })], {
      signal: controller.signal,
      onProgress: (info: { done: number }) => { if (info.done === 2) controller.abort(); },
    });
    const res = await backfill_chapter_memory(d);
    expect(res.aborted).toBe(true);
    expect(res.summariesGenerated).toBe(2);
    expect(d.persistChapter).toHaveBeenCalledTimes(2);
  });

  it("开跑前已中止:零处理", async () => {
    const controller = new AbortController();
    controller.abort();
    const d = deps([target(1, { needSummary: true })], { signal: controller.signal });
    const res = await backfill_chapter_memory(d);
    expect(res).toMatchObject({ total: 1, summariesGenerated: 0, indexed: 0, aborted: true });
    expect(d.persistChapter).not.toHaveBeenCalled();
  });

  it("审计⑨:慢回调期间用户点停(回调返回但 signal 已 abort) → 不落该章、不计 failed、干净停止", async () => {
    const controller = new AbortController();
    const d = deps([target(1, { needSummary: true }), target(2, { needSummary: true })], {
      signal: controller.signal,
      generateSummary: vi.fn(async (t: BackfillMemoryTarget) => {
        if (t.chapterNum === 1) controller.abort(); // 生成第 1 章时用户点停（在飞请求被取消）
        return `摘要-${t.chapterNum}`;
      }),
    });
    const res = await backfill_chapter_memory(d);
    expect(res.aborted).toBe(true);
    expect(res.failed).toBe(0);   // 不误记 failed
    expect(res.indexed).toBe(0);  // 第 1 章未落盘（中断）
    expect(d.persistChapter).not.toHaveBeenCalled(); // 慢回调后 signal 检查拦下，不落陈旧/半成品
  });

  it("审计⑨:慢回调抛真 AbortError(取消) → 干净停止、不计 failed", async () => {
    const controller = new AbortController();
    const d = deps([target(1, { needSummary: true })], {
      signal: controller.signal,
      generateSummary: vi.fn(async () => {
        controller.abort();
        throw Object.assign(new Error("Aborted"), { name: "AbortError" }); // LLM 请求被取消抛 AbortError
      }),
    });
    const res = await backfill_chapter_memory(d);
    expect(res.aborted).toBe(true);
    expect(res.failed).toBe(0); // AbortError 按取消处理，不误记 failed
    expect(d.persistChapter).not.toHaveBeenCalled();
  });

  it("审计⑨:persist 阶段真失败恰逢用户点停 → 仍计 failed，不被 signal.aborted 误吞成干净停止", async () => {
    const controller = new AbortController();
    const d = deps([target(1, { needSummary: true })], {
      signal: controller.signal,
      generateSummary: vi.fn(async () => "摘要-1"), // 慢回调成功（此刻未 abort）
      persistChapter: vi.fn(async () => {
        controller.abort();                             // persist 期间用户点停
        throw new Error("indexChapter embedding 拒绝"); // 且 persist 因真错误抛出（非 AbortError）
      }),
    });
    const res = await backfill_chapter_memory(d);
    // 真失败必须计入，不能因 signal.aborted 就误判干净停止（否则丢 failed + 遗留悬空 STALE）
    expect(res.failed).toBe(1);
  });
});
