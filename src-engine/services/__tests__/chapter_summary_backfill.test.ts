// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect, vi } from "vitest";
import { find_chapters_missing_summary } from "../chapter_summary.js";

// 注：原 backfill_chapter_summaries 用例随该函数退役删除（被「补全旧章记忆」统一 pass 取代，
// 见 services/__tests__/backfill_memory.test.ts）。find_chapters_missing_summary 作为「缺摘要」
// 单一真相源判据保留，仍被 scanChapterMemory / backfillChapterMemory 复用，故保留其回归。

describe("find_chapters_missing_summary", () => {
  it("returns only chapters lacking a non-empty standard summary", async () => {
    const summaryRepo = {
      get: vi.fn(async (_au: string, n: number) => {
        if (n === 2) return { standard: { text: "已有摘要" } };
        if (n === 4) return { standard: { text: "   " } }; // 空白 = 视为缺
        if (n === 5) return { micro: "只有micro" }; // 无 standard = 缺
        return null; // 1, 3 无文件
      }),
    } as any;
    const missing = await find_chapters_missing_summary("/au", [1, 2, 3, 4, 5], summaryRepo);
    expect(missing).toEqual([1, 3, 4, 5]);
  });
});
