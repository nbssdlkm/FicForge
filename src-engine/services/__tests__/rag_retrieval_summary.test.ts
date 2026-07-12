// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect } from "vitest";
import { retrieveRag } from "../rag_retrieval.js";

// 假 vector repo：summaries 返回 ch4 + ch5；其余 collection 空。
function fakeVectorRepo() {
  return {
    async search(_au: string, _q: number[], opts: any) {
      if (opts.collection === "summaries") {
        return [
          { content: "第四章摘要", chapter_num: 4, score: 0.9, metadata: { chapter: 4 } },
          { content: "第五章摘要", chapter_num: 5, score: 0.95, metadata: { chapter: 5 } },
        ];
      }
      return [];
    },
  } as any;
}
const emb = { embed: async (t: string[]) => t.map(() => [0.1, 0.2]) } as any;

describe("retrieveRag summaries", () => {
  it("retrieves summaries, excludes current-1 (already in P2), labels them", async () => {
    // current_chapter=6 → P2 注入 ch5 全文 → 排除 ch5 摘要；ch4 保留。
    const [text] = await retrieveRag(fakeVectorRepo(), emb, "/au", "query", 5000, null, { mode: "api" }, 0.05, 6, "zh");
    expect(text).toContain("往期章节摘要");
    expect(text).toContain("第四章摘要");
    expect(text).not.toContain("第五章摘要"); // ch5 = current-1（决策③ + codex MAJOR4）
  });

  it("摘要按衰减后分数排序，而非原始 cosine（codex 对抗审）", async () => {
    // current=50：ch2 原始 0.95 但衰减重；ch48 原始 0.90 但衰减轻 → 排序后 ch48 在前。
    const repo = {
      async search(_au: string, _q: number[], opts: any) {
        if (opts.collection === "summaries") {
          return [
            { content: "ch2sum", chapter_num: 2, score: 0.95, metadata: { chapter: 2 } },
            { content: "ch48sum", chapter_num: 48, score: 0.9, metadata: { chapter: 48 } },
          ];
        }
        return [];
      },
    } as any;
    const [text] = await retrieveRag(repo, emb, "/au", "q", 100000, null, { mode: "api" }, 0.05, 50, "zh");
    const i48 = text.indexOf("ch48sum");
    const i2 = text.indexOf("ch2sum");
    expect(i48).toBeGreaterThanOrEqual(0);
    expect(i2).toBeGreaterThanOrEqual(0);
    expect(i48).toBeLessThan(i2); // ch48 衰减后更高 → 排在前
  });

  it("summaries 检索传 null char_filter，避免每次双查（codex workflow 审）", async () => {
    let summariesCalls = 0;
    let lastCharFilter: unknown = "unset";
    const repo = {
      async search(_au: string, _q: number[], opts: any) {
        if (opts.collection === "summaries") {
          summariesCalls++;
          lastCharFilter = opts.char_filter;
          return [{ content: "s1", chapter_num: 1, score: 0.9, metadata: { chapter: 1 } }];
        }
        return [];
      },
    } as any;
    // 即便 retrieveRag 收到 char_filter ["张三"]，summaries 仍走 null（单查、不触发兜底双查）
    await retrieveRag(repo, emb, "/au", "q", 100000, ["张三"], { mode: "api" }, 0.05, 50, "zh");
    expect(summariesCalls).toBe(1);
    expect(lastCharFilter).toBeNull();
  });
});
