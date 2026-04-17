// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * ops_merge boundary tests.
 *
 * Covers: concurrent fact edits, import_chapters projection,
 * invalid enum fallback, large merge sets, edge ordering.
 */

import { describe, expect, it } from "vitest";
import { mergeOps, rebuildStateFromOps, rebuildFactsFromOps } from "../ops_merge.js";
import { createOpsEntry } from "../../domain/ops_entry.js";

function op(overrides: Partial<ReturnType<typeof createOpsEntry>> & { op_id: string; op_type: string }) {
  return createOpsEntry({
    target_id: "t", timestamp: "2026-01-01T00:00:00Z",
    device_id: "d1", lamport_clock: 0,
    ...overrides,
  });
}

// ===========================================================================
// Concurrent fact edit detection
// ===========================================================================

describe("mergeOps — concurrent fact edit", () => {
  it("two devices editing same fact → concurrent_fact_edit conflict", () => {
    const a = op({
      op_id: "e1", op_type: "edit_fact", target_id: "f42",
      device_id: "phone", lamport_clock: 5,
      payload: { updated_fields: { content_clean: "phone version" } },
    });
    const b = op({
      op_id: "e2", op_type: "edit_fact", target_id: "f42",
      device_id: "desktop", lamport_clock: 6,
      payload: { updated_fields: { content_clean: "desktop version" } },
    });

    const { conflicts } = mergeOps([a], [b]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].type).toBe("concurrent_fact_edit");
    expect(conflicts[0].ops).toHaveLength(2);
  });

  it("two devices changing status of same fact → concurrent_fact_edit conflict", () => {
    const a = op({
      op_id: "s1", op_type: "update_fact_status", target_id: "f99",
      device_id: "devA", lamport_clock: 1,
      payload: { new_status: "deprecated" },
    });
    const b = op({
      op_id: "s2", op_type: "update_fact_status", target_id: "f99",
      device_id: "devB", lamport_clock: 2,
      payload: { new_status: "resolved" },
    });

    const { conflicts } = mergeOps([a], [b]);
    const factEditConflicts = conflicts.filter((c) => c.type === "concurrent_fact_edit");
    expect(factEditConflicts).toHaveLength(1);
  });

  it("same device editing same fact twice → no conflict", () => {
    const a = op({
      op_id: "e1", op_type: "edit_fact", target_id: "f42",
      device_id: "dev1", lamport_clock: 1,
      payload: { updated_fields: { content_clean: "v1" } },
    });
    const b = op({
      op_id: "e2", op_type: "edit_fact", target_id: "f42",
      device_id: "dev1", lamport_clock: 2,
      payload: { updated_fields: { content_clean: "v2" } },
    });

    const { conflicts } = mergeOps([a, b], []);
    const factEditConflicts = conflicts.filter((c) => c.type === "concurrent_fact_edit");
    expect(factEditConflicts).toHaveLength(0);
  });

  it("edit_fact + update_fact_status on same fact from different devices → conflict", () => {
    const a = op({
      op_id: "e1", op_type: "edit_fact", target_id: "f1",
      device_id: "devA", lamport_clock: 1,
      payload: { updated_fields: { content_clean: "edited" } },
    });
    const b = op({
      op_id: "s1", op_type: "update_fact_status", target_id: "f1",
      device_id: "devB", lamport_clock: 2,
      payload: { new_status: "deprecated" },
    });

    const { conflicts } = mergeOps([a], [b]);
    const factEditConflicts = conflicts.filter((c) => c.type === "concurrent_fact_edit");
    expect(factEditConflicts).toHaveLength(1);
  });
});

// ===========================================================================
// import_chapters projection
// ===========================================================================

