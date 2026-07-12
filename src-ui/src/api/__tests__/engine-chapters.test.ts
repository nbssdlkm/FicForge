// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as engineModule from "@ficforge/engine";
import {
  chapterInflightKey,
  createDraft,
  IndexStatus,
  LLMMode,
  markChapterInflight,
  releaseChapterInflight,
} from "@ficforge/engine";
import { ApiError } from "../client";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";
import { confirmChapter, undoChapter, updateChapterContent } from "../engine-chapters";
import { createAu, createFandom } from "../engine-fandom";
import { getEngine, initEngine } from "../engine-instance";

/** 测试用确定性 embedding provider（供直接调 ragManager 种向量，不走网络）。 */
const fakeEmb = {
  embed: async (texts: string[]) => texts.map((_, i) => [1, 0, 0, i / 10]),
  get_dimension: () => 4,
  get_model_name: () => "fake-embed",
};

/** 读取持久化 index.json 里的全部 chunk id（无索引文件时返回 null）。 */
function persistedIds(adapter: MockAdapter, auPath: string): string[] | null {
  const raw = adapter.raw(`${auPath}/.vectors/index.json`);
  if (!raw) return null;
  return (JSON.parse(raw) as { chunks: { id: string }[] }).chunks.map((c) => c.id);
}

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
    await getEngine().repos.draft.save(
      createDraft({
        au_id: auPath,
        chapter_num: 1,
        variant: "A",
        content,
      }),
    );
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
    expect(logSpy).toHaveBeenCalledWith("rag", "Failed to index chapter 1 after confirm", expect.any(Error));
  });
});

describe("engine-chapters confirmChapter 在飞互斥（R1-3）", () => {
  let auPath: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    initEngine(new MockAdapter(), "/data");
    const fandom = await createFandom("Naruto");
    const au = await createAu(fandom.name, "Canon", fandom.path);
    auPath = au.path;
    await getEngine().repos.draft.save(
      createDraft({
        au_id: auPath,
        chapter_num: 1,
        variant: "A",
        content: "Alice走进了房间。\n\n她看到了Bob。",
      }),
    );
  });

  it("该章生成在飞（写文/对话任一路径）→ confirm 拒绝，带专用 error code，不动在飞流", async () => {
    const key = chapterInflightKey(auPath, 1);
    markChapterInflight(key, "dispatch");
    try {
      const err = await confirmChapter(auPath, 1, "ch0001_draft_A.md").then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).errorCode).toBe("CHAPTER_GENERATION_IN_FLIGHT");
      // 章节未被写入（confirm 在动手前就被拦下）
      await expect(getEngine().repos.chapter.exists(auPath, 1)).resolves.toBe(false);
    } finally {
      releaseChapterInflight(key);
    }
  });

  it("释放在飞标记后重试 → confirm 正常通过", async () => {
    const key = chapterInflightKey(auPath, 1);
    markChapterInflight(key, "generate");
    await expect(confirmChapter(auPath, 1, "ch0001_draft_A.md")).rejects.toBeInstanceOf(ApiError);

    releaseChapterInflight(key);
    const result = await confirmChapter(auPath, 1, "ch0001_draft_A.md");
    expect(result.chapter_num).toBe(1);
    await expect(getEngine().repos.chapter.exists(auPath, 1)).resolves.toBe(true);
  });

  it("别的章在飞不影响本章 confirm（互斥粒度 = au+chapter）", async () => {
    const otherKey = chapterInflightKey(auPath, 2);
    markChapterInflight(otherKey, "generate");
    try {
      const result = await confirmChapter(auPath, 1, "ch0001_draft_A.md");
      expect(result.chapter_num).toBe(1);
    } finally {
      releaseChapterInflight(otherKey);
    }
  });
});

