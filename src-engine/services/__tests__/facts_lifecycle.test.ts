// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import { add_fact, edit_fact, update_fact_status, set_chapter_focus, FactsLifecycleError } from "../facts_lifecycle.js";
import { FactStatus } from "../../domain/enums.js";
import { FileFactRepository } from "../../repositories/implementations/file_fact.js";
import { FileOpsRepository } from "../../repositories/implementations/file_ops.js";
import { FileStateRepository } from "../../repositories/implementations/file_state.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";

describe("Facts Lifecycle", () => {
  let adapter: MockAdapter;
  let factRepo: FileFactRepository;
  let opsRepo: FileOpsRepository;
  let stateRepo: FileStateRepository;

  beforeEach(() => {
    adapter = new MockAdapter();
    factRepo = new FileFactRepository(adapter);
    opsRepo = new FileOpsRepository(adapter);
    stateRepo = new FileStateRepository(adapter);
  });

  it("add_fact appends and returns fact", async () => {
    const fact = await add_fact("au1", 1, {
      content_raw: "Alice met Bob",
      content_clean: "Alice met Bob",
      characters: ["Alice", "Bob"],
      status: "active",
      type: "plot_event",
    }, factRepo, opsRepo);

    expect(fact.id).toMatch(/^f_/);
    expect(fact.content_clean).toBe("Alice met Bob");
    expect(fact.characters).toEqual(["Alice", "Bob"]);

    const all = await factRepo.list_all("au1");
    expect(all).toHaveLength(1);

    const ops = await opsRepo.list_all("au1");
    expect(ops).toHaveLength(1);
    expect(ops[0].op_type).toBe("add_fact");
  });

  it("add_fact with alias normalization", async () => {
    const fact = await add_fact("au1", 1, {
      content_raw: "r",
      content_clean: "c",
      characters: ["小明", "Bob"],
    }, factRepo, opsRepo, "manual", { 明华: ["小明"] });

    expect(fact.characters).toEqual(["明华", "Bob"]);
  });

  it("add_fact triggers resolves forward cascade", async () => {
    const f1 = await add_fact("au1", 1, {
      content_raw: "r", content_clean: "unresolved thing",
      status: "unresolved",
    }, factRepo, opsRepo);

    const f2 = await add_fact("au1", 2, {
      content_raw: "r", content_clean: "resolves the thing",
      status: "active", resolves: f1.id,
    }, factRepo, opsRepo);

    const updated = await factRepo.get("au1", f1.id);
    expect(updated!.status).toBe(FactStatus.RESOLVED);
  });

  it("edit_fact removes resolves → reverse cascade", async () => {
    const f1 = await add_fact("au1", 1, {
      content_raw: "r", content_clean: "mystery",
      status: "unresolved",
    }, factRepo, opsRepo);

    const f2 = await add_fact("au1", 2, {
      content_raw: "r", content_clean: "answer",
      resolves: f1.id,
    }, factRepo, opsRepo);

    // f1 should be RESOLVED now
    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.RESOLVED);

    // Remove resolves
    await edit_fact("au1", f2.id, { resolves: null }, factRepo, opsRepo, stateRepo);

    // f1 should revert to UNRESOLVED
    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.UNRESOLVED);
  });

  it("edit_fact keeps RESOLVED if other fact still resolves", async () => {
    const f1 = await add_fact("au1", 1, {
      content_raw: "r", content_clean: "mystery",
      status: "unresolved",
    }, factRepo, opsRepo);

    const f2 = await add_fact("au1", 2, {
      content_raw: "r", content_clean: "partial answer",
      resolves: f1.id,
    }, factRepo, opsRepo);

    const f3 = await add_fact("au1", 3, {
      content_raw: "r", content_clean: "another answer",
      resolves: f1.id,
    }, factRepo, opsRepo);

    // Remove resolves from f2 only
    await edit_fact("au1", f2.id, { resolves: null }, factRepo, opsRepo, stateRepo);

    // f1 should stay RESOLVED (f3 still resolves it)
    expect((await factRepo.get("au1", f1.id))!.status).toBe(FactStatus.RESOLVED);
  });

  it("edit_fact throws on missing fact", async () => {
    await expect(
      edit_fact("au1", "nonexistent", {}, factRepo, opsRepo, stateRepo),
    ).rejects.toThrow(FactsLifecycleError);
  });

  it("update_fact_status changes status and cleans focus", async () => {
    const f1 = await add_fact("au1", 1, {
      content_raw: "r", content_clean: "c", status: "unresolved",
    }, factRepo, opsRepo);

    // Set as focus
    await set_chapter_focus("au1", [f1.id], factRepo, opsRepo, stateRepo);

    // Deprecate
    const result = await update_fact_status("au1", f1.id, "deprecated", 1, factRepo, opsRepo, stateRepo);
    expect(result.focus_warning).toBe(true);

    // Focus should be empty now
    const state = await stateRepo.get("au1");
    expect(state.chapter_focus).toEqual([]);
  });

  it("set_chapter_focus validates max 2", async () => {
    const f1 = await add_fact("au1", 1, { content_raw: "r", content_clean: "c", status: "unresolved" }, factRepo, opsRepo);
    const f2 = await add_fact("au1", 1, { content_raw: "r", content_clean: "c", status: "unresolved" }, factRepo, opsRepo);
    const f3 = await add_fact("au1", 1, { content_raw: "r", content_clean: "c", status: "unresolved" }, factRepo, opsRepo);

    await expect(
      set_chapter_focus("au1", [f1.id, f2.id, f3.id], factRepo, opsRepo, stateRepo),
    ).rejects.toThrow("最多 2 个");
  });

  it("set_chapter_focus validates unresolved only", async () => {
    const f1 = await add_fact("au1", 1, { content_raw: "r", content_clean: "c", status: "active" }, factRepo, opsRepo);

    await expect(
      set_chapter_focus("au1", [f1.id], factRepo, opsRepo, stateRepo),
    ).rejects.toThrow("只能选 unresolved");
  });
});
