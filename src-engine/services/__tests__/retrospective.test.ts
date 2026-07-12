// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Tests for run_retrospective (M10-A).
 * TDD: written before implementation.
 */

import { describe, it, expect, vi } from "vitest";
import {
  run_retrospective,
  generate_retrospective,
  commit_retrospective,
  should_run_retrospective,
  RETROSPECTIVE_INTERVAL,
} from "../retrospective.js";
import { IndexStatus } from "../../domain/enums.js";

function fakeProvider(reply: string) {
  return { generate: vi.fn(async () => ({ content: reply })) } as any;
}

function fakeSummaryRepo(
  perChapter: Record<
    number,
    {
      standard?: { text: string; version: number; source_chapter_hash: string; generated_at: string } | null;
      micro?: { text: string; version: number; source_chapter_hash: string; generated_at: string } | null;
      standard_v1?: any;
    }
  >,
) {
  return {
    get: vi.fn(async (_auPath: string, chapterNum: number) => {
      const entry = perChapter[chapterNum];
      if (!entry) return null;
      return { standard: entry.standard ?? null, micro: entry.micro ?? null, standard_v1: entry.standard_v1 };
    }),
    save: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
    update_micro: vi.fn(async () => {}),
    promote_to_v2: vi.fn(async () => {}),
  } as any;
}

function fakeChapterRepo(content: string, contentHash = "h-live") {
  return { get: vi.fn(async () => ({ content, content_hash: contentHash })) } as any;
}

function fakeRagManager() {
  return { indexChapterSummary: vi.fn(async () => {}) } as any;
}

function fakeEmbeddingProvider() {
  return { embed: vi.fn() } as any;
}

describe("should_run_retrospective", () => {
  it("returns true when chapterNum is multiple of interval AND target >= 1", () => {
    // ch=10, interval=5 → target=5 ≥ 1 → true
    expect(should_run_retrospective(10, 5)).toBe(true);
    expect(should_run_retrospective(15, 5)).toBe(true);
    expect(should_run_retrospective(20, 5)).toBe(true);
  });

  it("returns false when chapterNum is not a multiple of interval", () => {
    expect(should_run_retrospective(3, 5)).toBe(false);
    expect(should_run_retrospective(7, 5)).toBe(false);
    expect(should_run_retrospective(11, 5)).toBe(false);
  });

  it("returns false when targetChapterNum (chapterNum - interval) < 1", () => {
    // ch=5, interval=5 → target=0 → false (N must be ≥ interval+1)
    expect(should_run_retrospective(5, 5)).toBe(false);
    // ch=6 → 6%5 !== 0 → false
    expect(should_run_retrospective(6, 5)).toBe(false);
  });

  it("RETROSPECTIVE_INTERVAL constant equals 5", () => {
    expect(RETROSPECTIVE_INTERVAL).toBe(5);
  });
});