describe("rebuildStateFromOps — import_chapters", () => {
  it("import_chapters sets current_chapter to max(existing, last_chapter_num + 1)", () => {
    const ops = [
      op({
        op_id: "imp1", op_type: "import_chapters", lamport_clock: 1,
        payload: {
          last_chapter_num: 10,
          last_scene_ending: "导入的结尾",
          characters_last_seen: { 主角: 10, 配角: 8 },
        },
      }),
    ];
    const state = rebuildStateFromOps(ops, "au1");
    expect(state.current_chapter).toBe(11);
    expect(state.last_scene_ending).toBe("导入的结尾");
    expect(state.characters_last_seen).toEqual({ 主角: 10, 配角: 8 });
  });

  it("import_chapters after existing confirms → takes max chapter", () => {
    const ops = [
      op({
        op_id: "c1", op_type: "confirm_chapter", chapter_num: 1, lamport_clock: 1,
        payload: { focus: [] },
      }),
      op({
        op_id: "c2", op_type: "confirm_chapter", chapter_num: 2, lamport_clock: 2,
        payload: { focus: [] },
      }),
      op({
        op_id: "imp1", op_type: "import_chapters", lamport_clock: 3,
        payload: {
          last_chapter_num: 5,
          last_scene_ending: "imported",
          characters_last_seen: { A: 5 },
        },
      }),
    ];
    const state = rebuildStateFromOps(ops, "au1");
    // After 2 confirms: current_chapter = 3
    // After import with last_chapter_num = 5: max(3, 6) = 6
    expect(state.current_chapter).toBe(6);
    expect(state.last_scene_ending).toBe("imported");
  });

  it("import_chapters merges characters_last_seen with existing", () => {
    const ops = [
      op({
        op_id: "c1", op_type: "confirm_chapter", chapter_num: 1, lamport_clock: 1,
        payload: {
          focus: [],
          characters_last_seen_snapshot: { Alice: 1, Bob: 1 },
        },
      }),
      op({
        op_id: "imp1", op_type: "import_chapters", lamport_clock: 2,
        payload: {
          last_chapter_num: 3,
          characters_last_seen: { Bob: 3, Charlie: 2 },
        },
      }),
    ];
    const state = rebuildStateFromOps(ops, "au1");
    // confirm_chapter sets characters_last_seen directly from snapshot
    // then import_chapters merges: Bob updated to 3, Charlie added
    expect(state.characters_last_seen.Alice).toBe(1);
    expect(state.characters_last_seen.Bob).toBe(3);
    expect(state.characters_last_seen.Charlie).toBe(2);
  });

  it("import_chapters with no last_scene_ending → state unchanged", () => {
    const ops = [
      op({
        op_id: "c1", op_type: "confirm_chapter", chapter_num: 1, lamport_clock: 1,
        payload: { focus: [], last_scene_ending_snapshot: "原始结尾" },
      }),
      op({
        op_id: "imp1", op_type: "import_chapters", lamport_clock: 2,
        payload: { last_chapter_num: 3 },
      }),
    ];
    const state = rebuildStateFromOps(ops, "au1");
    // last_scene_ending should remain from confirm
    expect(state.last_scene_ending).toBe("原始结尾");
  });
});

// ===========================================================================
// Invalid enum fallback in rebuildFactsFromOps
// ===========================================================================

