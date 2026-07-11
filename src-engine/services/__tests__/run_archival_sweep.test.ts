// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * TDD tests for run_archival_sweep (Phase B cold-tier archival).
 */

import { describe, expect, it, beforeEach } from "vitest";
import { add_fact, run_archival_sweep, find_archival_candidates, archive_facts, is_archival_candidate } from "../facts_lifecycle.js";
import { createFact } from "../../domain/fact.js";
import type { Fact } from "../../domain/fact.js";
import { NarrativeWeight, FactStatus } from "../../domain/enums.js";
import { FileFactRepository } from "../../repositories/implementations/file_fact.js";
import { FileOpsRepository } from "../../repositories/implementations/file_ops.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";

describe("run_archival_sweep", () => {
  let adapter: MockAdapter;
  let factRepo: FileFactRepository;
  let opsRepo: FileOpsRepository;

  beforeEach(() => {
    adapter = new MockAdapter();
    factRepo = new FileFactRepository(adapter);
    opsRepo = new FileOpsRepository(adapter);
  });

  it("archives fact that satisfies distance + low weight + active status", async () => {
    // chapter=1, current=11 => distance=10, satisfies >= ARCHIVE_DISTANCE=10
    const fact = await add_fact("au1", 1, {
      content_raw: "r",
      content_clean: "old low fact",
      narrative_weight: NarrativeWeight.LOW,
      status: FactStatus.ACTIVE,
    }, factRepo, opsRepo);

    const archived = await run_archival_sweep("au1", 11, factRepo, opsRepo);

    expect(archived).toContain(fact.id);
    const updated = await factRepo.get("au1", fact.id);
    expect(updated!.archived).toBe(true);
  });

  it("does not archive high-weight fact even if old enough", async () => {
    const fact = await add_fact("au1", 1, {
      content_raw: "r",
      content_clean: "important old fact",
      narrative_weight: NarrativeWeight.HIGH,
      status: FactStatus.ACTIVE,
    }, factRepo, opsRepo);

    const archived = await run_archival_sweep("au1", 11, factRepo, opsRepo);

    expect(archived).not.toContain(fact.id);
    const updated = await factRepo.get("au1", fact.id);
    expect(updated!.archived).toBe(false);
  });

  it("does not archive medium-weight fact", async () => {
    const fact = await add_fact("au1", 1, {
      content_raw: "r",
      content_clean: "medium old fact",
      narrative_weight: NarrativeWeight.MEDIUM,
      status: FactStatus.ACTIVE,
    }, factRepo, opsRepo);

    const archived = await run_archival_sweep("au1", 11, factRepo, opsRepo);

    expect(archived).not.toContain(fact.id);
  });

  it("does not archive fact that is too recent (distance < threshold)", async () => {
    // chapter=5, current=11 => distance=6, below ARCHIVE_DISTANCE=10
    const fact = await add_fact("au1", 5, {
      content_raw: "r",
      content_clean: "recent low fact",
      narrative_weight: NarrativeWeight.LOW,
      status: FactStatus.ACTIVE,
    }, factRepo, opsRepo);

    const archived = await run_archival_sweep("au1", 11, factRepo, opsRepo);

    expect(archived).not.toContain(fact.id);
  });

  it("does not archive deprecated facts", async () => {
    const fact = await add_fact("au1", 1, {
      content_raw: "r",
      content_clean: "deprecated low fact",
      narrative_weight: NarrativeWeight.LOW,
      status: FactStatus.DEPRECATED,
    }, factRepo, opsRepo);

    const archived = await run_archival_sweep("au1", 11, factRepo, opsRepo);

    expect(archived).not.toContain(fact.id);
  });

  it("does not archive resolved facts", async () => {
    const fact = await add_fact("au1", 1, {
      content_raw: "r",
      content_clean: "resolved low fact",
      narrative_weight: NarrativeWeight.LOW,
      status: FactStatus.RESOLVED,
    }, factRepo, opsRepo);

    const archived = await run_archival_sweep("au1", 11, factRepo, opsRepo);

    expect(archived).not.toContain(fact.id);
  });

  it("does not re-archive already archived fact", async () => {
    const fact = await add_fact("au1", 1, {
      content_raw: "r",
      content_clean: "already archived",
      narrative_weight: NarrativeWeight.LOW,
      status: FactStatus.ACTIVE,
    }, factRepo, opsRepo);

    // First sweep archives it
    await run_archival_sweep("au1", 11, factRepo, opsRepo);
    const opsAfterFirst = await opsRepo.list_all("au1");
    const archiveOpsCount = opsAfterFirst.filter((o) => o.op_type === "archive_fact").length;

    // Second sweep should not create another archive op
    await run_archival_sweep("au1", 11, factRepo, opsRepo);
    const opsAfterSecond = await opsRepo.list_all("au1");
    const archiveOpsCountAfterSecond = opsAfterSecond.filter((o) => o.op_type === "archive_fact").length;

    expect(archiveOpsCountAfterSecond).toBe(archiveOpsCount);
  });

  it("returns empty array when no facts qualify", async () => {
    await add_fact("au1", 8, {
      content_raw: "r",
      content_clean: "recent fact",
      narrative_weight: NarrativeWeight.LOW,
      status: FactStatus.ACTIVE,
    }, factRepo, opsRepo);

    const archived = await run_archival_sweep("au1", 11, factRepo, opsRepo);

    expect(archived).toHaveLength(0);
  });

  it("returns empty array when no facts exist", async () => {
    const archived = await run_archival_sweep("au1", 11, factRepo, opsRepo);
    expect(archived).toHaveLength(0);
  });

  it("archives unresolved low-weight old fact", async () => {
    const fact = await add_fact("au1", 1, {
      content_raw: "r",
      content_clean: "old unresolved low",
      narrative_weight: NarrativeWeight.LOW,
      status: FactStatus.UNRESOLVED,
    }, factRepo, opsRepo);

    const archived = await run_archival_sweep("au1", 11, factRepo, opsRepo);

    expect(archived).toContain(fact.id);
  });

  it("accepts custom threshold", async () => {
    // With threshold=5, chapter=1, current=7 => distance=6 >= 5 => archive
    const fact = await add_fact("au1", 1, {
      content_raw: "r",
      content_clean: "custom threshold test",
      narrative_weight: NarrativeWeight.LOW,
      status: FactStatus.ACTIVE,
    }, factRepo, opsRepo);

    const archived = await run_archival_sweep("au1", 7, factRepo, opsRepo, 5);

    expect(archived).toContain(fact.id);
  });
});

