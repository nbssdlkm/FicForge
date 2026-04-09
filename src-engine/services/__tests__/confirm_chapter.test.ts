// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import { confirm_chapter, ConfirmChapterError } from "../confirm_chapter.js";
import { createState } from "../../domain/state.js";
import { createDraft } from "../../domain/draft.js";
import { createGeneratedWith } from "../../domain/generated_with.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import { FileDraftRepository } from "../../repositories/implementations/file_draft.js";
import { FileStateRepository } from "../../repositories/implementations/file_state.js";
import { FileOpsRepository } from "../../repositories/implementations/file_ops.js";

describe("confirm_chapter", () => {
  let adapter: MockAdapter;
  let chapterRepo: FileChapterRepository;
  let draftRepo: FileDraftRepository;
  let stateRepo: FileStateRepository;
  let opsRepo: FileOpsRepository;

  beforeEach(async () => {
    adapter = new MockAdapter();
    chapterRepo = new FileChapterRepository(adapter);
    draftRepo = new FileDraftRepository(adapter);
    stateRepo = new FileStateRepository(adapter);
    opsRepo = new FileOpsRepository(adapter);

    // Seed initial state
    const state = createState({ au_id: "au1", current_chapter: 1 });
    await stateRepo.save(state);

    // Seed a draft
    await draftRepo.save(createDraft({
      au_id: "au1", chapter_num: 1, variant: "A",
      content: "Alice走进了房间。\n\n她看到了Bob。\n\n一切开始改变。",
    }));
  });

  it("5-step confirm: state + ops + chapter correct", async () => {
    const result = await confirm_chapter({
      au_id: "au1", chapter_num: 1, draft_id: "ch0001_draft_A.md",
      cast_registry: { characters: ["Alice", "Bob"] },
      chapter_repo: chapterRepo, draft_repo: draftRepo, state_repo: stateRepo, ops_repo: opsRepo,
    });

    expect(result.chapter_num).toBe(1);
    expect(result.revision).toBe(1);
    expect(result.content_hash).toBeTruthy();

    // State updated
    const state = await stateRepo.get("au1");
    expect(state.current_chapter).toBe(2);
    expect(state.chapter_focus).toEqual([]);
    expect(state.last_scene_ending).toBeTruthy();
    expect(state.characters_last_seen.Alice).toBe(1);

    // Ops logged
    const ops = await opsRepo.list_all("au1");
    expect(ops).toHaveLength(1);
    expect(ops[0].op_type).toBe("confirm_chapter");
    expect(ops[0].payload.characters_last_seen_snapshot).toBeTruthy();
    expect(ops[0].payload.last_scene_ending_snapshot).toBeTruthy();

    // Chapter exists
    const chapter = await chapterRepo.get("au1", 1);
    expect(chapter.provenance).toBe("ai");
    expect(chapter.content).toContain("Alice走进了房间");

    // Draft deleted
    const drafts = await draftRepo.list_by_chapter("au1", 1);
    expect(drafts).toHaveLength(0);
  });

  it("current_chapter increments on advancing", async () => {
    await confirm_chapter({
      au_id: "au1", chapter_num: 1, draft_id: "ch0001_draft_A.md",
      chapter_repo: chapterRepo, draft_repo: draftRepo, state_repo: stateRepo, ops_repo: opsRepo,
    });
    const state = await stateRepo.get("au1");
    expect(state.current_chapter).toBe(2);
  });

  it("content_override uses mixed provenance", async () => {
    const result = await confirm_chapter({
      au_id: "au1", chapter_num: 1, draft_id: "ch0001_draft_A.md",
      content_override: "用户编辑后的内容",
      chapter_repo: chapterRepo, draft_repo: draftRepo, state_repo: stateRepo, ops_repo: opsRepo,
    });
    const chapter = await chapterRepo.get("au1", 1);
    expect(chapter.provenance).toBe("mixed");
    expect(chapter.content).toContain("用户编辑后的内容");
  });

  it("throws on invalid draft_id", async () => {
    await expect(confirm_chapter({
      au_id: "au1", chapter_num: 1, draft_id: "invalid.md",
      chapter_repo: chapterRepo, draft_repo: draftRepo, state_repo: stateRepo, ops_repo: opsRepo,
    })).rejects.toThrow(ConfirmChapterError);
  });

  it("throws on chapter_num mismatch", async () => {
    await expect(confirm_chapter({
      au_id: "au1", chapter_num: 2, draft_id: "ch0001_draft_A.md",
      chapter_repo: chapterRepo, draft_repo: draftRepo, state_repo: stateRepo, ops_repo: opsRepo,
    })).rejects.toThrow("不匹配");
  });

  it("backup on overwrite existing chapter", async () => {
    // First confirm
    await confirm_chapter({
      au_id: "au1", chapter_num: 1, draft_id: "ch0001_draft_A.md",
      chapter_repo: chapterRepo, draft_repo: draftRepo, state_repo: stateRepo, ops_repo: opsRepo,
    });

    // Save another draft for same chapter
    await draftRepo.save(createDraft({ au_id: "au1", chapter_num: 1, variant: "B", content: "新版本内容" }));

    // Reset state to allow re-confirm
    const state = await stateRepo.get("au1");
    state.current_chapter = 1;
    await stateRepo.save(state);

    // Second confirm should backup
    const result = await confirm_chapter({
      au_id: "au1", chapter_num: 1, draft_id: "ch0001_draft_B.md",
      chapter_repo: chapterRepo, draft_repo: draftRepo, state_repo: stateRepo, ops_repo: opsRepo,
    });
    expect(result.revision).toBe(2);
  });

  it("preserves generated_with in ops payload", async () => {
    const gw = createGeneratedWith({ mode: "api", model: "gpt-4o", temperature: 0.8 });
    await confirm_chapter({
      au_id: "au1", chapter_num: 1, draft_id: "ch0001_draft_A.md",
      generated_with: gw,
      chapter_repo: chapterRepo, draft_repo: draftRepo, state_repo: stateRepo, ops_repo: opsRepo,
    });

    const ops = await opsRepo.list_all("au1");
    expect(ops[0].payload.generated_with.model).toBe("gpt-4o");
  });
});
