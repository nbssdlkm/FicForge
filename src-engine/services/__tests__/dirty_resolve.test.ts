// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import { resolveDirtyChapter, DirtyResolveError } from "../dirty_resolve.js";
import { createState } from "../../domain/state.js";
import { createChapter } from "../../domain/chapter.js";
import { createFact } from "../../domain/fact.js";
import { createFactChange } from "../../domain/fact_change.js";
import { FactStatus } from "../../domain/enums.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import { FileStateRepository } from "../../repositories/implementations/file_state.js";
import { FileOpsRepository } from "../../repositories/implementations/file_ops.js";
import { FileFactRepository } from "../../repositories/implementations/file_fact.js";

describe("resolve_dirty_chapter", () => {
  let adapter: MockAdapter;
  let chapterRepo: FileChapterRepository;
  let stateRepo: FileStateRepository;
  let opsRepo: FileOpsRepository;
  let factRepo: FileFactRepository;

  beforeEach(async () => {
    adapter = new MockAdapter();
    chapterRepo = new FileChapterRepository(adapter);
    stateRepo = new FileStateRepository(adapter);
    opsRepo = new FileOpsRepository(adapter);
    factRepo = new FileFactRepository(adapter);
  });

  // ── helpers ──────────────────────────────────────────────────────

  async function seedChapter(auId: string, num: number, content: string) {
    const ch = createChapter({ au_id: auId, chapter_num: num, content });
    await chapterRepo.save(ch);
    return ch;
  }

  async function seedState(overrides: Record<string, unknown>) {
    const s = createState({ au_id: "au1", current_chapter: 1, ...overrides });
    await stateRepo.save(s);
    return s;
  }

  // ── validation ───────────────────────────────────────────────────

  it("throws if chapter not in chapters_dirty", async () => {
    await seedState({ chapters_dirty: [3] });
    await seedChapter("au1", 2, "content");

    await expect(
      resolveDirtyChapter({
        au_id: "au1",
        chapter_num: 2,
        confirmed_fact_changes: [],
        chapter_repo: chapterRepo,
        state_repo: stateRepo,
        ops_repo: opsRepo,
        fact_repo: factRepo,
      }),
    ).rejects.toThrow(DirtyResolveError);
  });

  it("throws if chapter file does not exist", async () => {
    await seedState({ chapters_dirty: [2] });

    await expect(
      resolveDirtyChapter({
        au_id: "au1",
        chapter_num: 2,
        confirmed_fact_changes: [],
        chapter_repo: chapterRepo,
        state_repo: stateRepo,
        ops_repo: opsRepo,
        fact_repo: factRepo,
      }),
    ).rejects.toThrow(DirtyResolveError);
  });

  // ── latest-chapter path ───────────────────────────────────────────

  it("latest chapter: updates characters_last_seen and last_scene_ending", async () => {
    await seedState({ current_chapter: 5, chapters_dirty: [4] });
    await seedChapter("au1", 4, "Alice entered the room.\n\nShe saw Bob standing by the window.");

    const result = await resolveDirtyChapter({
      au_id: "au1",
      chapter_num: 4,
      confirmed_fact_changes: [],
      cast_registry: { characters: ["Alice", "Bob"] },
      chapter_repo: chapterRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
      fact_repo: factRepo,
    });

    expect(result.is_latest).toBe(true);
    expect(result.content_hash).toBeTruthy();

    const state = await stateRepo.get("au1");
    expect(state.characters_last_seen).toBeDefined();
    const lastSeen = state.characters_last_seen ?? {};
    expect(lastSeen.Alice).toBe(4);
    expect(lastSeen.Bob).toBe(4);
    expect(state.last_scene_ending).toBeTruthy();
    expect(state.chapters_dirty).not.toContain(4);
  });

  // ── historical-chapter path ───────────────────────────────────────

  it("historical chapter: does NOT modify characters_last_seen or last_scene_ending", async () => {
    await seedState({
      current_chapter: 7,
      chapters_dirty: [3],
      characters_last_seen: { Alice: 5, Bob: 5 },
      last_scene_ending: "previous ending.",
    });
    await seedChapter("au1", 3, "Historical chapter content.");

    const result = await resolveDirtyChapter({
      au_id: "au1",
      chapter_num: 3,
      confirmed_fact_changes: [],
      cast_registry: { characters: ["Alice"] },
      chapter_repo: chapterRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
      fact_repo: factRepo,
    });

    expect(result.is_latest).toBe(false);

    const state = await stateRepo.get("au1");
    // 历史章：不修改角色和结尾
    expect(state.characters_last_seen).toEqual({ Alice: 5, Bob: 5 });
    expect(state.last_scene_ending).toBe("previous ending.");
    expect(state.chapters_dirty).not.toContain(3);
  });

  // ── fact changes ──────────────────────────────────────────────────

  it("applies fact changes after chapter/state commit", async () => {
    await seedState({ current_chapter: 3, chapters_dirty: [2] });
    await seedChapter("au1", 2, "Chapter two content.");

    // Seed a fact to edit
    const fact = createFact({
      id: "fact_001",
      au_id: "au1",
      chapter: 2,
      content_clean: "Bob has a secret.",
      status: FactStatus.ACTIVE,
    });
    await factRepo.append("au1", fact);

    const changes = [createFactChange({ fact_id: "fact_001", action: "deprecate" })];

    await resolveDirtyChapter({
      au_id: "au1",
      chapter_num: 2,
      confirmed_fact_changes: changes,
      chapter_repo: chapterRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
      fact_repo: factRepo,
    });

    // Fact should be deprecated
    const updated = await factRepo.get("au1", "fact_001");
    expect(updated?.status).toBe(FactStatus.DEPRECATED);

    // Ops should include both resolve_dirty_chapter and the deprecate op
    const ops = await opsRepo.list_all("au1");
    const resolveOp = ops.find((o) => o.op_type === "resolve_dirty_chapter");
    expect(resolveOp).toBeTruthy();
    expect(resolveOp?.chapter_num).toBe(2);
  });

  it("fact op 失败：解除本身成功返回，失败变更如实带回 failed_fact_changes（盲审 2026-07-11：不再伪装整体失败）", async () => {
    await seedState({ current_chapter: 3, chapters_dirty: [2] });
    await seedChapter("au1", 2, "Chapter two content.");

    // Use invalid fact_id — editFact will throw "Fact 不存在"
    const changes = [
      createFactChange({ fact_id: "nonexistent", action: "update", updated_fields: { status: "deprecated" } }),
    ];

    const result = await resolveDirtyChapter({
      au_id: "au1",
      chapter_num: 2,
      confirmed_fact_changes: changes,
      chapter_repo: chapterRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
      fact_repo: factRepo,
    });

    // 旧行为整体 rejects —— 但此时章节已 clean、重试必被「不在 dirty 列表」拒绝，
    // 用户勾选的变更静默丢失。新契约：resolve 成功 + 失败清单透出。
    expect(result.failed_fact_changes).toHaveLength(1);
    expect(result.failed_fact_changes[0]).toMatchObject({ fact_id: "nonexistent", action: "update" });
    expect(result.failed_fact_changes[0].error).toContain("Fact 不存在");

    // Key assertion: chapter is clean even though facts failed
    // (new order: chapter/state committed BEFORE facts)
    const state = await stateRepo.get("au1");
    expect(state.chapters_dirty).not.toContain(2);

    // Ops should still have the resolve_dirty_chapter op
    const ops = await opsRepo.list_all("au1");
    expect(ops.some((o) => o.op_type === "resolve_dirty_chapter")).toBe(true);
  });

  it("fact op 单条失败不连坐：其余变更照常应用", async () => {
    await seedState({ current_chapter: 3, chapters_dirty: [2] });
    await seedChapter("au1", 2, "Chapter two content.");
    const fact = createFact({
      id: "fact_ok1",
      au_id: "au1",
      chapter: 2,
      content_clean: "hero met villain",
      status: FactStatus.ACTIVE,
    });
    await factRepo.append("au1", fact);

    const changes = [
      createFactChange({ fact_id: "nonexistent", action: "deprecate" }),
      createFactChange({ fact_id: "fact_ok1", action: "deprecate" }),
    ];

    const result = await resolveDirtyChapter({
      au_id: "au1",
      chapter_num: 2,
      confirmed_fact_changes: changes,
      chapter_repo: chapterRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
      fact_repo: factRepo,
    });

    expect(result.failed_fact_changes).toHaveLength(1);
    expect(result.failed_fact_changes[0].fact_id).toBe("nonexistent");
    const updated = await factRepo.get("au1", "fact_ok1");
    expect(updated?.status).toBe(FactStatus.DEPRECATED);
  });

  // ── ops and state consistency ─────────────────────────────────────

  it("appends resolve_dirty_chapter op and sets index_status STALE", async () => {
    await seedState({ current_chapter: 4, chapters_dirty: [3] });
    await seedChapter("au1", 3, "Chapter three content.");

    await resolveDirtyChapter({
      au_id: "au1",
      chapter_num: 3,
      confirmed_fact_changes: [],
      chapter_repo: chapterRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
      fact_repo: factRepo,
    });

    const ops = await opsRepo.list_all("au1");
    expect(ops).toHaveLength(1);
    expect(ops[0].op_type).toBe("resolve_dirty_chapter");
    expect(ops[0].chapter_num).toBe(3);

    const state = await stateRepo.get("au1");
    expect(state.index_status).toBe("stale");
  });

  it("clears chapter from chapters_dirty array", async () => {
    await seedState({ current_chapter: 3, chapters_dirty: [2, 5, 7] });
    await seedChapter("au1", 5, "Chapter five content.");

    await resolveDirtyChapter({
      au_id: "au1",
      chapter_num: 5,
      confirmed_fact_changes: [],
      chapter_repo: chapterRepo,
      state_repo: stateRepo,
      ops_repo: opsRepo,
      fact_repo: factRepo,
    });

    const state = await stateRepo.get("au1");
    expect(state.chapters_dirty).toEqual([2, 7]);
  });
});
