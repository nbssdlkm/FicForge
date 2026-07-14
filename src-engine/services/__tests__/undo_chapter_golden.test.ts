// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * undo_chapter golden tests — end-to-end round-trip verification.
 *
 * Verifies: confirm → undo → repo state matches ops rebuild.
 * Covers: degraded rebuild, alias scan, snapshot corruption.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { undoLatestChapter } from "../undo_chapter.js";
import { confirmChapter } from "../confirm_chapter.js";
import { addFact, updateFactStatus, archiveFact } from "../facts_lifecycle.js";
import { FactStatus, NarrativeWeight } from "../../domain/enums.js";
import { createDraft } from "../../domain/draft.js";
import { createState } from "../../domain/state.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import { FileDraftRepository } from "../../repositories/implementations/file_draft.js";
import { FileStateRepository } from "../../repositories/implementations/file_state.js";
import { FileOpsRepository } from "../../repositories/implementations/file_ops.js";
import { FileFactRepository } from "../../repositories/implementations/file_fact.js";
import { rebuildStateFromOps, rebuildFactsFromOps, sortAndDedupeOps } from "../../ops/ops_projection.js";

describe("undo_chapter golden: repo state vs ops rebuild", () => {
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

  async function confirmN(num: number, content: string) {
    const state = await stateRepo.get("au1");
    state.current_chapter = num;
    await stateRepo.save(state);

    await draftRepo.save(
      createDraft({
        au_id: "au1",
        chapter_num: num,
        variant: "A",
        content,
      }),
    );

    await confirmChapter({
      au_id: "au1",
      chapter_num: num,
      draft_id: `ch${String(num).padStart(4, "0")}_draft_A.md`,
      cast_registry: cast,
      chapter_repo: chapterRepo,
      draft_repo: draftRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
    });
  }

  async function doUndo() {
    return undoLatestChapter({
      au_id: "au1",
      cast_registry: cast,
      chapter_repo: chapterRepo,
      draft_repo: draftRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
      fact_repo: factRepo,
    });
  }

  // Helper: compare repo state vs ops-rebuilt state
  async function assertStateMatchesRebuild() {
    const repoState = await stateRepo.get("au1");
    const ops = await opsRepo.listAll("au1");
    const sorted = sortAndDedupeOps(ops);
    const rebuilt = rebuildStateFromOps(sorted, "au1");

    expect(rebuilt.current_chapter).toBe(repoState.current_chapter);
    expect(rebuilt.chapter_focus).toEqual(repoState.chapter_focus);
    expect(rebuilt.last_confirmed_chapter_focus).toEqual(repoState.last_confirmed_chapter_focus);
    expect(rebuilt.chapters_dirty).toEqual(repoState.chapters_dirty);

    // chapter_titles: ops rebuild captures set_chapter_title ops only,
    // confirm/undo cleans them via state snapshot
    for (const key of Object.keys(repoState.chapter_titles)) {
      expect(rebuilt.chapter_titles[Number(key)]).toBe(repoState.chapter_titles[Number(key)]);
    }
  }

  async function assertFactsMatchRebuild() {
    const repoFacts = await factRepo.listAll("au1");
    const ops = await opsRepo.listAll("au1");
    const sorted = sortAndDedupeOps(ops);
    const rebuilt = rebuildFactsFromOps(sorted);

    // Same count
    expect(rebuilt.length).toBe(repoFacts.length);

    // Same IDs
    const repoIds = repoFacts.map((f) => f.id).sort();
    const rebuildIds = rebuilt.map((f) => f.id).sort();
    expect(rebuildIds).toEqual(repoIds);

    // Same statuses
    for (const rf of repoFacts) {
      const match = rebuilt.find((f) => f.id === rf.id);
      expect(match).toBeDefined();
      expect(match!.status).toBe(rf.status);
      expect(match!.content_clean).toBe(rf.content_clean);
    }
  }

  // ---------------------------------------------------------
  // 6.1.1 Basic: confirm 2 chapters → undo → state match
  // ---------------------------------------------------------

  it("confirm 2 chapters → undo last → repo state matches ops rebuild", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));
    await confirmN(1, "Alice站在窗前。Bob走了进来。Charlie在远处观望。");
    await confirmN(2, "Bob转身离开了。Alice叹了口气。");

    await doUndo();

    await assertStateMatchesRebuild();
  });

  // ---------------------------------------------------------
  // 6.1.2 With facts: confirm + add facts → undo → facts match
  // ---------------------------------------------------------

  it("confirm + add facts → undo → facts match ops rebuild", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));
    await confirmN(1, "Alice走在路上。");

    // Add facts for chapter 1
    await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "Alice独自行走",
        status: "active",
        type: "plot_event",
      },
      factRepo,
      opsRepo,
    );
    await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "天色渐暗",
        status: "unresolved",
        type: "foreshadowing",
      },
      factRepo,
      opsRepo,
    );

    await doUndo();

    await assertFactsMatchRebuild();
    // Facts from chapter 1 should be deleted
    const facts = await factRepo.listAll("au1");
    expect(facts).toHaveLength(0);
  });

  // ---------------------------------------------------------
  // 6.1.3 Resolves cascade: confirm + resolve → undo → revert
  // ---------------------------------------------------------

  it("resolve cascade: undo reverts resolved fact and ops rebuild agrees", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));

    // Pre-existing unresolved fact (chapter 0 = pre-story)
    const foreshadow = await addFact(
      "au1",
      0,
      {
        content_raw: "r",
        content_clean: "某个悬念",
        status: "unresolved",
        type: "foreshadowing",
      },
      factRepo,
      opsRepo,
    );

    await confirmN(1, "Alice发现了答案。");

    // Resolve the foreshadowing
    await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "悬念解答",
        resolves: foreshadow.id,
      },
      factRepo,
      opsRepo,
    );

    expect((await factRepo.get("au1", foreshadow.id))!.status).toBe(FactStatus.RESOLVED);

    await doUndo();

    // Foreshadow should revert to UNRESOLVED
    expect((await factRepo.get("au1", foreshadow.id))!.status).toBe(FactStatus.UNRESOLVED);

    // Repo state and rebuild must agree
    await assertStateMatchesRebuild();
    await assertFactsMatchRebuild();
  });

  // ---------------------------------------------------------
  // 6.1.4 Multi-chapter undo: confirm 3, undo 2, verify each step
  // ---------------------------------------------------------

  it("3 confirms → 2 undos → state matches rebuild at each step", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));
    await confirmN(1, "Alice出场了。Bob也来了。");
    await confirmN(2, "Charlie加入。Alice微笑。");
    await confirmN(3, "最终章。Bob告别了。");

    // Add facts across chapters
    await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "Alice和Bob相遇",
        status: "active",
        type: "plot_event",
      },
      factRepo,
      opsRepo,
    );
    await addFact(
      "au1",
      2,
      {
        content_raw: "r",
        content_clean: "Charlie现身",
        status: "active",
        type: "plot_event",
      },
      factRepo,
      opsRepo,
    );
    await addFact(
      "au1",
      3,
      {
        content_raw: "r",
        content_clean: "Bob离开",
        status: "active",
        type: "plot_event",
      },
      factRepo,
      opsRepo,
    );

    // Undo chapter 3
    await doUndo();
    await assertStateMatchesRebuild();
    await assertFactsMatchRebuild();

    let state = await stateRepo.get("au1");
    expect(state.current_chapter).toBe(3);

    // Chapter 3 fact deleted, 1 & 2 remain
    let facts = await factRepo.listAll("au1");
    expect(facts).toHaveLength(2);

    // Undo chapter 2
    await doUndo();
    await assertStateMatchesRebuild();
    await assertFactsMatchRebuild();

    state = await stateRepo.get("au1");
    expect(state.current_chapter).toBe(2);

    facts = await factRepo.listAll("au1");
    expect(facts).toHaveLength(1);
    expect(facts[0].content_clean).toBe("Alice和Bob相遇");
  });

  // ---------------------------------------------------------
  // 6.1.5 Degraded rebuild: snapshot absent → falls back to chapter scan
  // ---------------------------------------------------------

  it("degraded: undo without prior confirm snapshot → falls back to chapter scan", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));
    await confirmN(1, "Alice在花园中散步。Bob隐藏在树后。");
    await confirmN(2, "Charlie从远处赶来。Alice招了招手。");

    // Corrupt the confirm ops: remove the snapshot fields
    const ops = await opsRepo.listAll("au1");
    const confirmOp1 = ops.find((o) => o.op_type === "confirm_chapter" && o.chapter_num === 1);
    if (confirmOp1) {
      delete confirmOp1.payload.last_scene_ending_snapshot;
      delete confirmOp1.payload.characters_last_seen_snapshot;
      await opsRepo.replaceAll("au1", ops);
    }

    // Undo ch2 → should use ch1's content (degraded path)
    await doUndo();

    const state = await stateRepo.get("au1");
    expect(state.current_chapter).toBe(2);

    // last_scene_ending 应源自 ch1（降级路径直读章节文件）：判别性断言——含 ch1 独有的
    // 「Bob隐藏在树后」、绝不含 ch2 的 Charlie，证明降级读对了章（盲审 R5 测试 L1，与下方
    // characters_last_seen 口径对齐；旧 toBeTruthy 读了 ch2 也照样通过，非判别）。
    expect(state.last_scene_ending).toContain("Bob隐藏在树后");
    expect(state.last_scene_ending).not.toContain("Charlie");

    // 降级重建只扫 < n（=ch2 正在被撤销）的章，即只扫 ch1（盲审 R5 正确性 M1）。
    // 修复前：扫描含尚未删除的 ch2 → Alice/Charlie 被持久记为「最后见于已删除的 ch2」；
    // 修复后：Alice 回到 ch1（=1），Bob 仍 ch1（=1），只在 ch2 出场的 Charlie 彻底移出（撤销后本就不该在场）。
    // 该断言判别性覆盖 M1：若边界回退（重新计入 ch2），Alice 会变 2、Charlie 会复现为 2。
    expect(state.characters_last_seen["Alice"]).toBe(1);
    expect(state.characters_last_seen["Bob"]).toBe(1);
    expect(Object.hasOwn(state.characters_last_seen, "Charlie")).toBe(false);
  });

  // ---------------------------------------------------------
  // 6.1.6 Alias scan during undo: characters with aliases
  // ---------------------------------------------------------

  it("undo with character_aliases: characters_last_seen uses canonical names", async () => {
    const castWithAliases = { characters: ["张三", "李四"] };
    const aliases = { 张三: ["小张", "阿三"], 李四: ["小李"] };

    await stateRepo.save(createState({ au_id: "au1" }));

    // Manually set up state for chapter 1
    const s = await stateRepo.get("au1");
    s.current_chapter = 1;
    await stateRepo.save(s);

    await draftRepo.save(
      createDraft({
        au_id: "au1",
        chapter_num: 1,
        variant: "A",
        content: "小张走在路上。小李跟在后面。",
      }),
    );
    await confirmChapter({
      au_id: "au1",
      chapter_num: 1,
      draft_id: "ch0001_draft_A.md",
      cast_registry: castWithAliases,
      character_aliases: aliases,
      chapter_repo: chapterRepo,
      draft_repo: draftRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
    });

    // Set up chapter 2
    await draftRepo.save(
      createDraft({
        au_id: "au1",
        chapter_num: 2,
        variant: "A",
        content: "阿三回头看了看。",
      }),
    );
    await confirmChapter({
      au_id: "au1",
      chapter_num: 2,
      draft_id: "ch0002_draft_A.md",
      cast_registry: castWithAliases,
      character_aliases: aliases,
      chapter_repo: chapterRepo,
      draft_repo: draftRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
    });

    // Undo chapter 2 with alias support
    await undoLatestChapter({
      au_id: "au1",
      cast_registry: castWithAliases,
      character_aliases: aliases,
      chapter_repo: chapterRepo,
      draft_repo: draftRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
      fact_repo: factRepo,
    });

    const state = await stateRepo.get("au1");
    expect(state.current_chapter).toBe(2);

    // Characters should use canonical names from ch1 snapshot
    // The snapshot stores whatever confirmChapter computed
    // After undo ch2, we should have ch1's snapshot values
    const chars = state.characters_last_seen;
    // 判别断言（R3 低危：原「map 非空」断言空转，别名归一化坏掉也照样绿）：
    // ch1 正文只出现别名（小张/小李）→ 归一化后必须以主名记账、章号为 1，
    // 且任何别名都不允许以键的身份泄进 characters_last_seen。
    expect(chars).toEqual({ 张三: 1, 李四: 1 });
  });

  // ---------------------------------------------------------
  // 6.1.7 Snapshot corruption: invalid snapshot values
  // ---------------------------------------------------------

  it("snapshot with non-numeric characters_last_seen → degrades to full scan", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));
    await confirmN(1, "Alice和Bob在一起。");
    await confirmN(2, "Charlie出现了。");

    // Corrupt the ch1 confirm op snapshot with non-numeric values
    const ops = await opsRepo.listAll("au1");
    const confirmOp1 = ops.find((o) => o.op_type === "confirm_chapter" && o.chapter_num === 1);
    if (confirmOp1) {
      confirmOp1.payload.characters_last_seen_snapshot = { Alice: "not_a_number" };
      await opsRepo.replaceAll("au1", ops);
    }

    // Undo ch2 → should handle corrupt snapshot gracefully
    await doUndo();

    const state = await stateRepo.get("au1");
    expect(state.current_chapter).toBe(2);
    // Should still have valid state (either from degraded scan or partial recovery)
    expect(typeof state.characters_last_seen).toBe("object");
  });

  // ---------------------------------------------------------
  // 6.1.8 Manual status rollback during undo
  // ---------------------------------------------------------

  it("manual fact status change during chapter → undo reverts it in repo AND ops rebuild (TD-003)", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));

    // Pre-existing active fact
    const f1 = await addFact(
      "au1",
      0,
      {
        content_raw: "r",
        content_clean: "背景事实",
        status: "active",
        type: "backstory",
      },
      factRepo,
      opsRepo,
    );

    await confirmN(1, "内容。");

    // During chapter 1, manually deprecate f1
    await updateFactStatus("au1", f1.id, "deprecated", 1, factRepo, opsRepo, stateRepo);

    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.DEPRECATED);

    // Undo chapter 1
    await doUndo();

    // f1 should revert to ACTIVE in repo (undo's collectManualStatusRollback)
    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.ACTIVE);

    // TD-003 fix: undo now emits an `update_fact_status` rollback op (reason
    // "undo_manual_rollback"), so rebuildFactsFromOps replicates the revert —
    // rebuilt state matches the repo (active), closing the prior consistency gap.
    const ops = await opsRepo.listAll("au1");
    const rollbackOp = ops.find(
      (op) =>
        op.op_type === "update_fact_status" && op.target_id === f1.id && op.payload.reason === "undo_manual_rollback",
    );
    expect(rollbackOp).toBeDefined();
    expect(rollbackOp!.payload.old_status).toBe("deprecated");
    expect(rollbackOp!.payload.new_status).toBe("active");

    const sorted = sortAndDedupeOps(ops);
    const rebuilt = rebuildFactsFromOps(sorted);
    const rebuiltF1 = rebuilt.find((f) => f.id === f1.id);
    expect(rebuiltF1).toBeDefined();
    // Rebuilt fact is "active" — consistent with the repo (TD-003 closed).
    expect(rebuiltF1!.status).toBe("active");
  });

  it("TWO manual status changes to one fact in a chapter → undo restores the TRUE pre-chapter status (lamport-ordered replay)", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));

    // Pre-chapter fact starts UNRESOLVED.
    const f1 = await addFact(
      "au1",
      0,
      {
        content_raw: "r",
        content_clean: "一条伏笔",
        status: "unresolved",
        type: "foreshadowing",
      },
      factRepo,
      opsRepo,
    );

    await confirmN(1, "内容。");

    // During chapter 1, change f1 TWICE: unresolved → resolved → deprecated.
    // nowUtc() truncates to whole seconds, so these two ops typically share an
    // identical timestamp; only lamport_clock distinguishes their order.
    await updateFactStatus("au1", f1.id, "resolved", 1, factRepo, opsRepo, stateRepo);
    await updateFactStatus("au1", f1.id, "deprecated", 1, factRepo, opsRepo, stateRepo);
    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.DEPRECATED);

    await doUndo();

    // Must restore the TRUE pre-chapter status (UNRESOLVED), NOT the intermediate
    // "resolved". A timestamp-only sort would tie on the same second and restore
    // "resolved" — this asserts the lamport-ordered replay (TD-003 follow-up fix).
    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.UNRESOLVED);

    // Closed loop holds: repo state ≡ ops rebuild.
    const ops = await opsRepo.listAll("au1");
    const rebuilt = rebuildFactsFromOps(sortAndDedupeOps(ops));
    const rebuiltF1 = rebuilt.find((f) => f.id === f1.id);
    expect(rebuiltF1!.status).toBe("unresolved");
  });

  it("double-undo (confirm→undo→reconfirm→undo) does NOT re-reverse the prior rollback op (isUndoGeneratedStatusOp is load-bearing)", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));
    const f1 = await addFact(
      "au1",
      0,
      {
        content_raw: "r",
        content_clean: "背景事实",
        status: "active",
        type: "backstory",
      },
      factRepo,
      opsRepo,
    );

    await confirmN(1, "内容。");
    await updateFactStatus("au1", f1.id, "deprecated", 1, factRepo, opsRepo, stateRepo);
    await doUndo();
    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.ACTIVE);

    // 重新确认 ch1 再 undo —— 上一次 undo 落的 undo_manual_rollback op（chapter_num 1）必须被
    // isUndoGeneratedStatusOp 排除，不能在二次 undo 里被当成「本章手动变更」再反向一次。
    await confirmN(1, "内容2。");
    await doUndo();

    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.ACTIVE);
    const ops = await opsRepo.listAll("au1");
    const rebuilt = rebuildFactsFromOps(sortAndDedupeOps(ops));
    expect(rebuilt.find((f) => f.id === f1.id)!.status).toBe("active");

    // 关键判别（repo 与 rebuild 因 last-write-win 两种情况都落 active，故不能只看它们）：
    // **排除一旦失效**，二次 undo 会把上一次的 rollback op（deprecated→active）再反向，必然新落一条
    // reason=undo_manual_rollback 且 new_status=deprecated 的 op。排除生效时绝不该出现这种 op。
    // 这条断言才真正守住 isUndoGeneratedStatusOp（把过滤改成 true 它会变红）。
    const rollbackToDeprecated = ops.filter(
      (op) =>
        op.op_type === "update_fact_status" &&
        op.target_id === f1.id &&
        op.payload.reason === "undo_manual_rollback" &&
        op.payload.new_status === "deprecated",
    );
    expect(rollbackToDeprecated).toEqual([]);
  });

  // ---------------------------------------------------------
  // 6.1.9 Archived fact: undo correctly handles archived facts
  // (M10-B regression: cold-tier facts must survive / be deleted correctly)
  // ---------------------------------------------------------

  it("archived fact created in chapter → undo deletes it from repo", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));
    await confirmN(1, "Alice走了。");

    // Add a low-weight fact for chapter 1, then archive it (simulating runArchivalSweep)
    const f1 = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "低权重背景细节",
        status: "active",
        type: "character_detail",
        narrative_weight: NarrativeWeight.LOW,
      },
      factRepo,
      opsRepo,
    );
    await archiveFact("au1", f1.id, factRepo, opsRepo);

    let facts = await factRepo.listAll("au1");
    expect(facts).toHaveLength(1);
    expect(facts[0].archived).toBe(true);

    // Undo chapter 1 should delete the archived fact (it was created in ch1)
    await doUndo();

    facts = await factRepo.listAll("au1");
    expect(facts).toHaveLength(0);

    // Ops rebuild should also have 0 facts (add_fact + archive ops from ch1 deleted by undo)
    await assertFactsMatchRebuild();
  });

  it("archived fact from earlier chapter survives undo of later chapter", async () => {
    await stateRepo.save(createState({ au_id: "au1" }));

    // Add a pre-existing fact from chapter 0, then archive it
    const f0 = await addFact(
      "au1",
      0,
      {
        content_raw: "r",
        content_clean: "前情提要细节",
        status: "active",
        type: "backstory",
        narrative_weight: NarrativeWeight.LOW,
      },
      factRepo,
      opsRepo,
    );
    await archiveFact("au1", f0.id, factRepo, opsRepo);

    await confirmN(1, "第一章。");

    // Undo chapter 1 should NOT delete f0 (it came from chapter 0, not chapter 1)
    await doUndo();

    const facts = await factRepo.listAll("au1");
    expect(facts).toHaveLength(1);
    expect(facts[0].id).toBe(f0.id);
    expect(facts[0].archived).toBe(true); // archived state preserved

    // State and facts both match rebuild
    await assertStateMatchesRebuild();
    await assertFactsMatchRebuild();
  });
});
