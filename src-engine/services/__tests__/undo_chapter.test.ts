// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import { undo_latest_chapter, UndoChapterError } from "../undo_chapter.js";
import { confirm_chapter } from "../confirm_chapter.js";
import { add_fact } from "../facts_lifecycle.js";
import { FactStatus } from "../../domain/enums.js";
import { createDraft } from "../../domain/draft.js";
import { createState } from "../../domain/state.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import { FileDraftRepository } from "../../repositories/implementations/file_draft.js";
import { FileStateRepository } from "../../repositories/implementations/file_state.js";
import { FileOpsRepository } from "../../repositories/implementations/file_ops.js";
import { FileFactRepository } from "../../repositories/implementations/file_fact.js";

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
  async function confirmChapter(chapterNum: number, content: string, cast?: { characters?: string[] }) {
    const state = await stateRepo.get("au1");
    state.current_chapter = chapterNum;
    await stateRepo.save(state);

    await draftRepo.save(createDraft({
      au_id: "au1", chapter_num: chapterNum, variant: "A", content,
    }));

    await confirm_chapter({
      au_id: "au1", chapter_num: chapterNum,
      draft_id: `ch${String(chapterNum).padStart(4, "0")}_draft_A.md`,
      cast_registry: cast ?? { characters: ["Alice", "Bob"] },
      chapter_repo: chapterRepo, draft_repo: draftRepo, state_repo: stateRepo, ops_repo: opsRepo,
    });
  }

  it("throws when no chapters to undo", async () => {
    await stateRepo.save(createState({ au_id: "au1", current_chapter: 1 }));
    await expect(undo_latest_chapter({
      au_id: "au1", chapter_repo: chapterRepo, draft_repo: draftRepo,
      state_repo: stateRepo, ops_repo: opsRepo, fact_repo: factRepo,
    })).rejects.toThrow(UndoChapterError);
  });

  it("normal undo: state rolls back", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));
    await confirmChapter(1, "Alice站在窗前。Bob走了进来。");

    let state = await stateRepo.get("au1");
    expect(state.current_chapter).toBe(2);

    const result = await undo_latest_chapter({
      au_id: "au1", cast_registry: { characters: ["Alice", "Bob"] },
      chapter_repo: chapterRepo, draft_repo: draftRepo,
      state_repo: stateRepo, ops_repo: opsRepo, fact_repo: factRepo,
    });

    expect(result.chapter_num).toBe(1);
    expect(result.new_current_chapter).toBe(1);

    state = await stateRepo.get("au1");
    expect(state.current_chapter).toBe(1);
    expect(state.chapter_focus).toEqual([]);

    // Chapter file deleted
    expect(await chapterRepo.exists("au1", 1)).toBe(false);

    // Ops logged
    const ops = await opsRepo.list_all("au1");
    const undoOps = ops.filter((o) => o.op_type === "undo_chapter");
    expect(undoOps).toHaveLength(1);
  });

  it("undo deletes facts created during that chapter", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));
    await confirmChapter(1, "Alice走了。");

    // Add facts for chapter 1 (via ops)
    await add_fact("au1", 1, {
      content_raw: "r", content_clean: "Alice离开了",
      status: "active", type: "plot_event",
    }, factRepo, opsRepo);

    let facts = await factRepo.list_all("au1");
    expect(facts).toHaveLength(1);

    await undo_latest_chapter({
      au_id: "au1", chapter_repo: chapterRepo, draft_repo: draftRepo,
      state_repo: stateRepo, ops_repo: opsRepo, fact_repo: factRepo,
    });

    facts = await factRepo.list_all("au1");
    expect(facts).toHaveLength(0);
  });

  it("undo with resolves cascade: target reverts to unresolved", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));

    // Pre-existing unresolved fact
    const f1 = await add_fact("au1", 0, {
      content_raw: "r", content_clean: "mystery",
      status: "unresolved", type: "foreshadowing",
    }, factRepo, opsRepo);

    await confirmChapter(1, "Alice found the answer.");

    // Add resolving fact for chapter 1
    await add_fact("au1", 1, {
      content_raw: "r", content_clean: "answer",
      resolves: f1.id,
    }, factRepo, opsRepo);

    // f1 should now be RESOLVED
    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.RESOLVED);

    // Undo
    await undo_latest_chapter({
      au_id: "au1", chapter_repo: chapterRepo, draft_repo: draftRepo,
      state_repo: stateRepo, ops_repo: opsRepo, fact_repo: factRepo,
    });

    // f1 should revert to UNRESOLVED
    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.UNRESOLVED);
  });

  it("undo after two chapters: two undos work correctly", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));
    await confirmChapter(1, "第一章内容。Alice出场。");
    await confirmChapter(2, "第二章内容。Bob出场。");

    let state = await stateRepo.get("au1");
    expect(state.current_chapter).toBe(3);

    // Undo chapter 2
    await undo_latest_chapter({
      au_id: "au1", cast_registry: { characters: ["Alice", "Bob"] },
      chapter_repo: chapterRepo, draft_repo: draftRepo,
      state_repo: stateRepo, ops_repo: opsRepo, fact_repo: factRepo,
    });
    state = await stateRepo.get("au1");
    expect(state.current_chapter).toBe(2);
    expect(await chapterRepo.exists("au1", 1)).toBe(true);
    expect(await chapterRepo.exists("au1", 2)).toBe(false);

    // Undo chapter 1
    await undo_latest_chapter({
      au_id: "au1", cast_registry: { characters: ["Alice", "Bob"] },
      chapter_repo: chapterRepo, draft_repo: draftRepo,
      state_repo: stateRepo, ops_repo: opsRepo, fact_repo: factRepo,
    });
    state = await stateRepo.get("au1");
    expect(state.current_chapter).toBe(1);
    expect(await chapterRepo.exists("au1", 1)).toBe(false);
  });

  it("undo cleans chapters_dirty and chapter_titles", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));
    await confirmChapter(1, "内容。");

    // Manually add dirty and title
    const state = await stateRepo.get("au1");
    state.chapters_dirty = [1];
    state.chapter_titles = { 1: "测试标题" };
    await stateRepo.save(state);

    await undo_latest_chapter({
      au_id: "au1", chapter_repo: chapterRepo, draft_repo: draftRepo,
      state_repo: stateRepo, ops_repo: opsRepo, fact_repo: factRepo,
    });

    const newState = await stateRepo.get("au1");
    expect(newState.chapters_dirty).not.toContain(1);
    expect(newState.chapter_titles[1]).toBeUndefined();
  });

  it("last_scene_ending rolls back from ops snapshot", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));
    await confirmChapter(1, "第一章结尾句子。");
    await confirmChapter(2, "第二章结尾句子。");

    // After ch2, last_scene_ending is from ch2
    let state = await stateRepo.get("au1");
    expect(state.last_scene_ending).toContain("第二章");

    await undo_latest_chapter({
      au_id: "au1", chapter_repo: chapterRepo, draft_repo: draftRepo,
      state_repo: stateRepo, ops_repo: opsRepo, fact_repo: factRepo,
    });

    // After undo, should be from ch1 (via ops snapshot)
    state = await stateRepo.get("au1");
    expect(state.last_scene_ending).toContain("第一章");
  });
});
