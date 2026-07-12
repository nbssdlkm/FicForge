// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect, vi } from "vitest";
import { persistChapterSummary } from "../chapter_summary.js";

describe("persist_chapter_summary", () => {
  it("indexes (embed) before saving; save carries source_chapter_hash + text", async () => {
    const summaryRepo = { save: vi.fn(async () => {}), get: vi.fn(), remove: vi.fn() } as any;
    const ragManager = { indexChapterSummary: vi.fn(async () => {}) } as any;
    await persistChapterSummary({
      auPath: "/au",
      chapterNum: 7,
      text: "第七章摘要",
      contentHash: "h7",
      embeddingProvider: { embed: vi.fn() } as any,
      summaryRepo,
      ragManager,
    });
    // MED-2：新增第 5 参 signal 透传（本用例未传 → undefined）
    expect(ragManager.indexChapterSummary).toHaveBeenCalledWith("/au", 7, "第七章摘要", expect.anything(), undefined);
    expect(summaryRepo.save).toHaveBeenCalledOnce();
    const saved = summaryRepo.save.mock.calls[0][2];
    expect(saved.standard.source_chapter_hash).toBe("h7");
    expect(saved.standard.text).toBe("第七章摘要");
  });

  it("merges with existing file: micro-only 摘要补 standard 后 micro 仍在（审计 M2）", async () => {
    const micro = {
      version: 1,
      text: "微摘要节点",
      generated_at: "2026-01-01T00:00:00Z",
      source_chapter_hash: "h-old",
    };
    const summaryRepo = {
      save: vi.fn(async () => {}),
      // confirm 时 standard 失败/micro 成功留下的 micro-only 文件
      get: vi.fn(async () => ({ standard: null, micro })),
      remove: vi.fn(),
    } as any;
    const ragManager = { indexChapterSummary: vi.fn(async () => {}) } as any;

    await persistChapterSummary({
      auPath: "/au",
      chapterNum: 3,
      text: "第三章标准摘要",
      contentHash: "h3",
      embeddingProvider: { embed: vi.fn() } as any,
      summaryRepo,
      ragManager,
    });

    const saved = summaryRepo.save.mock.calls[0][2];
    expect(saved.standard.text).toBe("第三章标准摘要");
    // 判别断言：整档重写会把 micro 抹成 null（micro 无补生成路径 → retrospective 永久缺章）
    expect(saved.micro).toEqual(micro);
  });

  it("merges with existing file: 保留 standard_v1 备份字段（审计 M2）", async () => {
    const v1 = { version: 1, text: "原始 v1", generated_at: "2026-01-01T00:00:00Z", source_chapter_hash: "h-v1" };
    const summaryRepo = {
      save: vi.fn(async () => {}),
      get: vi.fn(async () => ({ standard: null, micro: null, standard_v1: v1 })),
      remove: vi.fn(),
    } as any;
    const ragManager = { indexChapterSummary: vi.fn(async () => {}) } as any;

    await persistChapterSummary({
      auPath: "/au",
      chapterNum: 4,
      text: "重生成的摘要",
      contentHash: "h4",
      embeddingProvider: { embed: vi.fn() } as any,
      summaryRepo,
      ragManager,
    });

    const saved = summaryRepo.save.mock.calls[0][2];
    expect(saved.standard.text).toBe("重生成的摘要");
    expect(saved.standard_v1).toEqual(v1);
  });

  it("no existing file: 行为同旧（全新写入，micro 为 null）", async () => {
    const summaryRepo = { save: vi.fn(async () => {}), get: vi.fn(async () => null), remove: vi.fn() } as any;
    const ragManager = { indexChapterSummary: vi.fn(async () => {}) } as any;

    await persistChapterSummary({
      auPath: "/au",
      chapterNum: 5,
      text: "第五章摘要",
      contentHash: "h5",
      embeddingProvider: { embed: vi.fn() } as any,
      summaryRepo,
      ragManager,
    });

    const saved = summaryRepo.save.mock.calls[0][2];
    expect(saved.standard.text).toBe("第五章摘要");
    expect(saved.standard.source_chapter_hash).toBe("h5");
    expect(saved.micro).toBeNull();
  });

  it("does NOT save when indexing fails — 超长 poison 摘要不落脏文件（codex 对抗审 BLOCKER）", async () => {
    const summaryRepo = { save: vi.fn(async () => {}), get: vi.fn(), remove: vi.fn() } as any;
    const ragManager = {
      indexChapterSummary: vi.fn(async () => {
        throw new Error("embed rejected");
      }),
    } as any;
    await expect(
      persistChapterSummary({
        auPath: "/au",
        chapterNum: 7,
        text: "POISON",
        contentHash: "h7",
        embeddingProvider: { embed: vi.fn() } as any,
        summaryRepo,
        ragManager,
      }),
    ).rejects.toThrow();
    expect(summaryRepo.save).not.toHaveBeenCalled(); // index 先于 save → 失败时不落盘
  });
});