describe("run_retrospective", () => {
  it("skips LLM call when no subsequent micro summaries exist", async () => {
    // chapters 6-10 have no micro
    const summaryRepo = fakeSummaryRepo({
      5: { standard: { version: 1, text: "ch5 standard", source_chapter_hash: "h5", generated_at: "t" } },
    });
    const chapterRepo = fakeChapterRepo("chapter 5 text");
    const llmProvider = fakeProvider("v2 text");
    const ragManager = fakeRagManager();

    await run_retrospective("/au", 5, chapterRepo, summaryRepo, ragManager, fakeEmbeddingProvider(), llmProvider, 11);

    expect(llmProvider.generate).not.toHaveBeenCalled();
    expect(summaryRepo.promote_to_v2).not.toHaveBeenCalled();
  });

  it("generates v2 when subsequent micros are present", async () => {
    const summaryRepo = fakeSummaryRepo({
      5: { standard: { version: 1, text: "ch5 standard", source_chapter_hash: "h5", generated_at: "t" } },
      6: { micro: { version: 1, text: "ch6 micro", source_chapter_hash: "h6", generated_at: "t" } },
      7: { micro: { version: 1, text: "ch7 micro", source_chapter_hash: "h7", generated_at: "t" } },
    });
    const chapterRepo = fakeChapterRepo("chapter 5 text");
    const llmProvider = fakeProvider("v2 retrospective text");
    const ragManager = fakeRagManager();

    await run_retrospective("/au", 5, chapterRepo, summaryRepo, ragManager, fakeEmbeddingProvider(), llmProvider, 11);

    expect(llmProvider.generate).toHaveBeenCalledOnce();
    expect(summaryRepo.promote_to_v2).toHaveBeenCalledWith("/au", 5, "v2 retrospective text", expect.any(String));
    expect(ragManager.indexChapterSummary).toHaveBeenCalledWith("/au", 5, "v2 retrospective text", expect.anything());
  });

  it("does NOT call promote_to_v2 when LLM returns null/empty", async () => {
    const summaryRepo = fakeSummaryRepo({
      5: { standard: { version: 1, text: "ch5", source_chapter_hash: "h5", generated_at: "t" } },
      6: { micro: { version: 1, text: "ch6 micro", source_chapter_hash: "h6", generated_at: "t" } },
    });
    const chapterRepo = fakeChapterRepo("text");
    const llmProvider = fakeProvider(""); // empty → null
    const ragManager = fakeRagManager();

    await run_retrospective("/au", 5, chapterRepo, summaryRepo, ragManager, fakeEmbeddingProvider(), llmProvider, 11);

    expect(summaryRepo.promote_to_v2).not.toHaveBeenCalled();
  });

  it("does not throw when targetChapterNum content is missing", async () => {
    const summaryRepo = fakeSummaryRepo({
      6: { micro: { version: 1, text: "ch6 micro", source_chapter_hash: "h6", generated_at: "t" } },
    });
    const chapterRepo = {
      get: vi.fn(async () => {
        throw new Error("chapter not found");
      }),
    } as any;
    const llmProvider = fakeProvider("v2");
    const ragManager = fakeRagManager();

    // Should not throw — best-effort
    await expect(
      run_retrospective("/au", 5, chapterRepo, summaryRepo, ragManager, fakeEmbeddingProvider(), llmProvider, 11),
    ).resolves.toBeUndefined();
    expect(llmProvider.generate).not.toHaveBeenCalled();
  });

  it("skips missing micro chapters without interrupting", async () => {
    // ch 6 missing, ch 7 has micro, ch 8 missing, ch 9 has micro
    const summaryRepo = fakeSummaryRepo({
      5: { standard: { version: 1, text: "ch5", source_chapter_hash: "h5", generated_at: "t" } },
      7: { micro: { version: 1, text: "ch7 micro", source_chapter_hash: "h7", generated_at: "t" } },
      9: { micro: { version: 1, text: "ch9 micro", source_chapter_hash: "h9", generated_at: "t" } },
    });
    const chapterRepo = fakeChapterRepo("ch5 text");
    const llmProvider = fakeProvider("v2 text");
    const ragManager = fakeRagManager();

    await run_retrospective("/au", 5, chapterRepo, summaryRepo, ragManager, fakeEmbeddingProvider(), llmProvider, 11);

    // Should still generate because at least some micros exist
    expect(llmProvider.generate).toHaveBeenCalledOnce();
    expect(summaryRepo.promote_to_v2).toHaveBeenCalledOnce();
  });

  it("审计⑤：genResult.contentHash 是章节 live content_hash（非摘要 source_chapter_hash），供 Phase2 CAS 比对", async () => {
    // 摘要里记的 source_chapter_hash 陈旧/不同 —— 修复前 contentHash 取的是这个（错），
    // 修复后取章节 get() 的 live content_hash，Phase2 才能检出「Phase1 后章节被编辑」。
    const summaryRepo = fakeSummaryRepo({
      5: {
        standard: { version: 1, text: "ch5 standard", source_chapter_hash: "STALE_SUMMARY_HASH", generated_at: "t" },
      },
      6: { micro: { version: 1, text: "ch6 micro", source_chapter_hash: "h6", generated_at: "t" } },
    });
    const chapterRepo = fakeChapterRepo("chapter 5 text", "LIVE_CHAPTER_HASH");
    const llmProvider = fakeProvider("v2 text");

    const res = await generate_retrospective("/au", 5, chapterRepo, summaryRepo, llmProvider, 11);

    expect(res).not.toBeNull();
    expect(res!.contentHash).toBe("LIVE_CHAPTER_HASH");
    expect(res!.contentHash).not.toBe("STALE_SUMMARY_HASH");
  });

  it("limits subsequent micros to chapters up to currentChapter - 1", async () => {
    const summaryRepo = fakeSummaryRepo({
      5: { standard: { version: 1, text: "ch5", source_chapter_hash: "h5", generated_at: "t" } },
      6: { micro: { version: 1, text: "ch6 micro", source_chapter_hash: "h6", generated_at: "t" } },
      7: { micro: { version: 1, text: "ch7 micro", source_chapter_hash: "h7", generated_at: "t" } },
      8: { micro: { version: 1, text: "ch8 micro", source_chapter_hash: "h8", generated_at: "t" } },
      9: { micro: { version: 1, text: "ch9 micro", source_chapter_hash: "h9", generated_at: "t" } },
      10: { micro: { version: 1, text: "ch10 micro", source_chapter_hash: "h10", generated_at: "t" } },
    });
    const chapterRepo = fakeChapterRepo("ch5 text");
    const llmProvider = fakeProvider("v2 text");
    const ragManager = fakeRagManager();

    // currentChapter = 11 → subsequent range = 6..10
    await run_retrospective("/au", 5, chapterRepo, summaryRepo, ragManager, fakeEmbeddingProvider(), llmProvider, 11);

    // summaryRepo.get should have been called for chapters 6..10 (not 11)
    const getCalls = summaryRepo.get.mock.calls.map((c: any[]) => c[1]);
    // target ch5 standard is read + chapters 6..10
    expect(getCalls).toContain(6);
    expect(getCalls).toContain(10);
    expect(getCalls).not.toContain(11);
  });
});

