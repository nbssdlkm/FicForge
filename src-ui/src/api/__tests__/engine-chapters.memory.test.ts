// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 补全旧章记忆（plan 3.1）API 层集成测试 —— scanChapterMemory（检测口径）+
 * backfillChapterMemory（逐章编排:摘要 persist、笔记自动落库、CAS、范围)。
 * 引擎 loop/中断/CAS 已在 backfill_memory.test.ts 单测;这里验 API 接线 + 检测。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as engineModule from "@ficforge/engine";
import { createDraft, createChapterSummary, now_utc } from "@ficforge/engine";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";
import { confirmChapter, scanChapterMemory, backfillChapterMemory } from "../engine-chapters";
import { addFact } from "../engine-facts";
import { createAu, createFandom } from "../engine-fandom";
import { getEngine, initEngine } from "../engine-instance";

let adapter: MockAdapter;
let auPath: string;

async function enableEmbedding() {
  const s = await getEngine().repos.settings.get();
  s.embedding.api_base = "https://embed.example.com/v1";
  s.embedding.api_key = "embed-secret";
  s.embedding.model = "embed-test";
  await getEngine().repos.settings.save(s);
}
async function enableLLM() {
  const proj = await getEngine().repos.project.get(auPath);
  proj.llm.mode = engineModule.LLMMode.API;
  proj.llm.model = "gpt-test";
  proj.llm.api_base = "https://llm.example.com/v1";
  proj.llm.api_key = "llm-secret";
  await getEngine().repos.project.save(proj);
}
async function setReactExtraction(enabled: boolean) {
  const s = await getEngine().repos.settings.get();
  s.app.react_extraction_enabled = enabled;
  await getEngine().repos.settings.save(s);
}

/** 定稿 N 章（embedding 未配 → 无自动摘要/RAG，留给 backfill 补）。 */
async function confirmChapters(n: number) {
  for (let i = 1; i <= n; i++) {
    await getEngine().repos.draft.save(createDraft({
      au_id: auPath, chapter_num: i, variant: "A",
      content: `第 ${i} 章正文。Alice 做了某事。`,
    }));
    await confirmChapter(auPath, i, `ch${String(i).padStart(4, "0")}_draft_A.md`);
  }
}

beforeEach(async () => {
  vi.restoreAllMocks();
  adapter = new MockAdapter();
  initEngine(adapter, "/data");
  const fandom = await createFandom("Naruto");
  const au = await createAu(fandom.name, "Canon", fandom.path);
  auPath = au.path;
});

describe("scanChapterMemory", () => {
  it("扫出缺摘要章 ∪ 零笔记章 + 每章笔记数 + 前置配置", async () => {
    await confirmChapters(2);
    // ch1 加一条笔记；ch2 加一条摘要
    await addFact(auPath, 1, {
      content_clean: "Alice 拿到了钥匙", type: "plot_event",
      narrative_weight: "medium", status: "active", characters: ["Alice"],
    });
    await getEngine().repos.chapterSummary.save(auPath, 2, createChapterSummary({
      standard: { version: 1, text: "第二章摘要", generated_at: now_utc(), source_chapter_hash: "h" },
    }));

    const scan = await scanChapterMemory(auPath);
    expect(scan.totalConfirmed).toBe(2);
    expect(scan.chaptersMissingSummary).toEqual([1]); // ch2 有摘要
    expect(scan.chaptersZeroFacts).toEqual([2]);       // ch1 有笔记
    expect(scan.factCountByChapter).toEqual({ 1: 1, 2: 0 });
    expect(scan.embeddingConfigured).toBe(false);      // 尚未配
    expect(scan.llmConfigured).toBe(false);
  });

  it("配好 embedding+LLM 后前置标 true", async () => {
    await confirmChapters(1);
    await enableEmbedding();
    await enableLLM();
    const scan = await scanChapterMemory(auPath);
    expect(scan.embeddingConfigured).toBe(true);
    expect(scan.llmConfigured).toBe(true);
  });
});

