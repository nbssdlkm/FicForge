// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect, vi } from "vitest";
import { persist_chapter_summary } from "../chapter_summary.js";

describe("persist_chapter_summary", () => {
  it("indexes (embed) before saving; save carries source_chapter_hash + text", async () => {
    const summaryRepo = { save: vi.fn(async () => {}), get: vi.fn(), remove: vi.fn() } as any;
    const ragManager = { indexChapterSummary: vi.fn(async () => {}) } as any;
    await persist_chapter_summary({
      auPath: "/au", chapterNum: 7, text: "第七章摘要", contentHash: "h7",
      embeddingProvider: { embed: vi.fn() } as any, summaryRepo, ragManager,
    });
    expect(ragManager.indexChapterSummary).toHaveBeenCalledWith("/au", 7, "第七章摘要", expect.anything());
    expect(summaryRepo.save).toHaveBeenCalledOnce();
    const saved = summaryRepo.save.mock.calls[0][2];
    expect(saved.standard.source_chapter_hash).toBe("h7");
    expect(saved.standard.text).toBe("第七章摘要");
  });

  it("does NOT save when indexing fails — 超长 poison 摘要不落脏文件（codex 对抗审 BLOCKER）", async () => {
    const summaryRepo = { save: vi.fn(async () => {}), get: vi.fn(), remove: vi.fn() } as any;
    const ragManager = { indexChapterSummary: vi.fn(async () => { throw new Error("embed rejected"); }) } as any;
    await expect(persist_chapter_summary({
      auPath: "/au", chapterNum: 7, text: "POISON", contentHash: "h7",
      embeddingProvider: { embed: vi.fn() } as any, summaryRepo, ragManager,
    })).rejects.toThrow();
    expect(summaryRepo.save).not.toHaveBeenCalled(); // index 先于 save → 失败时不落盘
  });
});