describe("engine-chapters undoChapter 向量清理（H9a）", () => {
  let adapter: MockAdapter;
  let auPath: string;

  beforeEach(async () => {
    vi.restoreAllMocks();
    adapter = new MockAdapter();
    initEngine(adapter, "/data");
    const fandom = await createFandom("Naruto");
    const au = await createAu(fandom.name, "Canon", fandom.path);
    auPath = au.path;
    // embedding 未配 → confirm 不触发索引，向量由测试手动种入
    await getEngine().repos.draft.save(
      createDraft({
        au_id: auPath,
        chapter_num: 1,
        variant: "A",
        content: "Alice走进了房间。\n\n她看到了Bob。\n\n一切开始改变。",
      }),
    );
    await confirmChapter(auPath, 1, "ch0001_draft_A.md");
  });

  it("undo 删除该章正文 chunks + sum{N}（内存 + 落盘 + 冷启动重载不复活），undo 前 READY → 恢复 READY", async () => {
    const e = getEngine();
    await e.ragManager.indexChapter(auPath, 1, "第一章正文。足够长的文本以生成chunk数据用于测试。", fakeEmb);
    await e.ragManager.indexChapterSummary(auPath, 1, "第一章摘要。", fakeEmb);
    expect(e.ragManager.chunkCountFor(auPath)).toBeGreaterThan(0);
    await e.repos.state.update(auPath, (st) => {
      st.index_status = IndexStatus.READY;
    });

    const result = await undoChapter(auPath);
    expect(result.chapter_num).toBe(1);

    // 内存已清
    expect(e.ragManager.chunkCountFor(auPath)).toBe(0);
    // 落盘已清（index.json 不再引用 ch1_* / sum1）
    const ids = persistedIds(adapter, auPath)!;
    expect(ids.some((id) => id.startsWith("ch1_") || id === "sum1")).toBe(false);
    // 冷启动重载（rebuild-from-disk）后依然不在
    e.ragManager.unload();
    await e.ragManager.ensureLoaded(auPath);
    expect(e.ragManager.chunkCountFor(auPath)).toBe(0);
    // 删除不需要 embedding、已成功 → 恢复 undo 前的 READY
    const st = await e.repos.state.get(auPath);
    expect(st.index_status).toBe(IndexStatus.READY);
  });

  it("undo 前是 STALE → 删除成功也保持 STALE（不掩盖既有降级）", async () => {
    const e = getEngine();
    await e.ragManager.indexChapter(auPath, 1, "第一章正文。足够长的文本以生成chunk数据用于测试。", fakeEmb);
    // 不设 READY —— confirm 后默认仍是 STALE（embedding 未配）

    await undoChapter(auPath);

    expect(e.ragManager.chunkCountFor(auPath)).toBe(0);
    const st = await e.repos.state.get(auPath);
    expect(st.index_status).toBe(IndexStatus.STALE);
  });

  it("向量删除失败 → 保持 undo 服务置下的 STALE 并记录日志，undo 本身不受影响", async () => {
    const e = getEngine();
    await e.repos.state.update(auPath, (st) => {
      st.index_status = IndexStatus.READY;
    });
    vi.spyOn(e.ragManager, "removeChapter").mockRejectedValue(new Error("disk error"));
    const logSpy = vi.spyOn(engineModule, "logCatch").mockImplementation(() => {});

    const result = await undoChapter(auPath);

    expect(result.chapter_num).toBe(1);
    const st = await e.repos.state.get(auPath);
    expect(st.index_status).toBe(IndexStatus.STALE);
    expect(logSpy).toHaveBeenCalledWith("rag", "Failed to remove vectors after undo 1", expect.any(Error));
  });
});

