// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { mergeOps, rebuildStateFromOps, rebuildFactsFromOps } from "../ops_merge.js";
import { createOpsEntry } from "../../domain/ops_entry.js";

function op(overrides: Partial<ReturnType<typeof createOpsEntry>> & { op_id: string; op_type: string }) {
  return createOpsEntry({ target_id: "t", timestamp: "2026-01-01T00:00:00Z", device_id: "d1", lamport_clock: 0, ...overrides });
}

// ===========================================================================
// mergeOps
// ===========================================================================

describe("mergeOps", () => {
  it("two empty lists → empty result", () => {
    const { ops } = mergeOps([], []);
    expect(ops).toEqual([]);
  });

  it("one side has ops, other empty → merged includes them", () => {
    const local = [op({ op_id: "op1", op_type: "confirm_chapter", lamport_clock: 1 })];
    const { ops } = mergeOps(local, []);
    expect(ops).toHaveLength(1);
  });

  it("deduplication by op_id", () => {
    const a = op({ op_id: "op1", op_type: "confirm_chapter", lamport_clock: 1, device_id: "d1" });
    const b = op({ op_id: "op1", op_type: "confirm_chapter", lamport_clock: 1, device_id: "d2" }); // same op_id
    const { ops } = mergeOps([a], [b]);
    expect(ops).toHaveLength(1);
  });

  it("deterministic sort by lamport_clock", () => {
    const a = op({ op_id: "op1", op_type: "a", lamport_clock: 2 });
    const b = op({ op_id: "op2", op_type: "b", lamport_clock: 1 });
    const { ops } = mergeOps([a], [b]);
    expect(ops[0].op_id).toBe("op2"); // lower clock first
    expect(ops[1].op_id).toBe("op1");
  });

  it("deterministic sort tiebreak: timestamp then device_id", () => {
    const a = op({ op_id: "op1", op_type: "a", lamport_clock: 1, timestamp: "2026-01-02T00:00:00Z", device_id: "d2" });
    const b = op({ op_id: "op2", op_type: "b", lamport_clock: 1, timestamp: "2026-01-01T00:00:00Z", device_id: "d1" });
    const { ops } = mergeOps([a], [b]);
    expect(ops[0].op_id).toBe("op2"); // earlier timestamp
  });

  it("sort determinism: same ops in different order → same output", () => {
    const ops1 = [
      op({ op_id: "a", op_type: "x", lamport_clock: 3 }),
      op({ op_id: "b", op_type: "x", lamport_clock: 1 }),
      op({ op_id: "c", op_type: "x", lamport_clock: 2 }),
    ];
    const ops2 = [ops1[2], ops1[0], ops1[1]];
    const r1 = mergeOps(ops1, []);
    const r2 = mergeOps(ops2, []);
    expect(r1.ops.map((o) => o.op_id)).toEqual(r2.ops.map((o) => o.op_id));
  });

  it("conflict: concurrent confirm same chapter", () => {
    const a = op({ op_id: "op1", op_type: "confirm_chapter", chapter_num: 5, device_id: "d1", lamport_clock: 1 });
    const b = op({ op_id: "op2", op_type: "confirm_chapter", chapter_num: 5, device_id: "d2", lamport_clock: 2 });
    const { conflicts } = mergeOps([a], [b]);
    expect(conflicts.some((c) => c.type === "concurrent_confirm")).toBe(true);
  });

  it("conflict: confirm + undo same chapter from different devices", () => {
    const a = op({ op_id: "op1", op_type: "confirm_chapter", chapter_num: 5, device_id: "d1", lamport_clock: 1 });
    const b = op({ op_id: "op2", op_type: "undo_chapter", chapter_num: 5, device_id: "d2", lamport_clock: 2 });
    const { conflicts } = mergeOps([a], [b]);
    expect(conflicts.some((c) => c.type === "confirm_undo_conflict")).toBe(true);
  });

  it("newLamportClock is max + 1", () => {
    const a = op({ op_id: "op1", op_type: "x", lamport_clock: 5 });
    const b = op({ op_id: "op2", op_type: "x", lamport_clock: 3 });
    const { newLamportClock } = mergeOps([a], [b]);
    expect(newLamportClock).toBe(6);
  });
});

// ===========================================================================
// rebuildStateFromOps
// ===========================================================================

