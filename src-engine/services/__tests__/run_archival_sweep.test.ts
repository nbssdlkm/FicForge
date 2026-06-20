// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * TDD tests for run_archival_sweep (Phase B cold-tier archival).
 */

import { describe, expect, it, beforeEach } from "vitest";
import { add_fact, run_archival_sweep } from "../facts_lifecycle.js";
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
