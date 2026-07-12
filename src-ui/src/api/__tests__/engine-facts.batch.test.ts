// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * addFactsBatch（交互式接受提取事实的批量落库，MED-1）判别性测试。
 *
 * 核心保证：整批在**一次** withAuLock 内完成 + 逐章存在性 CAS。回退到「逐条 addFact」
 * 或删掉存在性校验都会让并发 undo 在批次间隙插入 → 目标章被撤销后仍写向该章 = 孤儿事实。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDraft } from "@ficforge/engine";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";
import { confirmChapter, undoChapter } from "../engine-chapters";
import { addFact, addFactsBatch, editFact, PartialAddFactsError, type BatchFactInput } from "../engine-facts";
import { createAu, createFandom } from "../engine-fandom";
import { getEngine, initEngine } from "../engine-instance";
import { saveLore } from "../engine-lore";

let adapter: MockAdapter;
let auPath: string;

async function confirmChapters(n: number) {
  for (let i = 1; i <= n; i++) {
    await getEngine().repos.draft.save(
      createDraft({
        au_id: auPath,
        chapter_num: i,
        variant: "A",
        content: `第 ${i} 章正文。Alice 做了某事。`,
      }),
    );
    await confirmChapter(auPath, i, `ch${String(i).padStart(4, "0")}_draft_A.md`);
  }
}

function factInput(chapterNum: number, content: string): BatchFactInput {
  return {
    chapterNum,
    data: {
      content_clean: content,
      content_raw: content,
      type: "plot_event",
      narrative_weight: "medium",
      status: "active",
      characters: ["Alice"],
    },
  };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  adapter = new MockAdapter();
  initEngine(adapter, "/data");
  const fandom = await createFandom("Naruto");
  const au = await createAu(fandom.name, "Canon", fandom.path);
  auPath = au.path;
});

