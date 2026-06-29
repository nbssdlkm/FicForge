// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as engineModule from "@ficforge/engine";
import { createDraft, IndexStatus, LLMMode } from "@ficforge/engine";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";
import { confirmChapter, countChaptersMissingSummary, backfillChapterSummaries } from "../engine-chapters";
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

describe("engine-chapters 章节摘要不再受 writing_mode gate（融合 P1.4）", () => {
  let adapter: MockAdapter;
  let auPath: string;

  async function enableEmbeddingSettings() {
    const settings = await getEngine().repos.settings.get();
    settings.embedding.api_base = "https://embed.example.com/v1";
    settings.embedding.api_key = "embed-secret";
    settings.embedding.model = "embed-test";
    await getEngine().repos.settings.save(settings);
  }

  async function enableLLM() {
    const proj = await getEngine().repos.project.get(auPath);
    proj.llm.mode = LLMMode.API;
    proj.llm.model = "gpt-test";
    proj.llm.api_base = "https://llm.example.com/v1";
    proj.llm.api_key = "llm-secret";
    await getEngine().repos.project.save(proj);
  }

  async function setSimpleMode() {
    const sett = await getEngine().repos.settings.get();
    sett.app.writing_mode = "simple";
    await getEngine().repos.settings.save(sett);
  }

  beforeEach(async () => {
    vi.restoreAllMocks();
    adapter = new MockAdapter();
    initEngine(adapter, "/data");
    const fandom = await createFandom("Naruto");
    const au = await createAu(fandom.name, "Canon", fandom.path);
    auPath = au.path;
    await getEngine().repos.draft.save(createDraft({
      au_id: auPath, chapter_num: 1, variant: "A",
      content: "Alice走进了房间。\n\n她看到了Bob。\n\n一切开始改变。",
    }));
  });

  it("confirmChapter 在 writing_mode=simple 下仍生成 standard 摘要（gate 已删，只受 embedding+LLM 约束）", async () => {
    await enableEmbeddingSettings();
    await enableLLM();
    await setSimpleMode();

    vi.spyOn(getEngine().ragManager, "indexChapter").mockResolvedValue(undefined);
    const genSpy = vi.spyOn(engineModule, "generate_standard_summary").mockResolvedValue("章节摘要文本");
    vi.spyOn(engineModule, "generate_micro_summary").mockResolvedValue("微摘要");
    const persistSpy = vi.spyOn(engineModule, "persist_chapter_summary").mockResolvedValue(undefined);

    await confirmChapter(auPath, 1, "ch0001_draft_A.md");

    // 旧逻辑：writing_mode=simple → disableChapterSummary → 整段跳过 → genSpy 不被调用。
    // 融合后：无 mode gate，simple 也走摘要（embedding+LLM 已就位）。
    expect(genSpy).toHaveBeenCalledOnce();
    expect(persistSpy).toHaveBeenCalledOnce();
  });

  it("confirmChapter 在 writing_mode=simple 下回顾(M10-A) gate 也已删：触发条件满足时仍执行", async () => {
    await enableEmbeddingSettings();
    await enableLLM();
    await setSimpleMode();

    vi.spyOn(getEngine().ragManager, "indexChapter").mockResolvedValue(undefined);
    // 摘要块也会跑（同 gate），spy 掉避免真 LLM/embed；返回空 → 不落盘。
    vi.spyOn(engineModule, "generate_standard_summary").mockResolvedValue("");
    vi.spyOn(engineModule, "generate_micro_summary").mockResolvedValue("");
    // 强制回顾触发，免去 seed RETROSPECTIVE_INTERVAL 章；返 null → 不进 commit 阶段。
    vi.spyOn(engineModule, "shouldRunRetrospective").mockReturnValue(true);
    const retroSpy = vi.spyOn(engineModule, "generate_retrospective").mockResolvedValue(null);

    await confirmChapter(auPath, 1, "ch0001_draft_A.md");

    // 旧逻辑：simple → disableChapterSummary → 回顾块整段跳过 → retroSpy 不被调。
    // 融合后：gate 删，shouldRunRetrospective=true + embedding+LLM 就位 → 回顾执行。
    expect(retroSpy).toHaveBeenCalledOnce();
  });

  it("countChaptersMissingSummary 在 simple 模式返回 summaryDisabled=false（gate 已删）", async () => {
    await setSimpleMode();
    const avail = await countChaptersMissingSummary(auPath);
    expect(avail.summaryDisabled).toBe(false);
  });

  it("backfillChapterSummaries 在 simple 模式不再抛 writing-mode 禁用错误（只受 embedding+LLM 前置约束）", async () => {
    await setSimpleMode();
    // 未配 embedding/LLM：删 gate 后应抛"需配 embedding+LLM"而非"writing mode 禁用"。
    await expect(backfillChapterSummaries(auPath)).rejects.toThrow(/embedding and LLM must be configured/);
  });
});
