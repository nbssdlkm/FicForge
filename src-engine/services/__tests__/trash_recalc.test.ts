// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import { TrashService } from "../trash_service.js";
import { recalc_state } from "../recalc_state.js";
import { confirm_chapter } from "../confirm_chapter.js";
import { createState } from "../../domain/state.js";
import { createDraft } from "../../domain/draft.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";
import { FileDraftRepository } from "../../repositories/implementations/file_draft.js";
import { FileStateRepository } from "../../repositories/implementations/file_state.js";
import { FileOpsRepository } from "../../repositories/implementations/file_ops.js";
import { FileProjectRepository } from "../../repositories/implementations/file_project.js";
import { FileFactRepository } from "../../repositories/implementations/file_fact.js";

// ===========================================================================
// Trash Service
// ===========================================================================

describe("TrashService", () => {
  let adapter: MockAdapter;
  let trash: TrashService;

  beforeEach(() => {
    adapter = new MockAdapter();
    trash = new TrashService(adapter, 30);
  });

  it("move_to_trash and list_trash", async () => {
    adapter.seed("au1/characters/Alice.md", "---\nname: Alice\n---\n# Alice\nSetting");
    const entry = await trash.move_to_trash("au1", "characters/Alice.md", "character_file", "Alice");

    expect(entry.trash_id).toMatch(/^tr_/);
    expect(entry.original_path).toBe("characters/Alice.md");
    expect(entry.entity_type).toBe("character_file");

    // Original gone
    expect(adapter.raw("au1/characters/Alice.md")).toBeUndefined();

    // In trash
    const list = await trash.list_trash("au1");
    expect(list).toHaveLength(1);
    expect(list[0].trash_id).toBe(entry.trash_id);
  });

  it("restore from trash", async () => {
    adapter.seed("au1/characters/Bob.md", "# Bob");
    const entry = await trash.move_to_trash("au1", "characters/Bob.md", "character_file", "Bob");

    await trash.restore("au1", entry.trash_id);

    // Restored
    expect(adapter.raw("au1/characters/Bob.md")).toBe("# Bob");

    // Removed from manifest
    const list = await trash.list_trash("au1");
    expect(list).toHaveLength(0);
  });

  it("restore fails if original path exists", async () => {
    adapter.seed("au1/characters/C.md", "original");
    const entry = await trash.move_to_trash("au1", "characters/C.md", "character_file", "C");
    adapter.seed("au1/characters/C.md", "new file occupying the path");

    await expect(trash.restore("au1", entry.trash_id)).rejects.toThrow("原路径已存在");
  });

  it("permanent_delete removes from trash", async () => {
    adapter.seed("au1/test.md", "content");
    const entry = await trash.move_to_trash("au1", "test.md", "character_file", "test");

    await trash.permanent_delete("au1", entry.trash_id);

    const list = await trash.list_trash("au1");
    expect(list).toHaveLength(0);
  });

  it("purge_expired with force all", async () => {
    adapter.seed("au1/a.md", "a");
    adapter.seed("au1/b.md", "b");
    await trash.move_to_trash("au1", "a.md", "file", "a");
    await trash.move_to_trash("au1", "b.md", "file", "b");

    const purged = await trash.purge_expired("au1", 0);
    expect(purged).toHaveLength(2);

    const list = await trash.list_trash("au1");
    expect(list).toHaveLength(0);
  });

  it("path traversal blocked", async () => {
    await expect(
      trash.move_to_trash("au1", "../etc/passwd", "file", "bad"),
    ).rejects.toThrow("非法路径");
  });
});

// ===========================================================================
// Recalc State
// ===========================================================================

describe("recalc_state", () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
  });

  it("rebuilds state from chapters", async () => {
    const chapterRepo = new FileChapterRepository(adapter);
    const stateRepo = new FileStateRepository(adapter);
    const opsRepo = new FileOpsRepository(adapter);
    const draftRepo = new FileDraftRepository(adapter);
    const projectRepo = new FileProjectRepository(adapter);

    // Seed project.yaml so recalc can read cast_registry
    adapter.seed("au1/project.yaml", "project_id: p1\nau_id: au1\ncast_registry:\n  characters:\n    - Alice\n    - Bob\n");

    // Initialize and confirm 2 chapters
    await stateRepo.save(createState({ au_id: "au1" }));
    for (let i = 1; i <= 2; i++) {
      await draftRepo.save(createDraft({
        au_id: "au1", chapter_num: i, variant: "A",
        content: `Alice在第${i}章出场。Bob也在。`,
      }));
      const state = await stateRepo.get("au1");
      state.current_chapter = i;
      await stateRepo.save(state);
      await confirm_chapter({
        au_id: "au1", chapter_num: i,
        draft_id: `ch${String(i).padStart(4, "0")}_draft_A.md`,
        cast_registry: { characters: ["Alice", "Bob"] },
        chapter_repo: chapterRepo, draft_repo: draftRepo, state_repo: stateRepo, ops_repo: opsRepo,
      });
    }

    // Corrupt state
    const state = await stateRepo.get("au1");
    state.characters_last_seen = {};
    state.last_scene_ending = "";
    state.chapters_dirty = [99]; // stale dirty mark
    await stateRepo.save(state);

    // Recalc
    const result = await recalc_state("au1", stateRepo, chapterRepo, projectRepo);

    expect(result.chapters_scanned).toBe(2);
    expect(result.characters_last_seen.Alice).toBe(2);
    expect(result.characters_last_seen.Bob).toBe(2);
    expect(result.last_scene_ending).toBeTruthy();
    expect(result.cleaned_dirty_count).toBe(1); // ch99 doesn't exist
  });

  it("empty AU returns clean state", async () => {
    const stateRepo = new FileStateRepository(adapter);
    const chapterRepo = new FileChapterRepository(adapter);
    const projectRepo = new FileProjectRepository(adapter);

    // No chapters exist, but we need project.yaml for projectRepo
    // projectRepo.get will throw, which is caught internally
    const result = await recalc_state("au1", stateRepo, chapterRepo, projectRepo);

    expect(result.chapters_scanned).toBe(0);
    expect(result.characters_last_seen).toEqual({});
  });
});
