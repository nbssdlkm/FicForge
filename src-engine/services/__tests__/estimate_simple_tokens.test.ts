// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, expect, it } from "vitest";
import { estimate_simple_context_tokens } from "../estimate_simple_tokens.js";
import { createProject } from "../../domain/project.js";
import { createState } from "../../domain/state.js";
import { createChapter } from "../../domain/chapter.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";

async function seedChapter(repo: FileChapterRepository, au: string, n: number, content: string) {
  await repo.save(createChapter({
    au_id: au, chapter_num: n, content,
    chapter_id: `ch-${n}`, revision: 1,
    confirmed_at: "2026-05-03T00:00:00Z",
    content_hash: "x", provenance: "ai", generated_with: null,
  }));
}

describe("estimate_simple_context_tokens", () => {
  it("空 AU 返回小但非零的 tokens（system prompt）", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    const project = createProject({ project_id: "p", au_id: "au_e" });
    const state = createState({ au_id: "au_e", current_chapter: 1 });

    const r = await estimate_simple_context_tokens({
      au_id: "au_e", project, state, chapter_repo: chapterRepo, adapter, language: "zh",
    });
    expect(r.inputTokens).toBeGreaterThan(0);
    expect(r.contextWindow).toBeGreaterThan(0);
    expect(r.maxOutput).toBeGreaterThan(0);
    expect(r.level).toBe("normal");
  });

  it("有 5 章 + 设定时 inputTokens 增长", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    const project = createProject({ project_id: "p", au_id: "au_b" });
    const state = createState({ au_id: "au_b", current_chapter: 6 });
    for (let i = 1; i <= 5; i++) {
      await seedChapter(chapterRepo, "au_b", i, `第 ${i} 章正文，长度大约一两百字。`.repeat(50));
    }
    await adapter.mkdir("au_b/characters");
    await adapter.writeFile("au_b/characters/Alice.md", "# Alice\n红发剑客。".repeat(20));

    const empty = await estimate_simple_context_tokens({
      au_id: "au_b", project, state: createState({ au_id: "au_b" }),
      chapter_repo: new FileChapterRepository(new MockAdapter()), adapter: new MockAdapter(), language: "zh",
    });
    const populated = await estimate_simple_context_tokens({
      au_id: "au_b", project, state, chapter_repo: chapterRepo, adapter, language: "zh",
    });

    expect(populated.inputTokens).toBeGreaterThan(empty.inputTokens);
    expect(populated.ratio).toBeGreaterThanOrEqual(0);
  });

  it("level 分档：< 80% normal / ≥ 80% warn / ≥ 100% over", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    // 强制小 contextWindow + 大量章节，让 ratio 超 80%
    const project = createProject({
      project_id: "p", au_id: "au_w",
      llm: { mode: "api" as never, model: "", api_base: "", api_key: "", local_model_path: "", ollama_model: "", context_window: 200 },
    });
    const state = createState({ au_id: "au_w", current_chapter: 3 });
    await seedChapter(chapterRepo, "au_w", 1, "x".repeat(2000));
    await seedChapter(chapterRepo, "au_w", 2, "y".repeat(2000));

    const r = await estimate_simple_context_tokens({
      au_id: "au_w", project, state, chapter_repo: chapterRepo, adapter, language: "zh",
    });
    expect(["warn", "over"]).toContain(r.level);
    expect(r.ratio).toBeGreaterThanOrEqual(0.8);
  });

  it("history 参数为空数组等同于不传：inputTokens 不变", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    const project = createProject({ project_id: "p", au_id: "au_h" });
    const state = createState({ au_id: "au_h", current_chapter: 1 });

    const r1 = await estimate_simple_context_tokens({
      au_id: "au_h", project, state, chapter_repo: chapterRepo, adapter, language: "zh",
    });
    const r2 = await estimate_simple_context_tokens({
      au_id: "au_h", project, state, chapter_repo: chapterRepo, adapter, language: "zh",
      history: [],
    });

    expect(r2.inputTokens).toBe(r1.inputTokens);
  });

  it("传 history 时 inputTokens 增长（粗略验证 history token 加上去）", async () => {
    const adapter = new MockAdapter();
    const chapterRepo = new FileChapterRepository(adapter);
    const project = createProject({ project_id: "p", au_id: "au_h2" });
    const state = createState({ au_id: "au_h2", current_chapter: 1 });

    const empty = await estimate_simple_context_tokens({
      au_id: "au_h2", project, state, chapter_repo: chapterRepo, adapter, language: "zh",
    });
    const populated = await estimate_simple_context_tokens({
      au_id: "au_h2", project, state, chapter_repo: chapterRepo, adapter, language: "zh",
      history: [
        { role: "user", content: "前一轮用户问题".repeat(20) },
        { role: "assistant", content: "前一轮 AI 回答正文".repeat(50) },
      ],
    });

    expect(populated.inputTokens).toBeGreaterThan(empty.inputTokens);
    expect(populated.inputTokens).toBeGreaterThan(empty.inputTokens + 100);
  });
});
