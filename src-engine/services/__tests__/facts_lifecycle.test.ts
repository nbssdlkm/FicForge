// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import { add_fact, edit_fact, update_fact_status, set_chapter_focus, FactsLifecycleError } from "../facts_lifecycle.js";
import { FactStatus, TimeKind, SuspenseType, NarrativeWeight } from "../../domain/enums.js";
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

  // ----------------------------------------------------------
  // M8-A BLOCKER: add_fact forwards all M8-A fields to createFact
  // ----------------------------------------------------------

  it("add_fact forwards M8-A layer-2 fields to the persisted fact", async () => {
    const fact = await add_fact("au1", 3, {
      content_raw: "r",
      content_clean: "Alice 在御书房中决裂",
      characters: ["Alice"],
      status: "active",
      // Layer 2
      location: "御书房",
      story_time_tag: "Y1 冬末",
      story_time_order: 42,
      time_kind: TimeKind.FLASHBACK,
      action_verb: "决裂",
      caused_by: ["f_prev_001"],
    }, factRepo, opsRepo);

    // Returned fact must have M8-A fields
    expect(fact.location).toBe("御书房");
    expect(fact.story_time_tag).toBe("Y1 冬末");
    expect(fact.story_time_order).toBe(42);
    expect(fact.time_kind).toBe(TimeKind.FLASHBACK);
    expect(fact.action_verb).toBe("决裂");
    expect(fact.caused_by).toEqual(["f_prev_001"]);

    // Persisted fact (round-trip via repo) must also have them
    const stored = await factRepo.get("au1", fact.id);
    expect(stored!.location).toBe("御书房");
    expect(stored!.story_time_tag).toBe("Y1 冬末");
    expect(stored!.story_time_order).toBe(42);
    expect(stored!.time_kind).toBe(TimeKind.FLASHBACK);
    expect(stored!.action_verb).toBe("决裂");
    expect(stored!.caused_by).toEqual(["f_prev_001"]);

    // ops payload must carry the fields too (ops rebuild parity)
    const ops = await opsRepo.list_all("au1");
    const addOp = ops.find((o) => o.op_type === "add_fact");
    expect(addOp).toBeDefined();
    expect(addOp!.payload.fact.location).toBe("御书房");
    expect(addOp!.payload.fact.time_kind).toBe(TimeKind.FLASHBACK);
  });

  it("add_fact forwards M8-A layer-3 fields to the persisted fact", async () => {
    const fact = await add_fact("au1", 2, {
      content_raw: "r",
      content_clean: "Bob 知道秘密",
      status: "unresolved",
      // Layer 3
      known_to: ["Bob"],
      hidden_from: ["Alice"],
      suspense_type: SuspenseType.SECRET,
    }, factRepo, opsRepo);

    expect(fact.known_to).toEqual(["Bob"]);
    expect(fact.hidden_from).toEqual(["Alice"]);
    expect(fact.suspense_type).toBe(SuspenseType.SECRET);

    const stored = await factRepo.get("au1", fact.id);
    expect(stored!.known_to).toEqual(["Bob"]);
    expect(stored!.hidden_from).toEqual(["Alice"]);
    expect(stored!.suspense_type).toBe(SuspenseType.SECRET);
  });

  it("add_fact: illegal time_kind falls to null (not stored as garbage)", async () => {
    const fact = await add_fact("au1", 1, {
      content_raw: "r", content_clean: "c",
      time_kind: "teleport", // illegal
    }, factRepo, opsRepo);

    expect(fact.time_kind).toBeNull();
    const stored = await factRepo.get("au1", fact.id);
    expect(stored!.time_kind).toBeNull();
  });

  it("add_fact: illegal suspense_type falls to null", async () => {
    const fact = await add_fact("au1", 1, {
      content_raw: "r", content_clean: "c",
      suspense_type: "cliffhanger_typo", // illegal
    }, factRepo, opsRepo);

    expect(fact.suspense_type).toBeNull();
  });

  it("add_fact: known_to string value 'all' is preserved", async () => {
    const fact = await add_fact("au1", 1, {
      content_raw: "r", content_clean: "c",
      known_to: "all",
    }, factRepo, opsRepo);

    expect(fact.known_to).toBe("all");
    const stored = await factRepo.get("au1", fact.id);
    expect(stored!.known_to).toBe("all");
  });

  it("add_fact: known_to array filters non-strings and normalizes aliases", async () => {
    const fact = await add_fact("au1", 1, {
      content_raw: "r", content_clean: "c",
      known_to: ["小明", 42, "Bob"] as unknown as string[], // 42 must be filtered
    }, factRepo, opsRepo, "manual", { "明华": ["小明"] });

    // 42 filtered, 小明 normalized to 明华
    expect(Array.isArray(fact.known_to)).toBe(true);
    expect(fact.known_to).toContain("明华");
    expect(fact.known_to).toContain("Bob");
    expect((fact.known_to as string[]).some((v) => typeof v !== "string")).toBe(false);
  });

  it("add_fact: _confidence is forwarded to the fact", async () => {
    const confidence = { location: "high" as const, time_kind: "medium" as const };
    const fact = await add_fact("au1", 1, {
      content_raw: "r", content_clean: "c",
      location: "花园",
      _confidence: confidence,
    }, factRepo, opsRepo);

    expect(fact._confidence).toEqual(confidence);
    const stored = await factRepo.get("au1", fact.id);
    expect(stored!._confidence).toEqual(confidence);
  });
});
