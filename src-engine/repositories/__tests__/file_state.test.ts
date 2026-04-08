// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it, beforeEach } from "vitest";
import { FileStateRepository } from "../implementations/file_state.js";
import { IndexStatus } from "../../domain/enums.js";
import { MockAdapter } from "./mock_adapter.js";

describe("FileStateRepository", () => {
  let adapter: MockAdapter;
  let repo: FileStateRepository;

  beforeEach(() => {
    adapter = new MockAdapter();
    repo = new FileStateRepository(adapter);
  });

  it("returns default state when file missing", async () => {
    const state = await repo.get("au1");
    expect(state.au_id).toBe("au1");
    expect(state.current_chapter).toBe(1);
    expect(state.index_status).toBe(IndexStatus.STALE);
  });

  it("save and get round-trip", async () => {
    const state = await repo.get("au1");
    state.current_chapter = 5;
    state.last_scene_ending = "他转身离去。";
    state.chapter_titles = { 1: "黄昏的告别", 2: "新的开始" };
    state.characters_last_seen = { Alice: 3, Bob: 5 };
    await repo.save(state);

    const loaded = await repo.get("au1");
    expect(loaded.current_chapter).toBe(5);
    expect(loaded.last_scene_ending).toBe("他转身离去。");
    expect(loaded.chapter_titles[1]).toBe("黄昏的告别");
    expect(loaded.characters_last_seen.Alice).toBe(3);
    expect(loaded.revision).toBe(state.revision); // save increments
  });

  it("save increments revision", async () => {
    const state = await repo.get("au1");
    expect(state.revision).toBe(0); // default from createState
    await repo.save(state);
    const loaded = await repo.get("au1");
    expect(loaded.revision).toBe(1);
  });

  it("reads existing YAML correctly", async () => {
    adapter.seed("au1/state.yaml", [
      "au_id: au1",
      "current_chapter: 10",
      "index_status: ready",
      "chapters_dirty:",
      "  - 3",
      "  - 5",
      "",
    ].join("\n"));

    const state = await repo.get("au1");
    expect(state.current_chapter).toBe(10);
    expect(state.index_status).toBe(IndexStatus.READY);
    expect(state.chapters_dirty).toEqual([3, 5]);
  });

  it("handles Chinese content in YAML", async () => {
    const state = await repo.get("au1");
    state.last_scene_ending = "夕阳西下，断肠人在天涯。";
    await repo.save(state);

    const loaded = await repo.get("au1");
    expect(loaded.last_scene_ending).toBe("夕阳西下，断肠人在天涯。");
  });
});