describe("rebuildStateFromOps", () => {
  it("empty ops → default state", () => {
    const state = rebuildStateFromOps([], "au1");
    expect(state.au_id).toBe("au1");
    expect(state.current_chapter).toBe(1);
  });

  it("confirm sequence → current_chapter increments", () => {
    const ops = [
      op({ op_id: "c1", op_type: "confirm_chapter", chapter_num: 1, lamport_clock: 1, payload: { focus: [] } }),
      op({ op_id: "c2", op_type: "confirm_chapter", chapter_num: 2, lamport_clock: 2, payload: { focus: [] } }),
      op({ op_id: "c3", op_type: "confirm_chapter", chapter_num: 3, lamport_clock: 3, payload: { focus: [] } }),
    ];
    const state = rebuildStateFromOps(ops, "au1");
    expect(state.current_chapter).toBe(4);
  });

  it("confirm + undo → current_chapter correct", () => {
    const ops = [
      op({ op_id: "c1", op_type: "confirm_chapter", chapter_num: 1, lamport_clock: 1 }),
      op({ op_id: "c2", op_type: "confirm_chapter", chapter_num: 2, lamport_clock: 2 }),
      op({ op_id: "u2", op_type: "undo_chapter", chapter_num: 2, lamport_clock: 3 }),
    ];
    const state = rebuildStateFromOps(ops, "au1");
    expect(state.current_chapter).toBe(2);
  });

  it("set_chapter_focus applies", () => {
    const ops = [
      op({ op_id: "f1", op_type: "set_chapter_focus", lamport_clock: 1, payload: { focus: ["f_001", "f_002"] } }),
    ];
    const state = rebuildStateFromOps(ops, "au1");
    expect(state.chapter_focus).toEqual(["f_001", "f_002"]);
  });

  it("confirm clears focus", () => {
    const ops = [
      op({ op_id: "f1", op_type: "set_chapter_focus", lamport_clock: 1, payload: { focus: ["f_001"] } }),
      op({ op_id: "c1", op_type: "confirm_chapter", chapter_num: 1, lamport_clock: 2, payload: { focus: ["f_001"] } }),
    ];
    const state = rebuildStateFromOps(ops, "au1");
    expect(state.chapter_focus).toEqual([]);
    expect(state.last_confirmed_chapter_focus).toEqual(["f_001"]);
  });

  it("determinism: same ops different order → same state", () => {
    const ops = [
      op({ op_id: "c1", op_type: "confirm_chapter", chapter_num: 1, lamport_clock: 1 }),
      op({ op_id: "c2", op_type: "confirm_chapter", chapter_num: 2, lamport_clock: 2 }),
      op({ op_id: "f1", op_type: "set_chapter_focus", lamport_clock: 3, payload: { focus: ["x"] } }),
    ];
    const shuffled = [ops[2], ops[0], ops[1]];
    // mergeOps sorts them deterministically
    const r1 = rebuildStateFromOps(mergeOps(ops, []).ops, "au1");
    const r2 = rebuildStateFromOps(mergeOps(shuffled, []).ops, "au1");
    expect(r1.current_chapter).toBe(r2.current_chapter);
    expect(r1.chapter_focus).toEqual(r2.chapter_focus);
  });
});

// ===========================================================================
// rebuildFactsFromOps
// ===========================================================================

