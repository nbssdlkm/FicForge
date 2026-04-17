// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * confirm-undo-rebuild closed-loop integration tests.
 *
 * The most critical integration gap: verifies the full lifecycle
 * confirm → add facts → undo → rebuild from ops → state/facts consistency.
 *
 * Invariant: at every step, rebuildStateFromOps(ops) == repo state
 * and rebuildFactsFromOps(ops) == repo facts.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { confirm_chapter } from "../confirm_chapter.js";
import { undo_latest_chapter } from "../undo_chapter.js";
import { add_fact, edit_fact, update_fact_status, set_chapter_focus } from "../facts_lifecycle.js";
import { FactStatus } from "../../domain/enums.js";
import { createDraft } from "../../domain/draft.js";
import { createState } from "../../domain/state.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import { FileDraftRepository } from "../../repositories/implementations/file_draft.js";
import { FileStateRepository } from "../../repositories/implementations/file_state.js";
import { FileOpsRepository } from "../../repositories/implementations/file_ops.js";
import { FileFactRepository } from "../../repositories/implementations/file_fact.js";
import { rebuildStateFromOps, rebuildFactsFromOps, mergeOps } from "../../sync/ops_merge.js";

describe("confirm-undo-rebuild closed-loop", () => {
  let adapter: MockAdapter;
  let chapterRepo: FileChapterRepository;
  let draftRepo: FileDraftRepository;
  let stateRepo: FileStateRepository;
  let opsRepo: FileOpsRepository;
  let factRepo: FileFactRepository;

  const cast = { characters: ["Alice", "Bob", "Charlie"] };

  beforeEach(() => {
    adapter = new MockAdapter();
    chapterRepo = new FileChapterRepository(adapter);
    draftRepo = new FileDraftRepository(adapter);
    stateRepo = new FileStateRepository(adapter);
    opsRepo = new FileOpsRepository(adapter);
    factRepo = new FileFactRepository(adapter);
  });

  async function confirmCh(num: number, content: string) {
    const state = await stateRepo.get("au1");
    state.current_chapter = num;
    await stateRepo.save(state);

    await draftRepo.save(createDraft({
      au_id: "au1", chapter_num: num, variant: "A", content,
    }));

    return confirm_chapter({
      au_id: "au1", chapter_num: num,
      draft_id: `ch${String(num).padStart(4, "0")}_draft_A.md`,
      cast_registry: cast,
      chapter_repo: chapterRepo, draft_repo: draftRepo,
      state_repo: stateRepo, ops_repo: opsRepo,
    });
  }

  async function undoCh() {
    return undo_latest_chapter({
      au_id: "au1", cast_registry: cast,
      chapter_repo: chapterRepo, draft_repo: draftRepo,
      state_repo: stateRepo, ops_repo: opsRepo, fact_repo: factRepo,
    });
  }

  async function getRebuiltState() {
    const ops = await opsRepo.list_all("au1");
    const { ops: sorted } = mergeOps(ops, []);
    return rebuildStateFromOps(sorted, "au1");
  }

  async function getRebuiltFacts() {
    const ops = await opsRepo.list_all("au1");
    const { ops: sorted } = mergeOps(ops, []);
    return rebuildFactsFromOps(sorted);
  }

  function assertStateCoreMatch(repo: { current_chapter: number; chapter_focus: string[] },
    rebuilt: { current_chapter: number; chapter_focus: string[] }) {
    expect(rebuilt.current_chapter).toBe(repo.current_chapter);
    expect(rebuilt.chapter_focus).toEqual(repo.chapter_focus);
  }

  function assertFactsMatch(
    repoFacts: { id: string; status: string; content_clean: string }[],
    rebuiltFacts: { id: string; status: string; content_clean: string }[],
  ) {
    expect(rebuiltFacts.length).toBe(repoFacts.length);
    const repoById = new Map(repoFacts.map((f) => [f.id, f]));
    for (const rf of rebuiltFacts) {
      const expected = repoById.get(rf.id);
      expect(expected).toBeDefined();
      expect(rf.status).toBe(expected!.status);
      expect(rf.content_clean).toBe(expected!.content_clean);
    }
  }

  // ---------------------------------------------------------
  // 6.4.1 Full lifecycle: confirm 3 → add facts → undo 1 → re-confirm
  // ---------------------------------------------------------

  it("full lifecycle: confirm → facts → undo → re-confirm → state matches rebuild", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));

    // Step 1: Confirm chapters 1-3
    await confirmCh(1, "Alice走在大街上。Bob迎面走来。");
    await confirmCh(2, "Charlie从角落出现了。Alice微微一笑。");
    await confirmCh(3, "Bob拿出了一封信。Charlie接了过去。");

    // Step 2: Add facts across chapters
    const f1 = await add_fact("au1", 1, {
      content_raw: "r", content_clean: "Alice和Bob在大街相遇",
      status: "active", type: "plot_event",
    }, factRepo, opsRepo);

    const f2 = await add_fact("au1", 2, {
      content_raw: "r", content_clean: "Charlie突然出现",
      status: "unresolved", type: "foreshadowing",
    }, factRepo, opsRepo);

    const f3 = await add_fact("au1", 3, {
      content_raw: "r", content_clean: "信的内容不明",
      status: "active", type: "plot_event",
    }, factRepo, opsRepo);

    // Verify: 3 facts exist, state at chapter 4
    let repoState = await stateRepo.get("au1");
    let rebuiltState = await getRebuiltState();
    assertStateCoreMatch(repoState, rebuiltState);

    let repoFacts = await factRepo.list_all("au1");
    let rebuiltFacts = await getRebuiltFacts();
    assertFactsMatch(repoFacts, rebuiltFacts);
    expect(repoFacts).toHaveLength(3);

    // Step 3: Undo chapter 3
    await undoCh();

    repoState = await stateRepo.get("au1");
    rebuiltState = await getRebuiltState();
    assertStateCoreMatch(repoState, rebuiltState);
    expect(repoState.current_chapter).toBe(3);

    repoFacts = await factRepo.list_all("au1");
    rebuiltFacts = await getRebuiltFacts();
    assertFactsMatch(repoFacts, rebuiltFacts);
    // f3 (chapter 3) should be deleted
    expect(repoFacts).toHaveLength(2);
    expect(repoFacts.find((f) => f.id === f3.id)).toBeUndefined();

    // Step 4: Re-confirm chapter 3 with new content
    await confirmCh(3, "Bob展开信纸，上面写着'秘密'。Alice凑了过来。");

    repoState = await stateRepo.get("au1");
    rebuiltState = await getRebuiltState();
    assertStateCoreMatch(repoState, rebuiltState);
    expect(repoState.current_chapter).toBe(4);

    // Add new fact for re-confirmed chapter 3
    const f3b = await add_fact("au1", 3, {
      content_raw: "r", content_clean: "信上写着'秘密'",
      status: "active", type: "plot_event",
    }, factRepo, opsRepo);

    repoFacts = await factRepo.list_all("au1");
    rebuiltFacts = await getRebuiltFacts();
    assertFactsMatch(repoFacts, rebuiltFacts);
    expect(repoFacts).toHaveLength(3); // f1, f2, f3b
  });

  // ---------------------------------------------------------
  // 6.4.2 Resolves chain: foreshadow → resolve → undo → verify cascade
  // ---------------------------------------------------------

  it("resolves chain: create foreshadowing → resolve in later chapter → undo → cascade verified", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));

    // Chapter 1: introduce foreshadowing
    await confirmCh(1, "一个神秘的包裹出现了。Alice感到不安。");

    const foreshadow = await add_fact("au1", 1, {
      content_raw: "r", content_clean: "神秘包裹的来源不明",
      status: "unresolved", type: "foreshadowing",
    }, factRepo, opsRepo);

    // Chapter 2: resolve the foreshadowing
    await confirmCh(2, "包裹是Bob寄来的。真相大白。");

    const resolution = await add_fact("au1", 2, {
      content_raw: "r", content_clean: "包裹是Bob寄的",
      resolves: foreshadow.id,
    }, factRepo, opsRepo);

    // Verify: foreshadow resolved
    expect((await factRepo.get("au1", foreshadow.id))!.status).toBe(FactStatus.RESOLVED);

    let repoFacts = await factRepo.list_all("au1");
    let rebuiltFacts = await getRebuiltFacts();
    assertFactsMatch(repoFacts, rebuiltFacts);

    // Undo chapter 2 → cascade should revert foreshadow to UNRESOLVED
    await undoCh();

    expect((await factRepo.get("au1", foreshadow.id))!.status).toBe(FactStatus.UNRESOLVED);

    repoFacts = await factRepo.list_all("au1");
    rebuiltFacts = await getRebuiltFacts();
    assertFactsMatch(repoFacts, rebuiltFacts);

    // Resolution fact should be deleted (it was from chapter 2)
    expect(repoFacts.find((f) => f.id === resolution.id)).toBeUndefined();
    expect(repoFacts).toHaveLength(1);
    expect(repoFacts[0].id).toBe(foreshadow.id);
  });

  // ---------------------------------------------------------
  // 6.4.3 Focus lifecycle: set focus → confirm → undo → focus cleared
  // ---------------------------------------------------------

  it("focus lifecycle: set → confirm clears → undo restores to empty", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));

    // Add a foreshadowing fact
    const f1 = await add_fact("au1", 0, {
      content_raw: "r", content_clean: "待解决的伏笔",
      status: "unresolved", type: "foreshadowing",
    }, factRepo, opsRepo);

    // Set focus
    await set_chapter_focus("au1", [f1.id], factRepo, opsRepo, stateRepo);

    let repoState = await stateRepo.get("au1");
    expect(repoState.chapter_focus).toEqual([f1.id]);

    let rebuiltState = await getRebuiltState();
    expect(rebuiltState.chapter_focus).toEqual([f1.id]);

    // Confirm chapter 1 → clears focus
    await confirmCh(1, "Alice开始调查。Bob也加入了。");

    repoState = await stateRepo.get("au1");
    expect(repoState.chapter_focus).toEqual([]);
    expect(repoState.last_confirmed_chapter_focus).toEqual([f1.id]);

    rebuiltState = await getRebuiltState();
    expect(rebuiltState.chapter_focus).toEqual([]);
    expect(rebuiltState.last_confirmed_chapter_focus).toEqual([f1.id]);

    // Undo → focus still empty (undo always clears focus)
    await undoCh();

    repoState = await stateRepo.get("au1");
    expect(repoState.chapter_focus).toEqual([]);

    rebuiltState = await getRebuiltState();
    expect(rebuiltState.chapter_focus).toEqual([]);
  });

  // ---------------------------------------------------------
  // 6.4.4 Status change + undo: manual deprecation reversed
  // ---------------------------------------------------------

  it("manual fact status change → undo reverts in repo (known ops rebuild gap)", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));

    // Pre-existing fact
    const f1 = await add_fact("au1", 0, {
      content_raw: "r", content_clean: "一个基础设定",
      status: "active", type: "backstory",
    }, factRepo, opsRepo);

    await confirmCh(1, "故事开始了。Alice站了起来。");

    // During chapter 1, manually deprecate f1
    await update_fact_status("au1", f1.id, "deprecated", 1, factRepo, opsRepo, stateRepo);
    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.DEPRECATED);

    // Verify rebuild matches BEFORE undo
    let repoFacts = await factRepo.list_all("au1");
    let rebuiltFacts = await getRebuiltFacts();
    assertFactsMatch(repoFacts, rebuiltFacts);

    // Undo → reverts status in repo
    await undoCh();

    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.ACTIVE);

    // KNOWN GAP: undo's collectManualStatusRollback reverts the fact in repo
    // but does NOT emit an ops entry for the rollback. rebuildFactsFromOps
    // therefore still shows "deprecated". This is a consistency gap.
    repoFacts = await factRepo.list_all("au1");
    rebuiltFacts = await getRebuiltFacts();
    expect(repoFacts).toHaveLength(1);
    expect(rebuiltFacts).toHaveLength(1);
    // Repo: correctly reverted to "active"
    expect(repoFacts[0].status).toBe("active");
    // Rebuild: stays "deprecated" (no rollback op emitted)
    expect(rebuiltFacts[0].status).toBe("deprecated");
  });

  // ---------------------------------------------------------
  // 6.4.5 Edit fact + undo: fact content persists for non-chapter facts
  // ---------------------------------------------------------

  it("edit pre-existing fact during chapter → undo → edit still applies (fact is not chapter-scoped)", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));

    // Pre-existing fact from chapter 0
    const f1 = await add_fact("au1", 0, {
      content_raw: "r", content_clean: "原始内容",
      status: "active", type: "character_detail",
    }, factRepo, opsRepo);

    await confirmCh(1, "Alice思考着。");

    // Edit the fact (not chapter-scoped, so it survives undo)
    await edit_fact("au1", f1.id, {
      content_clean: "修改后的内容",
    }, factRepo, opsRepo, stateRepo);

    expect((await factRepo.get("au1", f1.id))!.content_clean).toBe("修改后的内容");

    // Undo chapter 1 → f1 still exists with edited content
    await undoCh();

    const fact = await factRepo.get("au1", f1.id);
    expect(fact).not.toBeNull();
    // The edit was on a chapter-0 fact, so undo doesn't affect it
    // (undo only deletes facts added during the undone chapter)
    expect(fact!.content_clean).toBe("修改后的内容");

    const repoFacts = await factRepo.list_all("au1");
    const rebuiltFacts = await getRebuiltFacts();
    assertFactsMatch(repoFacts, rebuiltFacts);
  });

  // ---------------------------------------------------------
  // 6.4.6 Rapid confirm-undo cycle: 5 rounds
  // ---------------------------------------------------------

  it("5 rapid confirm-undo cycles: state remains consistent", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));

    for (let round = 1; round <= 5; round++) {
      await confirmCh(1, `第 ${round} 次尝试。Alice在场。Bob也在。`);

      const repoState = await stateRepo.get("au1");
      const rebuiltState = await getRebuiltState();
      assertStateCoreMatch(repoState, rebuiltState);
      expect(repoState.current_chapter).toBe(2);

      await undoCh();

      const repoState2 = await stateRepo.get("au1");
      const rebuiltState2 = await getRebuiltState();
      assertStateCoreMatch(repoState2, rebuiltState2);
      expect(repoState2.current_chapter).toBe(1);
    }

    // After 5 rounds, should be back at chapter 1
    const finalState = await stateRepo.get("au1");
    expect(finalState.current_chapter).toBe(1);

    // Ops should record all 10 operations (5 confirms + 5 undos)
    const ops = await opsRepo.list_all("au1");
    const confirms = ops.filter((o) => o.op_type === "confirm_chapter");
    const undos = ops.filter((o) => o.op_type === "undo_chapter");
    expect(confirms).toHaveLength(5);
    expect(undos).toHaveLength(5);
  });

  // ---------------------------------------------------------
  // 6.4.7 Mixed facts across chapters: undo only deletes target chapter facts
  // ---------------------------------------------------------

  it("facts from multiple chapters → undo only removes target chapter facts", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));

    await confirmCh(1, "Alice出门了。");
    const f1a = await add_fact("au1", 1, {
      content_raw: "r", content_clean: "Alice出门",
      status: "active", type: "plot_event",
    }, factRepo, opsRepo);
    const f1b = await add_fact("au1", 1, {
      content_raw: "r", content_clean: "天气晴朗",
      status: "active", type: "world_rule",
    }, factRepo, opsRepo);

    await confirmCh(2, "Bob打电话。");
    const f2a = await add_fact("au1", 2, {
      content_raw: "r", content_clean: "Bob打了电话",
      status: "active", type: "plot_event",
    }, factRepo, opsRepo);

    await confirmCh(3, "Charlie来了。");
    const f3a = await add_fact("au1", 3, {
      content_raw: "r", content_clean: "Charlie到场",
      status: "active", type: "plot_event",
    }, factRepo, opsRepo);

    expect(await factRepo.list_all("au1")).toHaveLength(4);

    // Undo chapter 3 → only f3a deleted
    await undoCh();

    let repoFacts = await factRepo.list_all("au1");
    expect(repoFacts).toHaveLength(3);
    expect(repoFacts.find((f) => f.id === f3a.id)).toBeUndefined();
    expect(repoFacts.find((f) => f.id === f1a.id)).toBeDefined();
    expect(repoFacts.find((f) => f.id === f2a.id)).toBeDefined();

    let rebuiltFacts = await getRebuiltFacts();
    assertFactsMatch(repoFacts, rebuiltFacts);

    // Undo chapter 2 → f2a deleted
    await undoCh();

    repoFacts = await factRepo.list_all("au1");
    expect(repoFacts).toHaveLength(2);
    expect(repoFacts.find((f) => f.id === f2a.id)).toBeUndefined();

    rebuiltFacts = await getRebuiltFacts();
    assertFactsMatch(repoFacts, rebuiltFacts);
  });

  // ---------------------------------------------------------
  // 6.4.8 State snapshot completeness: all fields round-trip through ops
  // ---------------------------------------------------------

  it("undo snapshot contains all required state fields for cross-device rebuild", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));

    await confirmCh(1, "Alice进入了城堡。Bob在外面守卫。");
    await confirmCh(2, "Charlie从密道进入。Alice惊讶地转身。");

    // Undo chapter 2
    await undoCh();

    // Find the undo op
    const ops = await opsRepo.list_all("au1");
    const undoOp = ops.find((o) => o.op_type === "undo_chapter" && o.chapter_num === 2);
    expect(undoOp).toBeDefined();

    const snapshot = undoOp!.payload.state_snapshot as Record<string, unknown>;
    expect(snapshot).toBeDefined();

    // Verify all required fields present
    expect(snapshot).toHaveProperty("current_chapter");
    expect(snapshot).toHaveProperty("last_scene_ending");
    expect(snapshot).toHaveProperty("characters_last_seen");
    expect(snapshot).toHaveProperty("last_confirmed_chapter_focus");
    expect(snapshot).toHaveProperty("chapter_titles");
    expect(snapshot).toHaveProperty("chapters_dirty");

    // Types are correct
    expect(typeof snapshot.current_chapter).toBe("number");
    expect(typeof snapshot.last_scene_ending).toBe("string");
    expect(typeof snapshot.characters_last_seen).toBe("object");
    expect(Array.isArray(snapshot.last_confirmed_chapter_focus)).toBe(true);
    expect(typeof snapshot.chapter_titles).toBe("object");
    expect(Array.isArray(snapshot.chapters_dirty)).toBe(true);
  });
});