describe("engine-chapters updateChapterContent 向量刷新（H9b）", () => {
  let adapter: MockAdapter;
  let auPath: string;

  async function enableEmbeddingSettings() {
    const settings = await getEngine().repos.settings.get();
    settings.embedding.api_base = "https://embed.example.com/v1";
    settings.embedding.api_key = "embed-secret";
    settings.embedding.model = "embed-test";
    await getEngine().repos.settings.save(settings);
  }

  beforeEach(async () => {
    vi.restoreAllMocks();
    adapter = new MockAdapter();
    initEngine(adapter, "/data");
    const fandom = await createFandom("Naruto");
    const au = await createAu(fandom.name, "Canon", fandom.path);
    auPath = au.path;
    await getEngine().repos.draft.save(
      createDraft({
        au_id: auPath,
        chapter_num: 1,
        variant: "A",
        content: "Alice走进了房间。\n\n她看到了Bob。\n\n一切开始改变。",
      }),
    );
    // embedding 未配 → confirm 不触发索引；向量由测试手动种入旧内容
    await confirmChapter(auPath, 1, "ch0001_draft_A.md");
    await getEngine().ragManager.indexChapter(
      auPath,
      1,
      "旧的第一章正文。足够长的文本以生成chunk数据用于测试。",
      fakeEmb,
    );
    await getEngine().ragManager.indexChapterSummary(auPath, 1, "旧的第一章摘要。", fakeEmb);
  });

  it("embedding 可用：旧 chunk + sum{N} 删除、新正文走增量重索引、编辑前 READY → 不留 STALE", async () => {
    const e = getEngine();
    await e.repos.state.update(auPath, (st) => {
      st.index_status = IndexStatus.READY;
    });
    await enableEmbeddingSettings();
    const indexSpy = vi.spyOn(e.ragManager, "indexChapter").mockResolvedValue(undefined);

    await updateChapterContent(auPath, 1, "全新的第一章正文内容。");

    // 旧向量内存 + 落盘双清（removeChapter 真跑）
    expect(e.ragManager.chunkCountFor(auPath)).toBe(0);
    const ids = persistedIds(adapter, auPath)!;
    expect(ids.some((id) => id.startsWith("ch1_") || id === "sum1")).toBe(false);
    // 新正文走 confirm 同款增量索引路径（内容取落盘后的正文）
    expect(indexSpy).toHaveBeenCalledOnce();
    const [calledAu, calledNum, calledContent] = indexSpy.mock.calls[0];
    expect(calledAu).toBe(auPath);
    expect(calledNum).toBe(1);
    expect(calledContent).toContain("全新的第一章正文内容");
    // 编辑前 READY + 重索引成功 → 恢复 READY（不再悬空 STALE）
    const st = await e.repos.state.get(auPath);
    expect(st.index_status).toBe(IndexStatus.READY);
  });

  it("embedding 不可用：旧 chunk + sum{N} 删除后保持 STALE（宁缺勿旧）", async () => {
    const e = getEngine();
    await e.repos.state.update(auPath, (st) => {
      st.index_status = IndexStatus.READY;
    });
    // 不配 embedding

    await updateChapterContent(auPath, 1, "另一个新内容。");

    expect(e.ragManager.chunkCountFor(auPath)).toBe(0);
    const ids = persistedIds(adapter, auPath)!;
    expect(ids.some((id) => id.startsWith("ch1_") || id === "sum1")).toBe(false);
    const st = await e.repos.state.get(auPath);
    expect(st.index_status).toBe(IndexStatus.STALE);
  });

  it("编辑前已是 STALE：重索引成功也保持 STALE（不掩盖既有降级）", async () => {
    const e = getEngine();
    // index_status 保持默认 STALE
    await enableEmbeddingSettings();
    vi.spyOn(e.ragManager, "indexChapter").mockResolvedValue(undefined);

    await updateChapterContent(auPath, 1, "又一个新内容。");

    const st = await e.repos.state.get(auPath);
    expect(st.index_status).toBe(IndexStatus.STALE);
  });
});

