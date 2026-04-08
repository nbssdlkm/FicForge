// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import { FileFactRepository } from "../implementations/file_fact.js";
import { FactStatus, FactType, NarrativeWeight } from "../../domain/enums.js";
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
});
