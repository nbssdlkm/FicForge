// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * TDD tests for ops_projection archive_fact/unarchive_fact cases (BLOCKER B1).
 */

import { describe, expect, it } from "vitest";
import { rebuildFactsFromOps, sortAndDedupeOps } from "../ops_projection.js";
import type { OpsEntry } from "../../domain/ops_entry.js";
import { createFact } from "../../domain/fact.js";
import { FactStatus } from "../../domain/enums.js";

function makeOp(overrides: Partial<OpsEntry>): OpsEntry {
  return {
    op_id: `op_${Math.random().toString(36).slice(2)}`,
    op_type: "add_fact",
    target_id: "f1",
    chapter_num: 1,
    timestamp: new Date().toISOString(),
    lamport_clock: 1,
    device_id: "test",
    payload: {},
    ...overrides,
  };
}

const BASE_FACT_DATA = {
  id: "f1",
  content_raw: "r",
  content_clean: "c",
  characters: [],
  chapter: 1,
  status: "active" as const,
  type: "plot_event" as const,
  narrative_weight: "medium" as const,
  source: "manual" as const,
  timeline: "",
  story_time: "",
  resolves: null,
  revision: 1,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
};

describe("rebuildFactsFromOps - archive_fact / unarchive_fact cases", () => {
  it("archive_fact op sets archived=true on fact", () => {
    const ops = sortAndDedupeOps([
      makeOp({
        op_id: "op1",
        op_type: "add_fact",
        target_id: "f1",
        lamport_clock: 1,
        payload: { fact: BASE_FACT_DATA },
      }),
      makeOp({
        op_id: "op2",
        op_type: "archive_fact",
        target_id: "f1",
        lamport_clock: 2,
        payload: { archived_at: "2026-06-20T10:00:00Z" },
      }),
    ]);

    const facts = rebuildFactsFromOps(ops);
    const f1 = facts.find((f) => f.id === "f1");
    expect(f1).toBeDefined();
    expect(f1!.archived).toBe(true);
    expect(f1!.archived_at).toBe("2026-06-20T10:00:00Z");
  });

  it("unarchive_fact op sets archived=false and clears archived_at", () => {
    const ops = sortAndDedupeOps([
      makeOp({
        op_id: "op1",
        op_type: "add_fact",
        target_id: "f1",
        lamport_clock: 1,
        payload: { fact: BASE_FACT_DATA },
      }),
      makeOp({
        op_id: "op2",
        op_type: "archive_fact",
        target_id: "f1",
        lamport_clock: 2,
        payload: { archived_at: "2026-06-20T10:00:00Z" },
      }),
      makeOp({
        op_id: "op3",
        op_type: "unarchive_fact",
        target_id: "f1",
        lamport_clock: 3,
        payload: {},
      }),
    ]);

    const facts = rebuildFactsFromOps(ops);
    const f1 = facts.find((f) => f.id === "f1");
    expect(f1).toBeDefined();
    expect(f1!.archived).toBe(false);
    expect(f1!.archived_at == null).toBe(true);
  });

  it("archive_fact on unknown fact_id is a no-op (does not crash)", () => {
    const ops = sortAndDedupeOps([
      makeOp({
        op_id: "op1",
        op_type: "archive_fact",
        target_id: "nonexistent",
        lamport_clock: 1,
        payload: {},
      }),
    ]);

    expect(() => rebuildFactsFromOps(ops)).not.toThrow();
    const facts = rebuildFactsFromOps(ops);
    expect(facts).toHaveLength(0);
  });

  it("add_fact with archived=true in payload preserves archived field on rebuild", () => {
    // Some future ops might include archived=true in the fact payload
    const ops = sortAndDedupeOps([
      makeOp({
        op_id: "op1",
        op_type: "add_fact",
        target_id: "f1",
        lamport_clock: 1,
        payload: { fact: { ...BASE_FACT_DATA, archived: true, archived_at: "2026-06-20T00:00:00Z" } },
      }),
    ]);

    const facts = rebuildFactsFromOps(ops);
    const f1 = facts.find((f) => f.id === "f1");
    expect(f1).toBeDefined();
    expect(f1!.archived).toBe(true);
  });
});

describe("OpType enum includes archive_fact / unarchive_fact", () => {
  it("OpType.ARCHIVE_FACT is 'archive_fact'", async () => {
    const { OpType } = await import("../../domain/enums.js");
    expect(OpType.ARCHIVE_FACT).toBe("archive_fact");
  });

  it("OpType.UNARCHIVE_FACT is 'unarchive_fact'", async () => {
    const { OpType } = await import("../../domain/enums.js");
    expect(OpType.UNARCHIVE_FACT).toBe("unarchive_fact");
  });
});