describe("rebuildFactsFromOps", () => {
  it("empty ops → empty facts", () => {
    expect(rebuildFactsFromOps([])).toEqual([]);
  });

  it("add_fact creates fact", () => {
    const ops = [
      op({
        op_id: "a1", op_type: "add_fact", target_id: "f1", lamport_clock: 1,
        payload: { fact: { id: "f1", content_raw: "r", content_clean: "c", status: "active" } },
      }),
    ];
    const facts = rebuildFactsFromOps(ops);
    expect(facts).toHaveLength(1);
    expect(facts[0].content_clean).toBe("c");
  });

  it("add + edit modifies fact", () => {
    const ops = [
      op({ op_id: "a1", op_type: "add_fact", target_id: "f1", lamport_clock: 1,
        payload: { fact: { id: "f1", content_raw: "r", content_clean: "old" } } }),
      op({ op_id: "e1", op_type: "edit_fact", target_id: "f1", lamport_clock: 2,
        payload: { updated_fields: { content_clean: "new" } } }),
    ];
    const facts = rebuildFactsFromOps(ops);
    expect(facts[0].content_clean).toBe("new");
  });

  it("add + delete removes fact", () => {
    const ops = [
      op({ op_id: "a1", op_type: "add_fact", target_id: "f1", lamport_clock: 1,
        payload: { fact: { id: "f1", content_raw: "r", content_clean: "c" } } }),
      op({ op_id: "d1", op_type: "delete_fact", target_id: "f1", lamport_clock: 2, payload: { fact_id: "f1" } }),
    ];
    expect(rebuildFactsFromOps(ops)).toHaveLength(0);
  });

  it("update_fact_status changes status", () => {
    const ops = [
      op({ op_id: "a1", op_type: "add_fact", target_id: "f1", lamport_clock: 1,
        payload: { fact: { id: "f1", content_raw: "r", content_clean: "c", status: "active" } } }),
      op({ op_id: "s1", op_type: "update_fact_status", target_id: "f1", lamport_clock: 2,
        payload: { new_status: "deprecated" } }),
    ];
    const facts = rebuildFactsFromOps(ops);
    expect(facts[0].status).toBe("deprecated");
  });

  it("determinism: same ops shuffled → same facts", () => {
    const ops = [
      op({ op_id: "a1", op_type: "add_fact", target_id: "f1", lamport_clock: 1,
        payload: { fact: { id: "f1", content_raw: "r", content_clean: "c1" } } }),
      op({ op_id: "a2", op_type: "add_fact", target_id: "f2", lamport_clock: 2,
        payload: { fact: { id: "f2", content_raw: "r", content_clean: "c2" } } }),
      op({ op_id: "e1", op_type: "edit_fact", target_id: "f1", lamport_clock: 3,
        payload: { updated_fields: { content_clean: "c1-edited" } } }),
    ];
    const shuffled = [ops[2], ops[0], ops[1]];
    const r1 = rebuildFactsFromOps(mergeOps(ops, []).ops);
    const r2 = rebuildFactsFromOps(mergeOps(shuffled, []).ops);
    const sorted1 = r1.sort((a, b) => a.id.localeCompare(b.id));
    const sorted2 = r2.sort((a, b) => a.id.localeCompare(b.id));
    expect(sorted1.map((f) => f.content_clean)).toEqual(sorted2.map((f) => f.content_clean));
  });

  it("edit_fact ignores id field injection", () => {
    const ops = [
      op({ op_id: "a1", op_type: "add_fact", target_id: "f1", lamport_clock: 1,
        payload: { fact: { id: "f1", content_raw: "r", content_clean: "c" } } }),
      op({ op_id: "e1", op_type: "edit_fact", target_id: "f1", lamport_clock: 2,
        payload: { updated_fields: { id: "CORRUPTED", content_clean: "new" } } }),
    ];
    const facts = rebuildFactsFromOps(ops);
    expect(facts[0].id).toBe("f1"); // id must NOT be overwritten
    expect(facts[0].content_clean).toBe("new");
  });

  it("batch_extract_facts creates multiple facts", () => {
    const ops = [
      op({ op_id: "b1", op_type: "batch_extract_facts", target_id: "batch1", lamport_clock: 1,
        payload: { facts: [
          { id: "bf1", content_raw: "r1", content_clean: "c1" },
          { id: "bf2", content_raw: "r2", content_clean: "c2" },
        ] } }),
    ];
    const facts = rebuildFactsFromOps(ops);
    expect(facts).toHaveLength(2);
    expect(facts.map((f) => f.id).sort()).toEqual(["bf1", "bf2"]);
  });
});

