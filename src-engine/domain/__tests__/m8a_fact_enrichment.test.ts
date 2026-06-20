// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * M8-A Fact Enrichment — TDD tests (T1, T2, T3).
 * T1: enum completeness
 * T2: createFact new field defaults
 * T3: factToDict / dictToFact round-trip (via FileFactRepository)
 *
 * Written BEFORE implementation (TDD red phase).
 */

import { describe, expect, it, beforeEach } from "vitest";
import { TimeKind, SuspenseType, TIME_KIND_VALUES, SUSPENSE_TYPE_VALUES } from "../enums.js";
import { createFact } from "../fact.js";
import { factToDict } from "../../repositories/implementations/file_fact.js";
import { FileFactRepository } from "../../repositories/implementations/file_fact.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";

// ===========================================================================
// T1: Enum completeness
// ===========================================================================

describe("T1: TimeKind enum (M8-A)", () => {
  it("has exactly 6 values", () => {
    const values = Object.values(TimeKind);
    expect(values).toHaveLength(6);
  });

  it("contains all required variants", () => {
    expect(TimeKind.NORMAL).toBe("normal");
    expect(TimeKind.FLASHBACK).toBe("flashback");
    expect(TimeKind.INSERT).toBe("insert");
    expect(TimeKind.DREAM).toBe("dream");
    expect(TimeKind.PARALLEL).toBe("parallel");
    expect(TimeKind.IMAGINED).toBe("imagined");
  });

  it("TIME_KIND_VALUES has 6 entries", () => {
    expect(TIME_KIND_VALUES).toHaveLength(6);
  });
});

describe("T1: SuspenseType enum (M8-A)", () => {
  it("has exactly 4 values", () => {
    const values = Object.values(SuspenseType);
    expect(values).toHaveLength(4);
  });

  it("contains all required variants", () => {
    expect(SuspenseType.FORESHADOW).toBe("foreshadow");
    expect(SuspenseType.SECRET).toBe("secret");
    expect(SuspenseType.MISUNDERSTANDING).toBe("misunderstanding");
    expect(SuspenseType.SETUP).toBe("setup");
  });

  it("SUSPENSE_TYPE_VALUES has 4 entries", () => {
    expect(SUSPENSE_TYPE_VALUES).toHaveLength(4);
  });
});

// ===========================================================================
// T2: createFact new field defaults
// ===========================================================================

describe("T2: createFact new field defaults (M8-A)", () => {
  it("new Layer 2 fields absent when not provided", () => {
    const fact = createFact({ id: "f1", content_raw: "r", content_clean: "c" });
    // All new fields should be undefined (not set) or null
    expect(fact.location == null).toBe(true);
    expect(fact.story_time_tag == null).toBe(true);
    expect(fact.story_time_order == null).toBe(true);
    expect(fact.time_kind == null).toBe(true);
    expect(fact.action_verb == null).toBe(true);
    // caused_by: either absent or empty array
    const cb = fact.caused_by;
    expect(cb === undefined || (Array.isArray(cb) && cb.length === 0)).toBe(true);
  });

  it("new Layer 3 fields absent when not provided", () => {
    const fact = createFact({ id: "f1", content_raw: "r", content_clean: "c" });
    expect(fact.known_to == null).toBe(true);
    const hf = fact.hidden_from;
    expect(hf === undefined || (Array.isArray(hf) && hf.length === 0)).toBe(true);
    expect(fact.suspense_type == null).toBe(true);
    expect(fact._confidence).toBeUndefined();
  });

  it("factToDict with no new fields does NOT emit new keys (keeps JSONL clean)", () => {
    const fact = createFact({ id: "f1", content_raw: "r", content_clean: "c" });
    const d = factToDict(fact);
    expect(d).not.toHaveProperty("location");
    expect(d).not.toHaveProperty("story_time_tag");
    expect(d).not.toHaveProperty("story_time_order");
    expect(d).not.toHaveProperty("time_kind");
    expect(d).not.toHaveProperty("action_verb");
    expect(d).not.toHaveProperty("caused_by");
    expect(d).not.toHaveProperty("known_to");
    expect(d).not.toHaveProperty("hidden_from");
    expect(d).not.toHaveProperty("suspense_type");
    expect(d).not.toHaveProperty("_confidence");
  });
});