describe("backfillChapterMemory", () => {
  beforeEach(async () => {
    await confirmChapters(2);
    await enableEmbedding();
    await enableLLM();
    await setReactExtraction(false); // 走 plain 提取，便于 spy
    // 避开真实 embedding / LLM
    vi.spyOn(getEngine().ragManager, "indexChapter").mockResolvedValue(undefined);
    vi.spyOn(getEngine().ragManager, "indexChapterSummary").mockResolvedValue(undefined);
    vi.spyOn(engineModule, "generate_standard_summary").mockImplementation(
      async (_text: string, num: number) => `摘要-${num}`,
    );
    vi.spyOn(engineModule, "extract_facts_from_chapter").mockImplementation(
      (async (_content: string, num: number) => [{
        content_raw: "", content_clean: `第${num}章事实`, characters: [],
        narrative_weight: "medium", status: "active", fact_type: "plot_event", chapter: num,
      }]) as unknown as typeof engineModule.extract_facts_from_chapter,
    );
  });

  it("未配 embedding/LLM → 抛前置错误", async () => {
    // 用一篇全新未配置的 AU
    const fandom = await createFandom("Other");
    const au = await createAu(fandom.name, "AU2", fandom.path);
    await expect(backfillChapterMemory(au.path, { factsChapters: [] }))
      .rejects.toThrow(/embedding and LLM must be configured/);
  });

  it("摘要补所有缺章;笔记只对勾选章;落盘 + 计数正确", async () => {
    const res = await backfillChapterMemory(auPath, { factsChapters: [1, 2] });

    // 两章摘要都落盘
    const s1 = await getEngine().repos.chapterSummary.get(auPath, 1);
    const s2 = await getEngine().repos.chapterSummary.get(auPath, 2);
    expect(s1?.standard?.text).toBe("摘要-1");
    expect(s2?.standard?.text).toBe("摘要-2");
    // 两章各落一条笔记
    const facts = await getEngine().repos.fact.list_all(auPath);
    expect(facts.length).toBe(2);
    // 两章正文进索引
    expect(getEngine().ragManager.indexChapter).toHaveBeenCalledTimes(2);

    expect(res).toMatchObject({
      total: 2, summariesGenerated: 2, factsChapters: 2, factsAdded: 2,
      indexed: 2, skipped: 0, failed: 0, aborted: false,
    });
  });

  it("factsChapters 只含 ch1 → 仅 ch1 提笔记,ch2 只补摘要", async () => {
    const res = await backfillChapterMemory(auPath, { factsChapters: [1] });
    const facts = await getEngine().repos.fact.list_all(auPath);
    expect(facts.length).toBe(1);
    expect(facts[0].chapter).toBe(1);
    expect(engineModule.extract_facts_from_chapter).toHaveBeenCalledTimes(1);
    // 两章都缺摘要 → 都补
    expect(res).toMatchObject({ summariesGenerated: 2, factsChapters: 1, factsAdded: 1, indexed: 2 });
  });

  it("落盘中途抛错(indexChapter 失败) → 标 index_status=STALE 且计 failed", async () => {
    // ch1 的正文索引失败 → 半成功(摘要/笔记可能已落)→ 标 STALE 让用户重建/重跑修复。
    vi.spyOn(getEngine().ragManager, "indexChapter").mockImplementation(
      async (_au: string, num: number) => { if (num === 1) throw new Error("embed offline"); },
    );
    const res = await backfillChapterMemory(auPath, { factsChapters: [1, 2] });
    expect(res.failed).toBe(1);          // ch1 计 failed
    expect(res.indexed).toBe(1);         // ch2 正常
    const st = await getEngine().repos.state.get(auPath);
    expect(st.index_status).toBe(engineModule.IndexStatus.STALE);
  });

  it("CAS:target 建好后章节内容变了(hash 不符) → 跳过该章不写陈旧数据", async () => {
    // 模拟「批量跑期间用户 edit/undo 了 ch1」:list_main 建 target 时拿到原 hash,
    // 之后 persist 锁内复查 chapter.get 才返回新 hash → CAS 失败 → 跳过。
    // 注:list_main 内部也走 chapter.get,故用「第 2 次起的 get(1)」(= CAS 复查)才改 hash。
    const realGet = getEngine().repos.chapter.get.bind(getEngine().repos.chapter);
    let ch1Calls = 0;
    vi.spyOn(getEngine().repos.chapter, "get").mockImplementation(async (au: string, num: number) => {
      const ch = await realGet(au, num);
      if (num === 1) {
        ch1Calls += 1;
        if (ch1Calls >= 2) return { ...ch, content_hash: "CHANGED" };
      }
      return ch;
    });

    const res = await backfillChapterMemory(auPath, { factsChapters: [1, 2] });
    // ch1 被 CAS 跳过;ch2 正常
    expect(res.skipped).toBe(1);
    expect(res.indexed).toBe(1);
    const s1 = await getEngine().repos.chapterSummary.get(auPath, 1);
    expect(s1?.standard?.text).toBeFalsy(); // ch1 未落摘要
    const facts = await getEngine().repos.fact.list_all(auPath);
    expect(facts.every((f) => f.chapter !== 1)).toBe(true); // ch1 未落笔记
  });
});
