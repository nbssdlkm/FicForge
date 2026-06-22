// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect, vi } from "vitest";
import {
  find_chapters_missing_summary,
  backfill_chapter_summaries,
  type BackfillSummaryTarget,
} from "../chapter_summary.js";

function fakeLlm(content = "这一章的摘要文本") {
  return { generate: vi.fn(async () => ({ content })) } as any;
}
function targets(nums: number[]): BackfillSummaryTarget[] {
  return nums.map((n) => ({ chapterNum: n, content: `第 ${n} 章正文`, contentHash: `h${n}` }));
}

describe("find_chapters_missing_summary", () => {
  it("returns only chapters lacking a non-empty standard summary", async () => {
    const summaryRepo = {
      get: vi.fn(async (_au: string, n: number) => {
        if (n === 2) return { standard: { text: "已有摘要" } };
        if (n === 4) return { standard: { text: "   " } };   // 空白 = 视为缺
        if (n === 5) return { micro: "只有micro" };           // 无 standard = 缺
        return null;                                          // 1, 3 无文件
      }),
    } as any;
    const missing = await find_chapters_missing_summary("/au", [1, 2, 3, 4, 5], summaryRepo);
    expect(missing).toEqual([1, 3, 4, 5]);
  });
});

describe("backfill_chapter_summaries", () => {
  it("generates each target, delegates persist, tallies generated, reports progress", async () => {
    const persistChapter = vi.fn(async () => true);
    const progress: number[] = [];
    const res = await backfill_chapter_summaries({
      targets: targets([1, 2, 3]),
      llmProvider: fakeLlm(),
      persistChapter,
      onProgress: (info) => progress.push(info.done),
    });
    expect(res).toEqual({ total: 3, generated: 3, failed: 0, skipped: 0, aborted: false });
    expect(persistChapter).toHaveBeenCalledTimes(3);
    expect(progress).toEqual([1, 2, 3]);
    // 第 2 次 persist 拿到的是第 2 章 target（hash h2）
    expect(persistChapter.mock.calls[1][0].contentHash).toBe("h2");
  });

  it("counts a null generation as failed and keeps going (single bad chapter ≠ batch death)", async () => {
    const persistChapter = vi.fn(async () => true);
    // 第 2 章生成返回空 → null → failed；其余正常
    const llm = {
      generate: vi.fn(async (req: any) => ({
        content: req.messages[1].content.includes("第 2 章") ? "" : "摘要",
      })),
    } as any;
    const res = await backfill_chapter_summaries({
      targets: targets([1, 2, 3]),
      llmProvider: llm,
      persistChapter,
    });
    expect(res).toEqual({ total: 3, generated: 2, failed: 1, skipped: 0, aborted: false });
    expect(persistChapter).toHaveBeenCalledTimes(2);
  });

  it("counts a persist throw as failed and keeps going", async () => {
    const persistChapter = vi.fn(async (target: BackfillSummaryTarget) => {
      if (target.chapterNum === 1) throw new Error("embed rejected");
      return true;
    });
    const res = await backfill_chapter_summaries({
      targets: targets([1, 2]),
      llmProvider: fakeLlm(),
      persistChapter,
    });
    expect(res).toEqual({ total: 2, generated: 1, failed: 1, skipped: 0, aborted: false });
  });

  it("counts a CAS-rejected persist as skipped, not failed (chapter changed mid-batch)", async () => {
    // persistChapter 返回 false = 章节中途被 edit/undo，hash 不符 → 不落陈旧向量
    const persistChapter = vi.fn(async (target: BackfillSummaryTarget) => target.chapterNum !== 2);
    const res = await backfill_chapter_summaries({
      targets: targets([1, 2, 3]),
      llmProvider: fakeLlm(),
      persistChapter,
    });
    expect(res).toEqual({ total: 3, generated: 2, failed: 0, skipped: 1, aborted: false });
  });

  it("stops at chapter boundary when signal is aborted, keeping what was already done", async () => {
    const persistChapter = vi.fn(async () => true);
    const controller = new AbortController();
    let done = 0;
    const res = await backfill_chapter_summaries({
      targets: targets([1, 2, 3, 4]),
      llmProvider: fakeLlm(),
      persistChapter,
      signal: controller.signal,
      onProgress: (info) => {
        done = info.done;
        if (info.done === 2) controller.abort(); // 第 2 章后中止
      },
    });
    expect(res.aborted).toBe(true);
    expect(res.generated).toBe(2);
    expect(done).toBe(2);
    expect(persistChapter).toHaveBeenCalledTimes(2);
  });

  it("aborted before any work → zero generated, no persist", async () => {
    const persistChapter = vi.fn(async () => true);
    const controller = new AbortController();
    controller.abort();
    const res = await backfill_chapter_summaries({
      targets: targets([1, 2]),
      llmProvider: fakeLlm(),
      persistChapter,
      signal: controller.signal,
    });
    expect(res).toEqual({ total: 2, generated: 0, failed: 0, skipped: 0, aborted: true });
    expect(persistChapter).not.toHaveBeenCalled();
  });
});
