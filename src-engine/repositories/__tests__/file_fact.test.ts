// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import { FileFactRepository, factToDict } from "../implementations/file_fact.js";
import { FactStatus, FactType, NarrativeWeight, TimeKind, SuspenseType } from "../../domain/enums.js";
import { createFact } from "../../domain/fact.js";
import { generate_fact_id } from "../implementations/file_utils.js";
import { MockAdapter } from "./mock_adapter.js";

describe("FileFactRepository", () => {
  let adapter: MockAdapter;
  let repo: FileFactRepository;

  beforeEach(() => {
    adapter = new MockAdapter();
    repo = new FileFactRepository(adapter);
  });

  it("returns empty list when file missing", async () => {
    const facts = await repo.list_all("au1");
    expect(facts).toEqual([]);
  });

  it("append and list round-trip", async () => {
    const fact = createFact({
      id: generate_fact_id(),
      content_raw: "第1章中 Alice 遇到 Bob",
      content_clean: "Alice 遇到了 Bob",
      characters: ["Alice", "Bob"],
      chapter: 1,
      status: FactStatus.ACTIVE,
      type: FactType.PLOT_EVENT,
    });
    await repo.append("au1", fact);

    const facts = await repo.list_all("au1");
    expect(facts).toHaveLength(1);
    expect(facts[0].content_clean).toBe("Alice 遇到了 Bob");
    expect(facts[0].characters).toEqual(["Alice", "Bob"]);
  });

  it("get by id returns correct fact", async () => {
    const fact = createFact({ id: "f_test_001", content_raw: "r", content_clean: "c" });
    await repo.append("au1", fact);
    const found = await repo.get("au1", "f_test_001");
    expect(found).not.toBeNull();
    expect(found!.id).toBe("f_test_001");
  });

  it("get by id returns null for missing", async () => {
    const found = await repo.get("au1", "nonexistent");
    expect(found).toBeNull();
  });

  it("list_by_status filters correctly", async () => {
    await repo.append("au1", createFact({ id: "f1", content_raw: "r", content_clean: "c", status: FactStatus.ACTIVE }));
    await repo.append("au1", createFact({ id: "f2", content_raw: "r", content_clean: "c", status: FactStatus.UNRESOLVED }));
    await repo.append("au1", createFact({ id: "f3", content_raw: "r", content_clean: "c", status: FactStatus.ACTIVE }));

    const active = await repo.list_by_status("au1", FactStatus.ACTIVE);
    expect(active).toHaveLength(2);
    const unresolved = await repo.list_unresolved("au1");
    expect(unresolved).toHaveLength(1);
  });

  it("list_by_characters filters by intersection", async () => {
    await repo.append("au1", createFact({ id: "f1", content_raw: "r", content_clean: "c", characters: ["Alice", "Bob"] }));
    await repo.append("au1", createFact({ id: "f2", content_raw: "r", content_clean: "c", characters: ["Charlie"] }));

    const result = await repo.list_by_characters("au1", ["Bob"]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("f1");
  });

  it("update modifies fact in place", async () => {
    const fact = createFact({ id: "f1", content_raw: "r", content_clean: "old", revision: 1 });
    await repo.append("au1", fact);

    fact.content_clean = "new";
    await repo.update("au1", fact);

    const updated = await repo.get("au1", "f1");
    expect(updated!.content_clean).toBe("new");
    expect(updated!.revision).toBe(2); // update increments 1 → 2
  });

  it("并发对同一 fact 的 update：revision 锁内基于磁盘单调自增（LOW）", async () => {
    await repo.append("au1", createFact({ id: "f1", content_raw: "r", content_clean: "v0", revision: 1 }));
    // 两个调用方各自读到 rev 1 的独立对象，并发提交更新。
    const f1 = (await repo.get("au1", "f1"))!;
    const f2 = (await repo.get("au1", "f1"))!;
    expect(f1.revision).toBe(1);
    expect(f2.revision).toBe(1);
    f1.content_clean = "a";
    f2.content_clean = "b";
    await Promise.all([repo.update("au1", f1), repo.update("au1", f2)]);

    // 锁内基于磁盘 +1 → 串行后 rev 1→2→3。
    // 回退旧码（锁外基于 caller 值 +1）两者都算 1→2 → 终态 revision=2（此断言即挂）。
    const final = (await repo.get("au1", "f1"))!;
    expect(final.revision).toBe(3);
  });

  it("delete_by_ids removes specific facts", async () => {
    await repo.append("au1", createFact({ id: "f1", content_raw: "r", content_clean: "c" }));
    await repo.append("au1", createFact({ id: "f2", content_raw: "r", content_clean: "c" }));
    await repo.append("au1", createFact({ id: "f3", content_raw: "r", content_clean: "c" }));

    await repo.delete_by_ids("au1", ["f1", "f3"]);
    const remaining = await repo.list_all("au1");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe("f2");
  });

  it("Chinese content preserved through round-trip", async () => {
    const fact = createFact({
      id: "f_zh",
      content_raw: "第3章中，Connor 发现了隐藏的线索",
      content_clean: "Connor 发现了隐藏的线索",
      characters: ["Connor"],
    });
    await repo.append("au1", fact);

    const loaded = await repo.get("au1", "f_zh");
    expect(loaded!.content_raw).toBe("第3章中，Connor 发现了隐藏的线索");
  });

  // ----------------------------------------------------------
  // M8-A MAJOR: dictToFact enum validation (time_kind / suspense_type)
  // Aligns with ops_projection.factFromPayload behaviour.
  // ----------------------------------------------------------

  it("dictToFact: valid time_kind round-trips correctly", async () => {
    const fact = createFact({
      id: "f_tk",
      content_raw: "r", content_clean: "c",
      time_kind: TimeKind.FLASHBACK,
    });
    await repo.append("au1", fact);
    const loaded = await repo.get("au1", "f_tk");
    expect(loaded!.time_kind).toBe(TimeKind.FLASHBACK);
  });

  it("dictToFact: illegal time_kind in JSONL is read back as null (not stored garbage)", async () => {
    // Manually write a bad JSONL line with an invalid time_kind
    const fact = createFact({ id: "f_bad_tk", content_raw: "r", content_clean: "c" });
    const d = factToDict(fact);
    (d as Record<string, unknown>).time_kind = "teleport"; // illegal value

    // Seed the raw JSONL directly into MockAdapter
    adapter.seed("au1/facts.jsonl", JSON.stringify(d) + "\n");

    const loaded = await repo.get("au1", "f_bad_tk");
    expect(loaded).not.toBeNull();
    // Illegal value must be normalised to null, not kept as-is
    expect(loaded!.time_kind).toBeNull();
  });

  it("dictToFact: valid suspense_type round-trips correctly", async () => {
    const fact = createFact({
      id: "f_st",
      content_raw: "r", content_clean: "c",
      suspense_type: SuspenseType.SECRET,
    });
    await repo.append("au1", fact);
    const loaded = await repo.get("au1", "f_st");
    expect(loaded!.suspense_type).toBe(SuspenseType.SECRET);
  });

  it("dictToFact: illegal suspense_type in JSONL is read back as null", async () => {
    const fact = createFact({ id: "f_bad_st", content_raw: "r", content_clean: "c" });
    const d = factToDict(fact);
    (d as Record<string, unknown>).suspense_type = "cliffhanger_typo"; // illegal

    adapter.seed("au1/facts.jsonl", JSON.stringify(d) + "\n");

    const loaded = await repo.get("au1", "f_bad_st");
    expect(loaded).not.toBeNull();
    expect(loaded!.suspense_type).toBeNull();
  });

  it("M8-A fields round-trip correctly through append/list", async () => {
    const fact = createFact({
      id: "f_m8a",
      content_raw: "r", content_clean: "c",
      location: "御书房",
      story_time_tag: "Y1 冬末",
      story_time_order: 10,
      time_kind: TimeKind.NORMAL,
      action_verb: "决裂",
      caused_by: ["f_001"],
      known_to: ["Alice", "Bob"],
      hidden_from: ["Charlie"],
      suspense_type: SuspenseType.FORESHADOW,
      _confidence: { location: "high", time_kind: "medium" },
    });
    await repo.append("au1", fact);
    const loaded = await repo.get("au1", "f_m8a");
    expect(loaded!.location).toBe("御书房");
    expect(loaded!.story_time_tag).toBe("Y1 冬末");
    expect(loaded!.story_time_order).toBe(10);
    expect(loaded!.time_kind).toBe(TimeKind.NORMAL);
    expect(loaded!.action_verb).toBe("决裂");
    expect(loaded!.caused_by).toEqual(["f_001"]);
    expect(loaded!.known_to).toEqual(["Alice", "Bob"]);
    expect(loaded!.hidden_from).toEqual(["Charlie"]);
    expect(loaded!.suspense_type).toBe(SuspenseType.FORESHADOW);
    expect(loaded!._confidence).toEqual({ location: "high", time_kind: "medium" });
  });
});
