// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * TDD tests for archiveFact / unarchiveFact (BLOCKER B1 + Phase B).
 * Run these first so they fail, then implement.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { addFact, archiveFact, unarchiveFact } from "../facts_lifecycle.js";
import { FileFactRepository } from "../../repositories/implementations/file_fact.js";
import { FileOpsRepository } from "../../repositories/implementations/file_ops.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";

describe("archive_fact / unarchive_fact", () => {
  let adapter: MockAdapter;
  let factRepo: FileFactRepository;
  let opsRepo: FileOpsRepository;

  beforeEach(() => {
    adapter = new MockAdapter();
    factRepo = new FileFactRepository(adapter);
    opsRepo = new FileOpsRepository(adapter);
  });

  it("archiveFact sets archived=true and archived_at", async () => {
    const fact = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c",
      },
      factRepo,
      opsRepo,
    );

    await archiveFact("au1", fact.id, factRepo, opsRepo);

    const updated = await factRepo.get("au1", fact.id);
    expect(updated).not.toBeNull();
    expect(updated!.archived).toBe(true);
    expect(typeof updated!.archived_at).toBe("string");
    expect(updated!.archived_at!.length).toBeGreaterThan(0);
  });

  it("archiveFact writes archive_fact op", async () => {
    const fact = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c",
      },
      factRepo,
      opsRepo,
    );

    await archiveFact("au1", fact.id, factRepo, opsRepo);

    const ops = await opsRepo.list_all("au1");
    const archiveOp = ops.find((o) => o.op_type === "archive_fact");
    expect(archiveOp).toBeDefined();
    expect(archiveOp!.target_id).toBe(fact.id);
  });

  it("unarchiveFact sets archived=false and clears archived_at", async () => {
    const fact = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c",
      },
      factRepo,
      opsRepo,
    );

    await archiveFact("au1", fact.id, factRepo, opsRepo);
    await unarchiveFact("au1", fact.id, factRepo, opsRepo);

    const updated = await factRepo.get("au1", fact.id);
    expect(updated).not.toBeNull();
    expect(updated!.archived).toBe(false);
    // archived_at should be undefined or null after unarchive
    expect(updated!.archived_at == null).toBe(true);
  });

  it("unarchiveFact writes unarchive_fact op", async () => {
    const fact = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c",
      },
      factRepo,
      opsRepo,
    );

    await archiveFact("au1", fact.id, factRepo, opsRepo);
    await unarchiveFact("au1", fact.id, factRepo, opsRepo);

    const ops = await opsRepo.list_all("au1");
    const unarchiveOp = ops.find((o) => o.op_type === "unarchive_fact");
    expect(unarchiveOp).toBeDefined();
    expect(unarchiveOp!.target_id).toBe(fact.id);
  });

  it("archiveFact throws if fact not found", async () => {
    await expect(archiveFact("au1", "nonexistent", factRepo, opsRepo)).rejects.toThrow();
  });

  it("unarchiveFact throws if fact not found", async () => {
    await expect(unarchiveFact("au1", "nonexistent", factRepo, opsRepo)).rejects.toThrow();
  });

  it("createFact defaults archived to false", async () => {
    const fact = await addFact(
      "au1",
      1,
      {
        content_raw: "r",
        content_clean: "c",
      },
      factRepo,
      opsRepo,
    );

    expect(fact.archived).toBe(false);
  });
});
