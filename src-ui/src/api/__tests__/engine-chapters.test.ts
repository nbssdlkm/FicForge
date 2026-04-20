// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as engineModule from "@ficforge/engine";
import { createDraft, IndexStatus } from "@ficforge/engine";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";
import { confirmChapter } from "../engine-chapters";
import { createAu, createFandom } from "../engine-fandom";
import { getEngine, initEngine } from "../engine-instance";

describe("engine-chapters confirmChapter RAG orchestration", () => {
  let adapter: MockAdapter;
  let auPath: string;

  async function enableEmbeddingSettings() {
    const settings = await getEngine().repos.settings.get();
    settings.embedding.api_base = "https://embed.example.com/v1";
    settings.embedding.api_key = "embed-secret";
    settings.embedding.model = "embed-test";
    await getEngine().repos.settings.save(settings);
  }

  async function seedDraft(content = "Alice走进了房间。\n\n她看到了Bob。\n\n一切开始改变。") {
    await getEngine().repos.draft.save(createDraft({
      au_id: auPath,
      chapter_num: 1,
      variant: "A",
      content,
    }));
  }

  beforeEach(async () => {
    vi.restoreAllMocks();
    adapter = new MockAdapter();
    initEngine(adapter, "/data");

    const fandom = await createFandom("Naruto");
    const au = await createAu(fandom.name, "Canon", fandom.path);
    auPath = au.path;

    await seedDraft();
  });

  it("marks index_status READY after incremental reindex succeeds", async () => {
    await enableEmbeddingSettings();
    const indexSpy = vi.spyOn(getEngine().ragManager, "indexChapter").mockResolvedValue(undefined);

    const result = await confirmChapter(auPath, 1, "ch0001_draft_A.md");
    const state = await getEngine().repos.state.get(auPath);

    expect(result.chapter_num).toBe(1);
    expect(indexSpy).toHaveBeenCalledOnce();
    expect(state.index_status).toBe(IndexStatus.READY);
  });

  it("keeps index_status STALE and logs when incremental reindex fails", async () => {
    await enableEmbeddingSettings();
    vi.spyOn(getEngine().ragManager, "indexChapter").mockRejectedValue(new Error("embedding offline"));
    const logSpy = vi.spyOn(engineModule, "logCatch").mockImplementation(() => {});

    const result = await confirmChapter(auPath, 1, "ch0001_draft_A.md");
    const state = await getEngine().repos.state.get(auPath);

    expect(result.chapter_num).toBe(1);
    expect(state.index_status).toBe(IndexStatus.STALE);
    expect(logSpy).toHaveBeenCalledWith(
      "rag",
      "Failed to index chapter 1 after confirm",
      expect.any(Error),
    );
  });
});
