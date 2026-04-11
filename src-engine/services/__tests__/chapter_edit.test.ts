// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import { edit_chapter_content } from "../chapter_edit.js";
import { createState } from "../../domain/state.js";
import { createChapter } from "../../domain/chapter.js";
import { IndexStatus } from "../../domain/enums.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import { FileStateRepository } from "../../repositories/implementations/file_state.js";
import { FileOpsRepository } from "../../repositories/implementations/file_ops.js";

describe("edit_chapter_content", () => {
  let adapter: MockAdapter;
  let chapterRepo: FileChapterRepository;
  let stateRepo: FileStateRepository;
  let opsRepo: FileOpsRepository;

  beforeEach(async () => {
    adapter = new MockAdapter();
    chapterRepo = new FileChapterRepository(adapter);
    stateRepo = new FileStateRepository(adapter);
    opsRepo = new FileOpsRepository(adapter);

    // Seed state
    const state = createState({ au_id: "au1", current_chapter: 2 });
    state.index_status = IndexStatus.READY;
    await stateRepo.save(state);

    // Seed a confirmed chapter
    await chapterRepo.save(createChapter({
      au_id: "au1",
      chapter_num: 1,
      content: "Original content.",
      revision: 1,
      provenance: "ai",
    }));
  });

  it("updates content, hash, provenance, and revision", async () => {
    const result = await edit_chapter_content(
      "au1", 1, "Updated content.",
      chapterRepo, stateRepo, opsRepo,
    );

    expect(result.chapter_num).toBe(1);
    expect(result.provenance).toBe("mixed");
    expect(result.revision).toBe(2);
    expect(result.content_hash).toBeTruthy();

    // Verify persisted chapter
    const ch = await chapterRepo.get("au1", 1);
    expect(ch.content).toBe("Updated content.");
    expect(ch.provenance).toBe("mixed");
    expect(ch.revision).toBe(2);
  });

  it("writes mark_chapters_dirty op to ops.jsonl", async () => {
    await edit_chapter_content(
      "au1", 1, "New content.",
      chapterRepo, stateRepo, opsRepo,
    );

    const ops = await opsRepo.list_all("au1");
    expect(ops.length).toBeGreaterThanOrEqual(1);
    const dirtyOp = ops.find((o) => o.op_type === "mark_chapters_dirty");
    expect(dirtyOp).toBeTruthy();
    expect(dirtyOp!.payload.chapters_dirty).toContain(1);
  });

  it("adds chapter_num to chapters_dirty in state", async () => {
    await edit_chapter_content(
      "au1", 1, "New content.",
      chapterRepo, stateRepo, opsRepo,
    );

    const st = await stateRepo.get("au1");
    expect(st.chapters_dirty).toContain(1);
  });

  it("does not duplicate chapter_num in chapters_dirty", async () => {
    // Pre-set dirty
    const st = await stateRepo.get("au1");
    st.chapters_dirty.push(1);
    await stateRepo.save(st);

    await edit_chapter_content(
      "au1", 1, "New content.",
      chapterRepo, stateRepo, opsRepo,
    );

    const st2 = await stateRepo.get("au1");
    const count = st2.chapters_dirty.filter((n) => n === 1).length;
    expect(count).toBe(1);
  });

  it("sets index_status to STALE", async () => {
    // Verify initial state is READY
    const stBefore = await stateRepo.get("au1");
    expect(stBefore.index_status).toBe(IndexStatus.READY);

    await edit_chapter_content(
      "au1", 1, "New content.",
      chapterRepo, stateRepo, opsRepo,
    );

    const st = await stateRepo.get("au1");
    expect(st.index_status).toBe(IndexStatus.STALE);
  });

  it("increments revision on successive edits", async () => {
    const r1 = await edit_chapter_content(
      "au1", 1, "Edit 1.",
      chapterRepo, stateRepo, opsRepo,
    );
    expect(r1.revision).toBe(2);

    const r2 = await edit_chapter_content(
      "au1", 1, "Edit 2.",
      chapterRepo, stateRepo, opsRepo,
    );
    expect(r2.revision).toBe(3);
  });
});