describe("engine-chapters confirm READY 升级门控（M1a）", () => {
  let adapter: MockAdapter;
  let auPath: string;

  async function enableEmbeddingSettings() {
    const settings = await getEngine().repos.settings.get();
    settings.embedding.api_base = "https://embed.example.com/v1";
    settings.embedding.api_key = "embed-secret";
    settings.embedding.model = "embed-test";
    await getEngine().repos.settings.save(settings);
  }

  async function seedDraft(chapterNum: number) {
    await getEngine().repos.draft.save(
      createDraft({
        au_id: auPath,
        chapter_num: chapterNum,
        variant: "A",
        content: `第 ${chapterNum} 章正文。Alice 在场。`,
      }),
    );
  }

  beforeEach(async () => {
    vi.restoreAllMocks();
    adapter = new MockAdapter();
    initEngine(adapter, "/data");
    const fandom = await createFandom("Naruto");
    const au = await createAu(fandom.name, "Canon", fandom.path);
    auPath = au.path;
    await enableEmbeddingSettings();
    vi.spyOn(getEngine().ragManager, "indexChapter").mockResolvedValue(undefined);
  });

  it("首章 confirm（此前零章）→ READY（索引天然完整，新 AU 不卡 STALE）", async () => {
    await seedDraft(1);
    await confirmChapter(auPath, 1, "ch0001_draft_A.md");
    const st = await getEngine().repos.state.get(auPath);
    expect(st.index_status).toBe(IndexStatus.READY);
  });

  it("confirm 前 READY → confirm 后仍 READY", async () => {
    await seedDraft(1);
    await confirmChapter(auPath, 1, "ch0001_draft_A.md");
    await seedDraft(2);
    await confirmChapter(auPath, 2, "ch0002_draft_A.md");
    const st = await getEngine().repos.state.get(auPath);
    expect(st.index_status).toBe(IndexStatus.READY);
  });

  it("confirm 前 STALE（如编辑未重索引 / backfill 半成功）→ 增量索引成功也保持 STALE", async () => {
    await seedDraft(1);
    await confirmChapter(auPath, 1, "ch0001_draft_A.md");
    // 模拟既有降级（单 bit 无法区分成因，保守保留提示）
    await getEngine().repos.state.update(auPath, (st) => {
      st.index_status = IndexStatus.STALE;
    });

    await seedDraft(2);
    await confirmChapter(auPath, 2, "ch0002_draft_A.md");

    const st = await getEngine().repos.state.get(auPath);
    expect(st.index_status).toBe(IndexStatus.STALE);
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

  beforeEach(async () => {
    vi.restoreAllMocks();
    adapter = new MockAdapter();
    initEngine(adapter, "/data");
    const fandom = await createFandom("Naruto");
    const au = await createAu(fandom.name, "Canon", fandom.path);
    auPath = au.path;
    await getEngine().repos.draft.save(
      createDraft({
        au_id: auPath,
        chapter_num: 1,
        variant: "A",
        content: "Alice走进了房间。\n\n她看到了Bob。\n\n一切开始改变。",
      }),
    );
  });

  it("confirmChapter 生成 standard 摘要（无写作模式 gate，只受 embedding+LLM 约束）", async () => {
    await enableEmbeddingSettings();
    await enableLLM();

    vi.spyOn(getEngine().ragManager, "indexChapter").mockResolvedValue(undefined);
    const genSpy = vi.spyOn(engineModule, "generate_standard_summary").mockResolvedValue("章节摘要文本");
    vi.spyOn(engineModule, "generate_micro_summary").mockResolvedValue("微摘要");
    const persistSpy = vi.spyOn(engineModule, "persist_chapter_summary").mockResolvedValue(undefined);

    await confirmChapter(auPath, 1, "ch0001_draft_A.md");

    // 融合后：写作模式 gate（及 writing_mode 字段）已退役，摘要只受 embedding+LLM 约束。
    expect(genSpy).toHaveBeenCalledOnce();
    expect(persistSpy).toHaveBeenCalledOnce();
  });

  it("confirmChapter 回顾(M10-A) 无写作模式 gate：触发条件满足时仍执行", async () => {
    await enableEmbeddingSettings();
    await enableLLM();

    vi.spyOn(getEngine().ragManager, "indexChapter").mockResolvedValue(undefined);
    // 摘要块也会跑（同 gate），spy 掉避免真 LLM/embed；返回空 → 不落盘。
    vi.spyOn(engineModule, "generate_standard_summary").mockResolvedValue("");
    vi.spyOn(engineModule, "generate_micro_summary").mockResolvedValue("");
    // 强制回顾触发，免去 seed RETROSPECTIVE_INTERVAL 章；返 null → 不进 commit 阶段。
    vi.spyOn(engineModule, "should_run_retrospective").mockReturnValue(true);
    const retroSpy = vi.spyOn(engineModule, "generate_retrospective").mockResolvedValue(null);

    await confirmChapter(auPath, 1, "ch0001_draft_A.md");

    // 融合后：写作模式 gate 已退役，should_run_retrospective=true + embedding+LLM 就位 → 回顾执行。
    expect(retroSpy).toHaveBeenCalledOnce();
  });
});

describe("engine-chapters 回顾 Phase2 CAS 比对 content_hash（审计⑤）", () => {
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
  async function confirmN(n: number) {
    for (let i = 1; i <= n; i++) {
      await getEngine().repos.draft.save(
        createDraft({
          au_id: auPath,
          chapter_num: i,
          variant: "A",
          content: `第 ${i} 章正文。Alice 在场。`,
        }),
      );
      await confirmChapter(auPath, i, `ch${String(i).padStart(4, "0")}_draft_A.md`);
    }
  }

  beforeEach(async () => {
    vi.restoreAllMocks();
    adapter = new MockAdapter();
    initEngine(adapter, "/data");
    const fandom = await createFandom("Naruto");
    const au = await createAu(fandom.name, "Canon", fandom.path);
    auPath = au.path;
    await enableEmbeddingSettings();
    await enableLLM();
    // 摘要与索引全 spy 掉，避免真 LLM/embed；回顾在 ch1-9 real should_run_retrospective=false 不触发。
    vi.spyOn(getEngine().ragManager, "indexChapter").mockResolvedValue(undefined);
    vi.spyOn(engineModule, "generate_standard_summary").mockResolvedValue("");
    vi.spyOn(engineModule, "generate_micro_summary").mockResolvedValue("");
  });

  it("content_hash 与 Phase1 不一致（历史章被编辑）→ 跳过 commit_retrospective", async () => {
    await confirmN(9); // ch5 存在（回顾 target = 10-5）
    vi.spyOn(engineModule, "should_run_retrospective").mockReturnValue(true);
    vi.spyOn(engineModule, "generate_retrospective").mockResolvedValue({
      v2Text: "v2 文本",
      contentHash: "STALE_MISMATCH", // 模拟 Phase1 读取后章节被编辑、hash 已变
    });
    const commitSpy = vi.spyOn(engineModule, "commit_retrospective").mockResolvedValue(undefined);

    await getEngine().repos.draft.save(
      createDraft({ au_id: auPath, chapter_num: 10, variant: "A", content: "第 10 章。" }),
    );
    await confirmChapter(auPath, 10, "ch0010_draft_A.md");

    // CAS 检出 hash 不一致 → 不提交（不会用旧内容重建 ch5 摘要 + 污染向量）
    expect(commitSpy).not.toHaveBeenCalled();
  });

  it("content_hash 与 Phase1 一致（未编辑）→ 提交 commit_retrospective 一次", async () => {
    await confirmN(9);
    const ch5 = await getEngine().repos.chapter.get(auPath, 5);
    vi.spyOn(engineModule, "should_run_retrospective").mockReturnValue(true);
    vi.spyOn(engineModule, "generate_retrospective").mockResolvedValue({
      v2Text: "v2 文本",
      contentHash: ch5.content_hash, // Phase1 读到的 hash 与锁内一致
    });
    const commitSpy = vi.spyOn(engineModule, "commit_retrospective").mockResolvedValue(undefined);

    await getEngine().repos.draft.save(
      createDraft({ au_id: auPath, chapter_num: 10, variant: "A", content: "第 10 章。" }),
    );
    await confirmChapter(auPath, 10, "ch0010_draft_A.md");

    expect(commitSpy).toHaveBeenCalledOnce();
  });
});
