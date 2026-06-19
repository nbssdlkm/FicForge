// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect, vi } from "vitest";
import { generate_and_index_summary } from "../chapter_summary.js";

describe("generate_and_index_summary", () => {
  it("generates, saves, and indexes; returns true", async () => {
    const summaryRepo = { save: vi.fn(async () => {}), get: vi.fn(), remove: vi.fn() } as any;
    const ragManager = { indexChapterSummary: vi.fn(async () => {}) } as any;
    const ok = await generate_and_index_summary({
      auPath: "/au", chapterNum: 7, chapterText: "第七章正文", contentHash: "h7",
      llmProvider: { generate: vi.fn(async () => ({ content: "第七章摘要" })) } as any,
      embeddingProvider: { embed: vi.fn(async (t: string[]) => t.map(() => [0.1])) } as any,
      summaryRepo, ragManager,
    });
    expect(ok).toBe(true);
    expect(summaryRepo.save).toHaveBeenCalledOnce();
    expect(ragManager.indexChapterSummary).toHaveBeenCalledWith("/au", 7, "第七章摘要", expect.anything());
    // 落盘的 summary 带 source_chapter_hash
    const saved = summaryRepo.save.mock.calls[0][2];
    expect(saved.standard.source_chapter_hash).toBe("h7");
    expect(saved.standard.text).toBe("第七章摘要");
  });

  it("returns false and does not throw when generation yields null", async () => {
    const summaryRepo = { save: vi.fn(), get: vi.fn(), remove: vi.fn() } as any;
    const ragManager = { indexChapterSummary: vi.fn() } as any;
    const ok = await generate_and_index_summary({
      auPath: "/au", chapterNum: 7, chapterText: "   ", contentHash: "h7",
      llmProvider: { generate: vi.fn() } as any,
      embeddingProvider: { embed: vi.fn() } as any,
      summaryRepo, ragManager,
    });
    expect(ok).toBe(false);
    expect(summaryRepo.save).not.toHaveBeenCalled();
  });

  it("returns false (no throw) when save fails — best-effort (决策②)", async () => {
    const summaryRepo = { save: vi.fn(async () => { throw new Error("disk full"); }), get: vi.fn(), remove: vi.fn() } as any;
    const ragManager = { indexChapterSummary: vi.fn() } as any;
    const ok = await generate_and_index_summary({
      auPath: "/au", chapterNum: 7, chapterText: "正文", contentHash: "h7",
      llmProvider: { generate: vi.fn(async () => ({ content: "摘要" })) } as any,
      embeddingProvider: { embed: vi.fn() } as any,
      summaryRepo, ragManager,
    });
    expect(ok).toBe(false);
    expect(ragManager.indexChapterSummary).not.toHaveBeenCalled();
  });
});