// 判据单一真相源的直接边界测试（codex 审 P2：之前只经 sweep 间接验）。
describe("is_archival_candidate (predicate boundaries)", () => {
  const base = (over: Partial<Fact> = {}): Fact => createFact({
    id: "f", content_raw: "r", content_clean: "c", chapter: 1,
    narrative_weight: NarrativeWeight.LOW, status: FactStatus.ACTIVE, ...over,
  });

  it("distance == threshold exactly → candidate (chapter 1, current 11, thr 10)", () => {
    expect(is_archival_candidate(base({ chapter: 1 }), 11, 10)).toBe(true);
  });
  it("distance one short of threshold → not a candidate (chapter 2, current 11)", () => {
    expect(is_archival_candidate(base({ chapter: 2 }), 11, 10)).toBe(false);
  });
  it("archived === undefined (legacy fact) → treated as not-archived → candidate", () => {
    expect(is_archival_candidate({ ...base({ chapter: 1 }), archived: undefined as unknown as boolean }, 11, 10)).toBe(true);
  });
  it("archived === true → excluded", () => {
    expect(is_archival_candidate(base({ chapter: 1, archived: true }), 11, 10)).toBe(false);
  });
  it("RESOLVED / DEPRECATED status → excluded", () => {
    expect(is_archival_candidate(base({ chapter: 1, status: FactStatus.RESOLVED }), 11, 10)).toBe(false);
    expect(is_archival_candidate(base({ chapter: 1, status: FactStatus.DEPRECATED }), 11, 10)).toBe(false);
  });
  it("non-low weight → excluded", () => {
    expect(is_archival_candidate(base({ chapter: 1, narrative_weight: NarrativeWeight.MEDIUM }), 11, 10)).toBe(false);
    expect(is_archival_candidate(base({ chapter: 1, narrative_weight: NarrativeWeight.HIGH }), 11, 10)).toBe(false);
  });
  it("current_chapter 0 (new AU) → nothing qualifies (distance math is safe, not a false-positive)", () => {
    expect(is_archival_candidate(base({ chapter: 1 }), 0, 10)).toBe(false);
  });
});

