// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect, vi } from "vitest";
import { RagManager } from "../rag_manager.js";
import { JsonVectorEngine } from "../../vector/engine.js";

function memAdapter() {
  const fs = new Map<string, string>();
  return {
    async exists(p: string) { return fs.has(p); },
    async readFile(p: string) { const v = fs.get(p); if (v === undefined) throw new Error("ENOENT"); return v; },
    async writeFile(p: string, c: string) { fs.set(p, c); },
    async mkdir(_p: string) {},
    async deleteFile(p: string) { fs.delete(p); },
    async listDir() { return []; },
  } as any;
}

const emb = { embed: vi.fn(async (t: string[]) => t.map(() => [0.1, 0.2, 0.3])) } as any;

describe("RagManager.indexChapterSummary", () => {
  it("indexes the summary text into the summaries collection", async () => {
    const engine = new JsonVectorEngine(memAdapter());
    const mgr = new RagManager(engine);
    await mgr.indexChapterSummary("/au", 7, "第七章摘要", emb);

    const results = await engine.search("/au", [0.1, 0.2, 0.3], { collection: "summaries", top_k: 5, char_filter: null });
    expect(results.length).toBe(1);
    expect(results[0].content).toBe("第七章摘要");
    expect(results[0].metadata.chapter).toBe(7);
  });

  it("skips empty summary text", async () => {
    const engine = new JsonVectorEngine(memAdapter());
    const mgr = new RagManager(engine);
    await mgr.indexChapterSummary("/au", 7, "   ", emb);
    const results = await engine.search("/au", [0.1, 0.2, 0.3], { collection: "summaries", top_k: 5, char_filter: null });
    expect(results.length).toBe(0);
  });

  it("rebuildForAu indexes summaries for chapters that have them (MAJOR3)", async () => {
    const engine = new JsonVectorEngine(memAdapter());
    const mgr = new RagManager(engine);
    const chapterRepo = {
      async list_main() { return [{ chapter_num: 1 }, { chapter_num: 2 }]; },
      async get_content_only() { return "章节正文内容。"; },
    } as any;
    const summaryRepo = {
      async get(_au: string, ch: number) {
        return ch === 1
          ? { standard: { version: 1, text: "第一章摘要", generated_at: "t", source_chapter_hash: "h" } }
          : null;
      },
    } as any;

    await mgr.rebuildForAu("/au", chapterRepo, emb, null, undefined, undefined, summaryRepo);

    const results = await engine.search("/au", [0.1, 0.2, 0.3], { collection: "summaries", top_k: 5, char_filter: null });
    expect(results.map((r) => r.content)).toContain("第一章摘要");
    expect(results.length).toBe(1); // 仅 ch1 有摘要，ch2 无
  });
});