// ===========================================================================
// T3: factToDict / dictToFact round-trip (via FileFactRepository)
// ===========================================================================

describe("T3: file_fact round-trip with new enrichment fields (M8-A)", () => {
  let adapter: MockAdapter;
  let repo: FileFactRepository;

  beforeEach(() => {
    adapter = new MockAdapter();
    repo = new FileFactRepository(adapter);
  });

  it("full Layer 2 + Layer 3 fields round-trip via append/get", async () => {
    const fact = createFact({
      id: "f_enrich_01",
      content_raw: "第3章 皇帝暗中赐毒",
      content_clean: "皇帝暗中赐毒",
      location: "御书房",
      story_time_tag: "Y1 冬末",
      story_time_order: 3,
      time_kind: TimeKind.NORMAL,
      action_verb: "赐毒",
      caused_by: ["f_001_abcd"],
      known_to: "reader_only" as "reader_only",
      hidden_from: ["皇后"],
      suspense_type: SuspenseType.SECRET,
      _confidence: {
        location: "high",
        known_to: "high",
        time_kind: "medium",
        action_verb: "high",
        suspense_type: "medium",
      },
    });

    await repo.append("au1", fact);
    const loaded = await repo.get("au1", "f_enrich_01");

    expect(loaded).not.toBeNull();
    expect(loaded!.location).toBe("御书房");
    expect(loaded!.story_time_tag).toBe("Y1 冬末");
    expect(loaded!.story_time_order).toBe(3);
    expect(loaded!.time_kind).toBe("normal");
    expect(loaded!.action_verb).toBe("赐毒");
    expect(loaded!.caused_by).toEqual(["f_001_abcd"]);
    expect(loaded!.known_to).toBe("reader_only");
    expect(loaded!.hidden_from).toEqual(["皇后"]);
    expect(loaded!.suspense_type).toBe("secret");
    expect(loaded!._confidence).toEqual({
      location: "high",
      known_to: "high",
      time_kind: "medium",
      action_verb: "high",
      suspense_type: "medium",
    });
  });

  it("known_to as string 'all' round-trips correctly", async () => {
    const fact = createFact({
      id: "f_kt_all",
      content_raw: "r",
      content_clean: "c",
      known_to: "all" as "all",
    });
    await repo.append("au1", fact);
    const loaded = await repo.get("au1", "f_kt_all");
    expect(loaded!.known_to).toBe("all");
  });

  it("known_to as string array round-trips correctly", async () => {
    const fact = createFact({
      id: "f_kt_arr",
      content_raw: "r",
      content_clean: "c",
      known_to: ["Alice", "Bob"],
    });
    await repo.append("au1", fact);
    const loaded = await repo.get("au1", "f_kt_arr");
    expect(loaded!.known_to).toEqual(["Alice", "Bob"]);
  });

  it("caused_by array round-trips correctly", async () => {
    const fact = createFact({
      id: "f_cb",
      content_raw: "r",
      content_clean: "c",
      caused_by: ["f_123_abcd", "f_456_efgh"],
    });
    await repo.append("au1", fact);
    const loaded = await repo.get("au1", "f_cb");
    expect(loaded!.caused_by).toEqual(["f_123_abcd", "f_456_efgh"]);
  });

  it("old-format dict (no new fields) → defaults cleanly (forward compat)", async () => {
    // Simulate a legacy fact without new fields
    const legacyFact = createFact({ id: "f_legacy", content_raw: "r", content_clean: "legacy" });
    await repo.append("au1", legacyFact);
    const loaded = await repo.get("au1", "f_legacy");
    expect(loaded).not.toBeNull();
    expect(loaded!.content_clean).toBe("legacy");
    // New fields should be null or empty (not crash)
    const loc = loaded!.location;
    expect(loc === undefined || loc === null).toBe(true);
    const cb = loaded!.caused_by;
    expect(cb === undefined || (Array.isArray(cb) && cb.length === 0)).toBe(true);
  });
});