// Q4 用户确认流的两个原语：find（只读预览） + archive_facts（归档确认子集）。
describe("find_archival_candidates (read-only preview)", () => {
  let adapter: MockAdapter;
  let factRepo: FileFactRepository;
  let opsRepo: FileOpsRepository;
  beforeEach(() => {
    adapter = new MockAdapter();
    factRepo = new FileFactRepository(adapter);
    opsRepo = new FileOpsRepository(adapter);
  });

  it("returns cold candidates WITHOUT mutating them (no archive op written)", async () => {
    const cold = await add_fact("au1", 1, {
      content_raw: "r", content_clean: "old low", narrative_weight: NarrativeWeight.LOW, status: FactStatus.ACTIVE,
    }, factRepo, opsRepo);
    await add_fact("au1", 1, {
      content_raw: "r", content_clean: "old high", narrative_weight: NarrativeWeight.HIGH, status: FactStatus.ACTIVE,
    }, factRepo, opsRepo);

    const candidates = await find_archival_candidates("au1", 11, factRepo);
    expect(candidates.map((f) => f.id)).toEqual([cold.id]);
    // 只读：没写 archive op，fact 也没被标 archived
    expect((await factRepo.get("au1", cold.id))!.archived).toBe(false);
    expect((await opsRepo.list_all("au1")).filter((o) => o.op_type === "archive_fact")).toHaveLength(0);
  });
});

describe("archive_facts (archive confirmed subset)", () => {
  let adapter: MockAdapter;
  let factRepo: FileFactRepository;
  let opsRepo: FileOpsRepository;
  beforeEach(() => {
    adapter = new MockAdapter();
    factRepo = new FileFactRepository(adapter);
    opsRepo = new FileOpsRepository(adapter);
  });

  it("archives only the given ids (user's confirmed subset), leaves the rest untouched", async () => {
    const a = await add_fact("au1", 1, { content_raw: "r", content_clean: "a", narrative_weight: NarrativeWeight.LOW, status: FactStatus.ACTIVE }, factRepo, opsRepo);
    const b = await add_fact("au1", 1, { content_raw: "r", content_clean: "b", narrative_weight: NarrativeWeight.LOW, status: FactStatus.ACTIVE }, factRepo, opsRepo);

    const archived = await archive_facts("au1", [a.id], factRepo, opsRepo);

    expect(archived).toEqual([a.id]);
    expect((await factRepo.get("au1", a.id))!.archived).toBe(true);
    expect((await factRepo.get("au1", b.id))!.archived).toBe(false); // 没勾的不动
  });

  it("is idempotent: skips already-archived and missing ids", async () => {
    const a = await add_fact("au1", 1, { content_raw: "r", content_clean: "a", narrative_weight: NarrativeWeight.LOW, status: FactStatus.ACTIVE }, factRepo, opsRepo);
    await archive_facts("au1", [a.id], factRepo, opsRepo);
    const archived = await archive_facts("au1", [a.id, "f_missing"], factRepo, opsRepo);
    expect(archived).toEqual([]); // 已归档 + 不存在都跳过
  });
});