describe("rebuildFactsFromOps — invalid enum fallback", () => {
  it("unknown fact status falls back to 'active'", () => {
    const ops = [
      op({
        op_id: "a1", op_type: "add_fact", target_id: "f1", lamport_clock: 1,
        payload: {
          fact: {
            id: "f1", content_raw: "r", content_clean: "c",
            status: "bogus_status",
          },
        },
      }),
    ];
    const facts = rebuildFactsFromOps(ops);
    expect(facts).toHaveLength(1);
    expect(facts[0].status).toBe("active");
  });

  it("unknown fact type falls back to 'plot_event'", () => {
    const ops = [
      op({
        op_id: "a1", op_type: "add_fact", target_id: "f1", lamport_clock: 1,
        payload: {
          fact: {
            id: "f1", content_raw: "r", content_clean: "c",
            type: "nonexistent_type",
          },
        },
      }),
    ];
    const facts = rebuildFactsFromOps(ops);
    expect(facts[0].type).toBe("plot_event");
  });

  it("unknown narrative_weight falls back to 'medium'", () => {
    const ops = [
      op({
        op_id: "a1", op_type: "add_fact", target_id: "f1", lamport_clock: 1,
        payload: {
          fact: {
            id: "f1", content_raw: "r", content_clean: "c",
            narrative_weight: "super_high",
          },
        },
      }),
    ];
    const facts = rebuildFactsFromOps(ops);
    expect(facts[0].narrative_weight).toBe("medium");
  });

  it("unknown fact source falls back to 'extract_auto'", () => {
    const ops = [
      op({
        op_id: "a1", op_type: "add_fact", target_id: "f1", lamport_clock: 1,
        payload: {
          fact: {
            id: "f1", content_raw: "r", content_clean: "c",
            source: "magic_source",
          },
        },
      }),
    ];
    const facts = rebuildFactsFromOps(ops);
    expect(facts[0].source).toBe("extract_auto");
  });

  it("all enum fields invalid → all fall back to defaults", () => {
    const ops = [
      op({
        op_id: "a1", op_type: "add_fact", target_id: "f1", lamport_clock: 1,
        payload: {
          fact: {
            id: "f1", content_raw: "r", content_clean: "c",
            status: "xxx", type: "yyy", narrative_weight: "zzz", source: "www",
          },
        },
      }),
    ];
    const facts = rebuildFactsFromOps(ops);
    expect(facts[0].status).toBe("active");
    expect(facts[0].type).toBe("plot_event");
    expect(facts[0].narrative_weight).toBe("medium");
    expect(facts[0].source).toBe("extract_auto");
  });

  it("valid enum values pass through unchanged", () => {
    const ops = [
      op({
        op_id: "a1", op_type: "add_fact", target_id: "f1", lamport_clock: 1,
        payload: {
          fact: {
            id: "f1", content_raw: "r", content_clean: "c",
            status: "unresolved", type: "foreshadowing",
            narrative_weight: "high", source: "manual",
          },
        },
      }),
    ];
    const facts = rebuildFactsFromOps(ops);
    expect(facts[0].status).toBe("unresolved");
    expect(facts[0].type).toBe("foreshadowing");
    expect(facts[0].narrative_weight).toBe("high");
    expect(facts[0].source).toBe("manual");
  });
});

// ===========================================================================
// Edge cases: large merge, duplicate ops, empty payloads
// ===========================================================================

describe("mergeOps — edge cases", () => {
  it("100 ops from each side merge correctly and maintain deterministic order", () => {
    const local = Array.from({ length: 100 }, (_, i) => op({
      op_id: `L${i}`, op_type: "add_fact", target_id: `fL${i}`,
      device_id: "devL", lamport_clock: i * 2,
      payload: { fact: { id: `fL${i}`, content_raw: "r", content_clean: `local${i}` } },
    }));
    const remote = Array.from({ length: 100 }, (_, i) => op({
      op_id: `R${i}`, op_type: "add_fact", target_id: `fR${i}`,
      device_id: "devR", lamport_clock: i * 2 + 1,
      payload: { fact: { id: `fR${i}`, content_raw: "r", content_clean: `remote${i}` } },
    }));

    const { ops, newLamportClock } = mergeOps(local, remote);
    expect(ops).toHaveLength(200);
    expect(newLamportClock).toBe(200); // max clock is 199, so +1

    // Verify deterministic sort: lamport clocks should be monotonically non-decreasing
    for (let i = 1; i < ops.length; i++) {
      expect(ops[i].lamport_clock).toBeGreaterThanOrEqual(ops[i - 1].lamport_clock);
    }
  });

  it("empty payload in add_fact → fact has defaults", () => {
    const ops = [
      op({
        op_id: "a1", op_type: "add_fact", target_id: "f1", lamport_clock: 1,
        payload: { fact: { id: "f1" } },
      }),
    ];
    const facts = rebuildFactsFromOps(ops);
    expect(facts).toHaveLength(1);
    expect(facts[0].content_raw).toBe("");
    expect(facts[0].content_clean).toBe("");
    expect(facts[0].status).toBe("active");
  });

  it("add_fact with no fact payload → skipped gracefully", () => {
    const ops = [
      op({
        op_id: "a1", op_type: "add_fact", target_id: "f1", lamport_clock: 1,
        payload: {},
      }),
    ];
    const facts = rebuildFactsFromOps(ops);
    expect(facts).toHaveLength(0);
  });

  it("edit_fact on non-existent fact → no crash", () => {
    const ops = [
      op({
        op_id: "e1", op_type: "edit_fact", target_id: "ghost", lamport_clock: 1,
        payload: { updated_fields: { content_clean: "updated" } },
      }),
    ];
    const facts = rebuildFactsFromOps(ops);
    expect(facts).toHaveLength(0);
  });

  it("delete_fact on non-existent fact → no crash", () => {
    const ops = [
      op({
        op_id: "d1", op_type: "delete_fact", target_id: "ghost", lamport_clock: 1,
        payload: { fact_id: "ghost" },
      }),
    ];
    const facts = rebuildFactsFromOps(ops);
    expect(facts).toHaveLength(0);
  });

  it("update_fact_status on non-existent fact → no crash", () => {
    const ops = [
      op({
        op_id: "s1", op_type: "update_fact_status", target_id: "ghost", lamport_clock: 1,
        payload: { new_status: "deprecated" },
      }),
    ];
    const facts = rebuildFactsFromOps(ops);
    expect(facts).toHaveLength(0);
  });

  it("unknown op_type → ignored by both rebuild functions", () => {
    const ops = [
      op({
        op_id: "x1", op_type: "future_op_type", lamport_clock: 1,
        payload: { data: "something" },
      }),
    ];
    const state = rebuildStateFromOps(ops, "au1");
    expect(state.current_chapter).toBe(1); // unchanged
    const facts = rebuildFactsFromOps(ops);
    expect(facts).toHaveLength(0);
  });
});