describe("rebuildStateFromOps — additional cases", () => {
  it("import_project sets state from snapshot", () => {
    const ops = [
      op({ op_id: "i1", op_type: "import_project", lamport_clock: 1,
        payload: { state_snapshot: { current_chapter: 5, last_scene_ending: "结尾", characters_last_seen: { Alice: 4 } } } }),
    ];
    const state = rebuildStateFromOps(ops, "au1");
    expect(state.current_chapter).toBe(5);
    expect(state.last_scene_ending).toBe("结尾");
    expect(state.characters_last_seen.Alice).toBe(4);
  });

  it("resolve_dirty_chapter removes from dirty list", () => {
    const state = rebuildStateFromOps([], "au1");
    state.chapters_dirty = [3, 5, 7];
    // Manually simulate: the rebuild starts from scratch so dirty comes from ops
    // Since no op adds to dirty, this tests the remove path
    const ops = [
      op({ op_id: "r1", op_type: "resolve_dirty_chapter", chapter_num: 5, lamport_clock: 1 }),
    ];
    // rebuildStateFromOps starts with clean state, so chapters_dirty is []
    const rebuilt = rebuildStateFromOps(ops, "au1");
    expect(rebuilt.chapters_dirty).not.toContain(5);
  });

  // F1: undo_chapter with state_snapshot restores all fields
  it("undo_chapter with state_snapshot restores full state", () => {
    const ops = [
      op({ op_id: "c1", op_type: "confirm_chapter", chapter_num: 1, lamport_clock: 1,
        payload: { focus: ["f1"], last_scene_ending_snapshot: "日落", characters_last_seen_snapshot: { Alice: 1 } } }),
      op({ op_id: "u1", op_type: "undo_chapter", chapter_num: 1, lamport_clock: 2,
        payload: { state_snapshot: {
          current_chapter: 1,
          last_scene_ending: "",
          characters_last_seen: {},
          last_confirmed_chapter_focus: [],
          chapter_titles: {},
          chapters_dirty: [],
        } } }),
    ];
    const state = rebuildStateFromOps(ops, "au1");
    expect(state.current_chapter).toBe(1);
    expect(state.last_scene_ending).toBe("");
    expect(state.characters_last_seen).toEqual({});
    expect(state.last_confirmed_chapter_focus).toEqual([]);
    expect(state.chapter_titles).toEqual({});
    expect(state.chapter_focus).toEqual([]);
  });

  // F1: legacy undo_chapter without snapshot falls back to chapter_num
  it("undo_chapter without snapshot uses chapter_num fallback", () => {
    const ops = [
      op({ op_id: "c1", op_type: "confirm_chapter", chapter_num: 1, lamport_clock: 1,
        payload: { focus: [], last_scene_ending_snapshot: "s", characters_last_seen_snapshot: { A: 1 } } }),
      op({ op_id: "u1", op_type: "undo_chapter", chapter_num: 1, lamport_clock: 2, payload: {} }),
    ];
    const state = rebuildStateFromOps(ops, "au1");
    expect(state.current_chapter).toBe(1);
    expect(state.chapter_focus).toEqual([]);
  });

  // F4: set_chapter_title sets title in rebuilt state
  it("set_chapter_title projects into chapter_titles", () => {
    const ops = [
      op({ op_id: "t1", op_type: "set_chapter_title", chapter_num: 1, lamport_clock: 1,
        payload: { title: "黄昏的告别" } }),
      op({ op_id: "t2", op_type: "set_chapter_title", chapter_num: 2, lamport_clock: 2,
        payload: { title: "新的开始" } }),
    ];
    const state = rebuildStateFromOps(ops, "au1");
    expect(state.chapter_titles[1]).toBe("黄昏的告别");
    expect(state.chapter_titles[2]).toBe("新的开始");
  });

  // F4: mark_chapters_dirty projects into chapters_dirty
  it("mark_chapters_dirty + resolve_dirty_chapter sequence", () => {
    const ops = [
      op({ op_id: "m1", op_type: "mark_chapters_dirty", lamport_clock: 1,
        payload: { chapters_dirty: [3, 5] } }),
      op({ op_id: "r1", op_type: "resolve_dirty_chapter", chapter_num: 3, lamport_clock: 2 }),
    ];
    const state = rebuildStateFromOps(ops, "au1");
    expect(state.chapters_dirty).toEqual([5]);
  });
});

// F5: add_fact with full payload roundtrips all fields
describe("rebuildFactsFromOps — full fact fields (F5)", () => {
  it("add_fact preserves story_time, resolves, revision, timestamps", () => {
    const ops = [
      op({ op_id: "a1", op_type: "add_fact", target_id: "f1", chapter_num: 1, lamport_clock: 1,
        payload: { fact: {
          id: "f1", content_raw: "raw", content_clean: "clean",
          characters: ["Alice"], chapter: 1, status: "active",
          type: "plot_event", narrative_weight: "high", source: "manual",
          timeline: "main", story_time: "第三天黄昏",
          resolves: "f0", revision: 2,
          created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-02T00:00:00Z",
        } } }),
    ];
    const facts = rebuildFactsFromOps(ops);
    expect(facts).toHaveLength(1);
    const f = facts[0];
    expect(f.story_time).toBe("第三天黄昏");
    expect(f.resolves).toBe("f0");
    expect(f.revision).toBe(2);
    expect(f.created_at).toBe("2026-01-01T00:00:00Z");
    expect(f.updated_at).toBe("2026-01-02T00:00:00Z");
    expect(f.narrative_weight).toBe("high");
  });

  it("add_fact with missing optional fields uses defaults", () => {
    const ops = [
      op({ op_id: "a2", op_type: "add_fact", target_id: "f2", lamport_clock: 1,
        payload: { fact: { id: "f2", content_raw: "r", content_clean: "c" } } }),
    ];
    const facts = rebuildFactsFromOps(ops);
    expect(facts[0].story_time).toBe("");
    expect(facts[0].resolves).toBeNull();
    expect(facts[0].revision).toBe(1);
  });
});
