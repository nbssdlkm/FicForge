// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import { undoLatestChapter, UndoChapterError } from "../undo_chapter.js";
import { confirmChapter } from "../confirm_chapter.js";
import { addFact } from "../facts_lifecycle.js";
import { FactStatus } from "../../domain/enums.js";
import { createDraft } from "../../domain/draft.js";
import { createState } from "../../domain/state.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import { FileDraftRepository } from "../../repositories/implementations/file_draft.js";
import { FileStateRepository } from "../../repositories/implementations/file_state.js";
import { FileOpsRepository } from "../../repositories/implementations/file_ops.js";
import { FileFactRepository } from "../../repositories/implementations/file_fact.js";
import { PartialCommitError } from "../write_transaction.js";

describe("undo_latest_chapter", () => {
  let adapter: MockAdapter;
  let chapterRepo: FileChapterRepository;
  let draftRepo: FileDraftRepository;
  let stateRepo: FileStateRepository;
  let opsRepo: FileOpsRepository;
  let factRepo: FileFactRepository;

  beforeEach(() => {
    adapter = new MockAdapter();
    chapterRepo = new FileChapterRepository(adapter);
    draftRepo = new FileDraftRepository(adapter);
    stateRepo = new FileStateRepository(adapter);
    opsRepo = new FileOpsRepository(adapter);
    factRepo = new FileFactRepository(adapter);
  });

  // Helper: confirm a chapter with known content
  async function confirmN(chapterNum: number, content: string, cast?: { characters?: string[] }) {
    const state = await stateRepo.get("au1");
    state.current_chapter = chapterNum;
    await stateRepo.save(state);

    await draftRepo.save(
      createDraft({
        au_id: "au1",
        chapter_num: chapterNum,
        variant: "A",
        content,
      }),
    );

    await confirmChapter({
      au_id: "au1",
      chapter_num: chapterNum,
      draft_id: `ch${String(chapterNum).padStart(4, "0")}_draft_A.md`,
      cast_registry: cast ?? { characters: ["Alice", "Bob"] },
      chapter_repo: chapterRepo,
      draft_repo: draftRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
    });
  }

  it("throws when no chapters to undo", async () => {
    await stateRepo.save(createState({ au_id: "au1", current_chapter: 1 }));
    await expect(
      undoLatestChapter({
        au_id: "au1",
        chapter_repo: chapterRepo,
        draft_repo: draftRepo,
        state_repo: stateRepo,
        ops_repo: opsRepo,
        fact_repo: factRepo,
      }),
    ).rejects.toThrow(UndoChapterError);
  });

  it("章删失败时草稿保留、state 不回退、指针与磁盘自洽（盲审 R3 HIGH-1 门控回归）", async () => {
    class ChapterDeleteFailAdapter extends MockAdapter {
      fail = false;
      override async deleteFile(path: string): Promise<void> {
        if (this.fail && path.includes("chapters/main/ch0001.md")) {
          throw new Error("Injected chapter delete failure");
        }
        await super.deleteFile(path);
      }
    }
    const failAdapter = new ChapterDeleteFailAdapter();
    const cRepo = new FileChapterRepository(failAdapter);
    const dRepo = new FileDraftRepository(failAdapter);
    const sRepo = new FileStateRepository(failAdapter);
    const oRepo = new FileOpsRepository(failAdapter);
    const fRepo = new FileFactRepository(failAdapter);

    await sRepo.save(createState({ au_id: "au1", current_chapter: 1 }));
    await dRepo.save(
      createDraft({
        au_id: "au1",
        chapter_num: 1,
        variant: "A",
        content: "Alice站在窗前。",
      }),
    );
    await confirmChapter({
      au_id: "au1",
      chapter_num: 1,
      draft_id: "ch0001_draft_A.md",
      cast_registry: { characters: ["Alice"] },
      chapter_repo: cRepo,
      draft_repo: dRepo,
      state_repo: sRepo,
      ops_repo: oRepo,
    });
    await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "Alice在窗前",
        status: "active",
        type: "plot_event",
      },
      fRepo,
      oRepo,
    );
    // 第 2 章的在写草稿 —— undo 会级联清 ≥N 的草稿，用它验证门控保草稿
    await dRepo.save(
      createDraft({
        au_id: "au1",
        chapter_num: 2,
        variant: "A",
        content: "第二章草稿。",
      }),
    );

    failAdapter.fail = true;
    const error = await undoLatestChapter({
      au_id: "au1",
      cast_registry: { characters: ["Alice"] },
      chapter_repo: cRepo,
      draft_repo: dRepo,
      state_repo: sRepo,
      ops_repo: oRepo,
      fact_repo: fRepo,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PartialCommitError);
    const pce = error as PartialCommitError;
    expect(pce.failed).toEqual(["chapters"]);
    expect(pce.skipped).toEqual(["drafts", "state"]);
    expect(pce.completed).toEqual(expect.arrayContaining(["ops", "facts"]));

    // 磁盘终态自洽：章还在、指针未回退（undo 对持久 artifacts 视同没发生）、草稿保留
    expect(await cRepo.exists("au1", 1)).toBe(true);
    expect((await sRepo.get("au1")).current_chapter).toBe(2);
    expect(await dRepo.get("au1", 2, "A")).not.toBeNull();
    // 已知残留（修前即如此，与 ops 一致、重试 undo 可恢复）：facts 已按 ops 记录删除
    expect(await fRepo.listAll("au1")).toHaveLength(0);
  });

  it("normal undo: state rolls back", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));
    await confirmN(1, "Alice站在窗前。Bob走了进来。");

    let state = await stateRepo.get("au1");
    expect(state.current_chapter).toBe(2);

    const result = await undoLatestChapter({
      au_id: "au1",
      cast_registry: { characters: ["Alice", "Bob"] },
      chapter_repo: chapterRepo,
      draft_repo: draftRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
      fact_repo: factRepo,
    });

    expect(result.chapter_num).toBe(1);
    expect(result.new_current_chapter).toBe(1);

    state = await stateRepo.get("au1");
    expect(state.current_chapter).toBe(1);
    expect(state.chapter_focus).toEqual([]);

    // Chapter file deleted
    expect(await chapterRepo.exists("au1", 1)).toBe(false);

    // Ops logged
    const ops = await opsRepo.listAll("au1");
    const undoOps = ops.filter((o) => o.op_type === "undo_chapter");
    expect(undoOps).toHaveLength(1);
  });

  it("undo deletes facts created during that chapter", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));
    await confirmN(1, "Alice走了。");

    // Add facts for chapter 1 (via ops)
    await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "Alice离开了",
        status: "active",
        type: "plot_event",
      },
      factRepo,
      opsRepo,
    );

    let facts = await factRepo.listAll("au1");
    expect(facts).toHaveLength(1);

    await undoLatestChapter({
      au_id: "au1",
      chapter_repo: chapterRepo,
      draft_repo: draftRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
      fact_repo: factRepo,
    });

    facts = await factRepo.listAll("au1");
    expect(facts).toHaveLength(0);
  });

  it("undo with resolves cascade: target reverts to unresolved", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));

    // Pre-existing unresolved fact
    const f1 = await addFact(
      "au1",
      0,
      {
        content_raw: "r",
        content_clean: "mystery",
        status: "unresolved",
        type: "foreshadowing",
      },
      factRepo,
      opsRepo,
    );

    await confirmN(1, "Alice found the answer.");

    // Add resolving fact for chapter 1
    await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "answer",
        resolves: f1.id,
      },
      factRepo,
      opsRepo,
    );

    // f1 should now be RESOLVED
    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.RESOLVED);

    // Undo
    await undoLatestChapter({
      au_id: "au1",
      chapter_repo: chapterRepo,
      draft_repo: draftRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
      fact_repo: factRepo,
    });

    // f1 should revert to UNRESOLVED
    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.UNRESOLVED);
  });

  // TD-014 undo 对称性：deprecate 一个 resolver 触发的反向级联，其反向 op 用 deprecate 的 chapter_num 打标，
  // 该章被 undo 时 collectManualStatusRollback 回放，把目标恢复回 RESOLVED（揭示者也回来）。
  it("undo of a chapter that deprecated a resolver restores the target to RESOLVED (TD-014)", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));
    const f1 = await addFact(
      "au1",
      0,
      {
        content_raw: "r",
        content_clean: "mystery",
        status: "unresolved",
        type: "foreshadowing",
      },
      factRepo,
      opsRepo,
    );

    await confirmN(1, "Alice found the answer.");
    const f2 = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "answer",
        resolves: f1.id,
      },
      factRepo,
      opsRepo,
    );
    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.RESOLVED);

    // 在 ch2 里作废揭示者 f2 → TD-014 反向级联把 f1 退回 UNRESOLVED
    await confirmN(2, "Bob doubts the answer.");
    const { updateFactStatus } = await import("../facts_lifecycle.js");
    await updateFactStatus("au1", f2.id, "deprecated", 2, factRepo, opsRepo, stateRepo);
    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.UNRESOLVED);

    // undo ch2 → 回放 deprecate + 反向 op（都标 chapter_num=2）→ f1 回到 RESOLVED
    await undoLatestChapter({
      au_id: "au1",
      chapter_repo: chapterRepo,
      draft_repo: draftRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
      fact_repo: factRepo,
    });
    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.RESOLVED);
  });

  it("undo after two chapters: two undos work correctly", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));
    await confirmN(1, "第一章内容。Alice出场。");
    await confirmN(2, "第二章内容。Bob出场。");

    let state = await stateRepo.get("au1");
    expect(state.current_chapter).toBe(3);

    // Undo chapter 2
    await undoLatestChapter({
      au_id: "au1",
      cast_registry: { characters: ["Alice", "Bob"] },
      chapter_repo: chapterRepo,
      draft_repo: draftRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
      fact_repo: factRepo,
    });
    state = await stateRepo.get("au1");
    expect(state.current_chapter).toBe(2);
    expect(await chapterRepo.exists("au1", 1)).toBe(true);
    expect(await chapterRepo.exists("au1", 2)).toBe(false);

    // Undo chapter 1
    await undoLatestChapter({
      au_id: "au1",
      cast_registry: { characters: ["Alice", "Bob"] },
      chapter_repo: chapterRepo,
      draft_repo: draftRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
      fact_repo: factRepo,
    });
    state = await stateRepo.get("au1");
    expect(state.current_chapter).toBe(1);
    expect(await chapterRepo.exists("au1", 1)).toBe(false);
  });

  it("undo cleans chapters_dirty and chapter_titles", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));
    await confirmN(1, "内容。");

    // Manually add dirty and title
    const state = await stateRepo.get("au1");
    state.chapters_dirty = [1];
    state.chapter_titles = { 1: "测试标题" };
    await stateRepo.save(state);

    await undoLatestChapter({
      au_id: "au1",
      chapter_repo: chapterRepo,
      draft_repo: draftRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
      fact_repo: factRepo,
    });

    const newState = await stateRepo.get("au1");
    expect(newState.chapters_dirty).not.toContain(1);
    expect(newState.chapter_titles[1]).toBeUndefined();
  });

  it("last_scene_ending rolls back from ops snapshot", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));
    await confirmN(1, "第一章结尾句子。");
    await confirmN(2, "第二章结尾句子。");

    // After ch2, last_scene_ending is from ch2
    let state = await stateRepo.get("au1");
    expect(state.last_scene_ending).toContain("第二章");

    await undoLatestChapter({
      au_id: "au1",
      chapter_repo: chapterRepo,
      draft_repo: draftRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
      fact_repo: factRepo,
    });

    // After undo, should be from ch1 (via ops snapshot)
    state = await stateRepo.get("au1");
    expect(state.last_scene_ending).toContain("第一章");
  });
});