describe("addFactsBatch", () => {
  it("目标章存在 → 全批落库", async () => {
    await confirmChapters(2);
    const r = await addFactsBatch(auPath, [factInput(1, "a"), factInput(1, "b"), factInput(2, "c")]);
    expect(r.added).toBe(3);
    expect(r.skipped).toBe(0);
    const all = await getEngine().repos.fact.list_all(auPath);
    expect(all.length).toBe(3);
  });

  it("目标章已被撤销（删除）→ 整批跳过，不写孤儿事实", async () => {
    await confirmChapters(1);
    // 章 1 存在；对不存在的章 5 落库 → 存在性 CAS 拒绝
    const r = await addFactsBatch(auPath, [factInput(5, "orphan-a"), factInput(5, "orphan-b")]);
    expect(r.added).toBe(0);
    expect(r.skipped).toBe(2);
    const all = await getEngine().repos.fact.list_all(auPath);
    expect(all.length).toBe(0); // 零孤儿：删掉存在性校验则会写入 2 条 → 此断言挂
  });

  it("混合：存在章落库、被撤销章跳过", async () => {
    await confirmChapters(2);
    const r = await addFactsBatch(auPath, [factInput(1, "keep"), factInput(9, "orphan"), factInput(2, "keep2")]);
    expect(r.added).toBe(2);
    expect(r.skipped).toBe(1);
    const all = await getEngine().repos.fact.list_all(auPath);
    expect(all.map((f) => f.chapter).sort()).toEqual([1, 2]);
    expect(all.every((f) => f.chapter !== 9)).toBe(true);
  });

  it("并发 undo 无法插进批次：终态无孤儿（单锁原子性）", async () => {
    await confirmChapters(2); // current_chapter=3，最后确认章=2
    const targets: BatchFactInput[] = [
      factInput(2, "f1"),
      factInput(2, "f2"),
      factInput(2, "f3"),
      factInput(2, "f4"),
      factInput(2, "f5"),
    ];
    // 在每条 fact 落盘之间注入 await 让步——若批次不是单锁，undo 就能在让步点插入。
    const realAppend = getEngine().repos.fact.append.bind(getEngine().repos.fact);
    vi.spyOn(getEngine().repos.fact, "append").mockImplementation(async (au, f) => {
      await new Promise((res) => setTimeout(res, 1));
      return realAppend(au, f);
    });

    // 并发发起批量落库与撤销最后一章。两者都排队在同一 AU 锁上，必然串行。
    await Promise.all([
      addFactsBatch(auPath, targets).catch(() => {
        /* 撤销先行时批次整体 skip，不抛 */
      }),
      undoChapter(auPath),
    ]);

    // 无论谁先拿锁：
    //  - 批次先：5 条写入章 2 → undo 删章 2 + 其 add_fact ops 对应的 5 条 → 终态 0
    //  - undo 先：章 2 删除 → 批次 exists(2)=false → 全 skip → 终态 0
    // 逐条加锁的旧写法会在让步点被 undo 插入 → 残留 3 条指向已删章 2 的孤儿 → 此断言挂。
    const all = await getEngine().repos.fact.list_all(auPath);
    const orphans = all.filter((f) => f.chapter === 2);
    expect(orphans.length).toBe(0);
  });

  it("半成功：某条 append 抛错 → PartialAddFactsError 携已写入数", async () => {
    await confirmChapters(1);
    let calls = 0;
    const realAppend = getEngine().repos.fact.append.bind(getEngine().repos.fact);
    vi.spyOn(getEngine().repos.fact, "append").mockImplementation(async (au, f) => {
      calls += 1;
      if (calls === 3) throw new Error("disk full");
      return realAppend(au, f);
    });

    const targets = [factInput(1, "a"), factInput(1, "b"), factInput(1, "c"), factInput(1, "d")];
    const err = await addFactsBatch(auPath, targets).catch((e) => e);
    expect(err).toBeInstanceOf(PartialAddFactsError);
    expect((err as PartialAddFactsError).added).toBe(2); // 前两条已落盘，供调用方去重
    // 落盘的确实只有前两条（第 3 条抛错、第 4 条未尝试）
    const all = await getEngine().repos.fact.list_all(auPath);
    expect(all.length).toBe(2);
  });
});

describe("落库/编辑按角色卡别名表归一化（M3 别名表接通）", () => {
  beforeEach(async () => {
    await confirmChapters(1);
    await saveLore({
      au_path: auPath,
      category: "characters",
      filename: "Alice.md",
      content: "---\nname: Alice\naliases: [小爱]\n---\n\n# Alice\n",
    });
  });

  it("addFact / addFactsBatch：characters 与 known_to 落库前归一化", async () => {
    await addFact(auPath, 1, {
      ...factInput(1, "小爱做了某事").data,
      characters: ["小爱"],
      known_to: ["小爱"],
    });
    const r = await addFactsBatch(auPath, [
      {
        chapterNum: 1,
        data: { ...factInput(1, "小爱又做了某事").data, characters: ["小爱", "Alice"] },
      },
    ]);
    expect(r.added).toBe(1);

    const all = await getEngine().repos.fact.list_all(auPath);
    expect(all).toHaveLength(2);
    expect(all[0].characters).toEqual(["Alice"]);
    expect(all[0].known_to).toEqual(["Alice"]);
    expect(all[1].characters).toEqual(["Alice"]); // 别名+主名混写 → 归一化后去重
  });

  it("editFact：编辑 characters / hidden_from 按表归一化", async () => {
    await addFact(auPath, 1, factInput(1, "Alice 的一条事实").data);
    const [fact] = await getEngine().repos.fact.list_all(auPath);

    const updated = await editFact(auPath, fact.id, {
      characters: ["小爱"],
      hidden_from: ["小爱"],
    });
    expect(updated.characters).toEqual(["Alice"]);
    expect(updated.hidden_from).toEqual(["Alice"]);
  });
});