// L17（审计第二轮）：v2 落盘成功但摘要向量覆盖失败 → 置 index_status=STALE，让既有 stale 横幅接管。
describe("commit_retrospective — L17 向量覆盖失败置 STALE", () => {
  const genResult = { v2Text: "v2 text", contentHash: "h" };

  function fakeStateRepo() {
    const state = { index_status: IndexStatus.READY } as { index_status: IndexStatus };
    return {
      repo: {
        get: vi.fn(async () => state),
        save: vi.fn(async () => {}),
        update: vi.fn(async (_au: string, mut: (s: any) => void) => {
          mut(state);
          return state;
        }),
      } as any,
      state,
    };
  }

  it("indexChapterSummary 抛错 → state.update 置 STALE", async () => {
    const summaryRepo = fakeSummaryRepo({});
    const ragManager = {
      indexChapterSummary: vi.fn(async () => {
        throw new Error("embed fail");
      }),
    } as any;
    const { repo, state } = fakeStateRepo();

    await commit_retrospective("/au", 5, genResult, summaryRepo, ragManager, fakeEmbeddingProvider(), repo);

    expect(summaryRepo.promote_to_v2).toHaveBeenCalledOnce(); // v2 已落盘
    expect(repo.update).toHaveBeenCalledOnce();
    expect(state.index_status).toBe(IndexStatus.STALE);
  });

  it("向量覆盖成功 → 不置 STALE（不误伤）", async () => {
    const summaryRepo = fakeSummaryRepo({});
    const ragManager = fakeRagManager();
    const { repo, state } = fakeStateRepo();

    await commit_retrospective("/au", 5, genResult, summaryRepo, ragManager, fakeEmbeddingProvider(), repo);

    expect(repo.update).not.toHaveBeenCalled();
    expect(state.index_status).toBe(IndexStatus.READY);
  });

  it("未传 stateRepo → 向量失败时不抛（向后兼容 best-effort）", async () => {
    const summaryRepo = fakeSummaryRepo({});
    const ragManager = {
      indexChapterSummary: vi.fn(async () => {
        throw new Error("embed fail");
      }),
    } as any;
    await expect(
      commit_retrospective("/au", 5, genResult, summaryRepo, ragManager, fakeEmbeddingProvider()),
    ).resolves.toBeUndefined();
  });
});