// ===========================================================================
// recalc_global_state projection
// ===========================================================================

describe("rebuildStateFromOps — recalc_global_state", () => {
  it("recalc overrides all state fields it provides", () => {
    const ops = [
      op({
        op_id: "c1", op_type: "confirm_chapter", chapter_num: 1, lamport_clock: 1,
        payload: {
          focus: ["old_focus"],
          characters_last_seen_snapshot: { Alice: 1 },
          last_scene_ending_snapshot: "old ending",
        },
      }),
      op({
        op_id: "r1", op_type: "recalc_global_state", lamport_clock: 2,
        payload: {
          characters_last_seen: { Alice: 5, Bob: 3 },
          last_scene_ending: "recalculated ending",
          last_confirmed_chapter_focus: ["f1", "f2"],
          chapters_dirty: [2, 4],
          chapter_focus: ["f3"],
        },
      }),
    ];
    const state = rebuildStateFromOps(ops, "au1");
    expect(state.characters_last_seen).toEqual({ Alice: 5, Bob: 3 });
    expect(state.last_scene_ending).toBe("recalculated ending");
    expect(state.last_confirmed_chapter_focus).toEqual(["f1", "f2"]);
    expect(state.chapters_dirty).toEqual([2, 4]);
    expect(state.chapter_focus).toEqual(["f3"]);
  });
});

// ===========================================================================
// mark_chapters_dirty: incremental (added_dirty) vs legacy (chapters_dirty)
// ===========================================================================

describe("rebuildStateFromOps — mark_chapters_dirty formats", () => {
  it("added_dirty (incremental) performs union merge", () => {
    const ops = [
      op({
        op_id: "m1", op_type: "mark_chapters_dirty", lamport_clock: 1,
        payload: { added_dirty: [1, 3] },
      }),
      op({
        op_id: "m2", op_type: "mark_chapters_dirty", lamport_clock: 2,
        payload: { added_dirty: [3, 5] },
      }),
    ];
    const state = rebuildStateFromOps(ops, "au1");
    expect(state.chapters_dirty.sort()).toEqual([1, 3, 5]);
  });

  it("legacy chapters_dirty (snapshot) replaces previous dirty list", () => {
    const ops = [
      op({
        op_id: "m1", op_type: "mark_chapters_dirty", lamport_clock: 1,
        payload: { chapters_dirty: [1, 2, 3] },
      }),
      op({
        op_id: "m2", op_type: "mark_chapters_dirty", lamport_clock: 2,
        payload: { chapters_dirty: [5, 7] },
      }),
    ];
    const state = rebuildStateFromOps(ops, "au1");
    expect(state.chapters_dirty).toEqual([5, 7]);
  });

  it("mixed: incremental after legacy → union on top of snapshot", () => {
    const ops = [
      op({
        op_id: "m1", op_type: "mark_chapters_dirty", lamport_clock: 1,
        payload: { chapters_dirty: [1, 2] },
      }),
      op({
        op_id: "m2", op_type: "mark_chapters_dirty", lamport_clock: 2,
        payload: { added_dirty: [3] },
      }),
    ];
    const state = rebuildStateFromOps(ops, "au1");
    expect(state.chapters_dirty.sort()).toEqual([1, 2, 3]);
  });
});
