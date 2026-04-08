// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import { FileOpsRepository } from "../implementations/file_ops.js";
import { createOpsEntry } from "../../domain/ops_entry.js";
import { MockAdapter } from "./mock_adapter.js";

describe("FileOpsRepository", () => {
  let adapter: MockAdapter;
  let repo: FileOpsRepository;

  beforeEach(() => {
    adapter = new MockAdapter();
    repo = new FileOpsRepository(adapter);
  });

  it("returns empty list when file missing", async () => {
    const entries = await repo.list_all("au1");
    expect(entries).toEqual([]);
  });

  it("append and list round-trip", async () => {
    const entry = createOpsEntry({
      op_id: "op_001",
      op_type: "confirm_chapter",
      target_id: "au1",
      timestamp: "2026-01-01T00:00:00Z",
      chapter_num: 1,
      payload: { last_scene_ending_snapshot: "他转身离去。" },
    });
    await repo.append("au1", entry);

    const entries = await repo.list_all("au1");
    expect(entries).toHaveLength(1);
    expect(entries[0].op_type).toBe("confirm_chapter");
    expect(entries[0].payload.last_scene_ending_snapshot).toBe("他转身离去。");
  });

  it("list_by_chapter filters correctly", async () => {
    await repo.append("au1", createOpsEntry({ op_id: "op1", op_type: "confirm_chapter", target_id: "t", timestamp: "t", chapter_num: 1 }));
    await repo.append("au1", createOpsEntry({ op_id: "op2", op_type: "add_fact", target_id: "t", timestamp: "t", chapter_num: 2 }));
    await repo.append("au1", createOpsEntry({ op_id: "op3", op_type: "add_fact", target_id: "t", timestamp: "t", chapter_num: 1 }));

    const ch1 = await repo.list_by_chapter("au1", 1);
    expect(ch1).toHaveLength(2);
  });

  it("get_confirm_for_chapter returns latest", async () => {
    await repo.append("au1", createOpsEntry({ op_id: "op1", op_type: "confirm_chapter", target_id: "t", timestamp: "t1", chapter_num: 1 }));
    await repo.append("au1", createOpsEntry({ op_id: "op2", op_type: "confirm_chapter", target_id: "t", timestamp: "t2", chapter_num: 1 }));

    const latest = await repo.get_confirm_for_chapter("au1", 1);
    expect(latest).not.toBeNull();
    expect(latest!.op_id).toBe("op2");
  });

  it("get_confirm_for_chapter returns null when none", async () => {
    const result = await repo.get_confirm_for_chapter("au1", 99);
    expect(result).toBeNull();
  });

  it("get_add_facts_for_chapter", async () => {
    await repo.append("au1", createOpsEntry({ op_id: "op1", op_type: "add_fact", target_id: "t", timestamp: "t", chapter_num: 1 }));
    await repo.append("au1", createOpsEntry({ op_id: "op2", op_type: "add_fact", target_id: "t", timestamp: "t", chapter_num: 2 }));

    const facts = await repo.get_add_facts_for_chapter("au1", 1);
    expect(facts).toHaveLength(1);
  });

  it("get_latest_by_type returns last entry", async () => {
    await repo.append("au1", createOpsEntry({ op_id: "op1", op_type: "rebuild_index", target_id: "t", timestamp: "t1" }));
    await repo.append("au1", createOpsEntry({ op_id: "op2", op_type: "rebuild_index", target_id: "t", timestamp: "t2" }));

    const latest = await repo.get_latest_by_type("au1", "rebuild_index");
    expect(latest!.op_id).toBe("op2");
  });

  it("strict append-only (no update/delete methods)", async () => {
    // FileOpsRepository should not have update or delete methods
    expect((repo as any).update).toBeUndefined();
    expect((repo as any).delete).toBeUndefined();
  });
});
