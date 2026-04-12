// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Ops 往返测试：验证 service → ops → rebuild 闭环一致性。
 * 确保 rebuildStateFromOps + rebuildFactsFromOps 能从 ops 完整恢复
 * service 函数直接产生的 state 和 facts。
 */

import { describe, expect, it, beforeEach } from "vitest";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileFactRepository } from "../../repositories/implementations/file_fact.js";
import { FileOpsRepository } from "../../repositories/implementations/file_ops.js";
import { FileStateRepository } from "../../repositories/implementations/file_state.js";
import { createState } from "../../domain/state.js";
import { add_fact, edit_fact, update_fact_status, set_chapter_focus } from "../../services/facts_lifecycle.js";
import { edit_chapter_content } from "../../services/chapter_edit.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import { createChapter } from "../../domain/chapter.js";
import { rebuildStateFromOps, rebuildFactsFromOps } from "../ops_merge.js";

describe("ops roundtrip: service → ops → rebuild", () => {
  let adapter: MockAdapter;
  let factRepo: FileFactRepository;
  let opsRepo: FileOpsRepository;
  let stateRepo: FileStateRepository;
  let chapterRepo: FileChapterRepository;

  beforeEach(async () => {
    adapter = new MockAdapter();
    factRepo = new FileFactRepository(adapter);
    opsRepo = new FileOpsRepository(adapter);
    stateRepo = new FileStateRepository(adapter);
    chapterRepo = new FileChapterRepository(adapter);
    // Seed initial state
    await stateRepo.save(createState({ au_id: "au1" }));
  });

  it("add_fact → rebuild recovers the fact", async () => {
    await add_fact("au1", 1, {
      content_raw: "Alice met Bob",
      content_clean: "Alice met Bob",
      characters: ["Alice", "Bob"],
      status: "active",
      type: "plot_event",
    }, factRepo, opsRepo);

    const ops = await opsRepo.list_all("au1");
    const rebuilt = rebuildFactsFromOps(ops);

    const actual = await factRepo.list_all("au1");
    expect(rebuilt).toHaveLength(actual.length);
    expect(rebuilt[0].id).toBe(actual[0].id);
    expect(rebuilt[0].content_clean).toBe(actual[0].content_clean);
    expect(rebuilt[0].characters).toEqual(actual[0].characters);
    expect(rebuilt[0].status).toBe(actual[0].status);
    expect(rebuilt[0].type).toBe(actual[0].type);
  });

  it("add_fact → edit_fact → rebuild recovers edited fact", async () => {
    const fact = await add_fact("au1", 1, {
      content_raw: "r",
      content_clean: "original",
      status: "active",
      type: "plot_event",
    }, factRepo, opsRepo);

    await edit_fact("au1", fact.id, {
      content_clean: "updated",
      status: "unresolved",
    }, factRepo, opsRepo, stateRepo);

    const ops = await opsRepo.list_all("au1");
    const rebuilt = rebuildFactsFromOps(ops);

    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0].content_clean).toBe("updated");
    expect(rebuilt[0].status).toBe("unresolved");
  });

  it("update_fact_status → rebuild recovers status change", async () => {
    const fact = await add_fact("au1", 1, {
      content_raw: "r",
      content_clean: "c",
      status: "unresolved",
      type: "foreshadowing",
    }, factRepo, opsRepo);

    await update_fact_status("au1", fact.id, "resolved", 1, factRepo, opsRepo, stateRepo);

    const ops = await opsRepo.list_all("au1");
    const rebuilt = rebuildFactsFromOps(ops);

    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0].status).toBe("resolved");
  });

  it("set_chapter_focus → rebuild recovers focus", async () => {
    const f1 = await add_fact("au1", 1, {
      content_raw: "r", content_clean: "c",
      status: "unresolved", type: "foreshadowing",
    }, factRepo, opsRepo);

    await set_chapter_focus("au1", [f1.id], factRepo, opsRepo, stateRepo);

    const ops = await opsRepo.list_all("au1");
    const rebuiltState = rebuildStateFromOps(ops, "au1");
    const actualState = await stateRepo.get("au1");

    expect(rebuiltState.chapter_focus).toEqual(actualState.chapter_focus);
  });

  it("edit_chapter_content → rebuild recovers dirty list (incremental)", async () => {
    // Seed a chapter
    const ch = createChapter({
      au_id: "au1",
      chapter_num: 1,
      content: "Hello world",
      chapter_id: "ch-1",
      confirmed_at: "2026-01-01",
      content_hash: "h1",
      provenance: "ai",
      revision: 1,
    });
    await chapterRepo.save(ch);

    await edit_chapter_content("au1", 1, "New content", chapterRepo, stateRepo, opsRepo);

    const ops = await opsRepo.list_all("au1");
    const rebuiltState = rebuildStateFromOps(ops, "au1");

    expect(rebuiltState.chapters_dirty).toContain(1);
  });

  it("concurrent dirty edits from two devices merge correctly", () => {
    // Simulate: device A marks ch2 dirty, device B marks ch3 dirty
    const opA = {
      op_id: "opA", op_type: "mark_chapters_dirty", target_id: "au1",
      chapter_num: null, timestamp: "2026-01-01T00:00:01Z",
      lamport_clock: 1, device_id: "devA",
      payload: { added_dirty: [2] },
    };
    const opB = {
      op_id: "opB", op_type: "mark_chapters_dirty", target_id: "au1",
      chapter_num: null, timestamp: "2026-01-01T00:00:02Z",
      lamport_clock: 1, device_id: "devB",
      payload: { added_dirty: [3] },
    };

    const rebuilt = rebuildStateFromOps([opA, opB], "au1");
    expect(rebuilt.chapters_dirty).toContain(2);
    expect(rebuilt.chapters_dirty).toContain(3);
  });

  it("focus cleanup after deprecation is captured in ops", async () => {
    const f1 = await add_fact("au1", 1, {
      content_raw: "r", content_clean: "c",
      status: "unresolved", type: "foreshadowing",
    }, factRepo, opsRepo);

    // Set focus to f1
    await set_chapter_focus("au1", [f1.id], factRepo, opsRepo, stateRepo);

    // Deprecate f1 → should auto-clean focus and emit set_chapter_focus op
    await update_fact_status("au1", f1.id, "deprecated", 1, factRepo, opsRepo, stateRepo);

    const ops = await opsRepo.list_all("au1");
    const rebuiltState = rebuildStateFromOps(ops, "au1");
    const actualState = await stateRepo.get("au1");

    // Both should have empty focus (f1 was removed)
    expect(rebuiltState.chapter_focus).toEqual([]);
    expect(actualState.chapter_focus).toEqual([]);
  });

  it("recalc_global_state op restores all fields", () => {
    const op = {
      op_id: "recalc1", op_type: "recalc_global_state", target_id: "au1",
      chapter_num: null, timestamp: "2026-01-01T00:00:00Z",
      lamport_clock: 1, device_id: "dev1",
      payload: {
        characters_last_seen: { Alice: 3, Bob: 2 },
        last_scene_ending: "And then the sun set.",
        last_confirmed_chapter_focus: ["f1"],
        chapters_dirty: [1, 4],
        chapter_focus: ["f2"],
      },
    };

    const rebuilt = rebuildStateFromOps([op], "au1");
    expect(rebuilt.characters_last_seen).toEqual({ Alice: 3, Bob: 2 });
    expect(rebuilt.last_scene_ending).toBe("And then the sun set.");
    expect(rebuilt.last_confirmed_chapter_focus).toEqual(["f1"]);
    expect(rebuilt.chapters_dirty).toEqual([1, 4]);
    expect(rebuilt.chapter_focus).toEqual(["f2"]);
  });
});
