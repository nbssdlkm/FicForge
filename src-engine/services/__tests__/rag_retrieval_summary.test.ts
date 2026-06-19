// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect } from "vitest";
import { retrieve_rag } from "../rag_retrieval.js";

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

describe("retrieve_rag summaries", () => {
  it("retrieves summaries, excludes current-1 (already in P2), labels them", async () => {
    // current_chapter=6 → P2 注入 ch5 全文 → 排除 ch5 摘要；ch4 保留。
    const [text] = await retrieve_rag(
      fakeVectorRepo(), emb, "/au", "query", 5000, null, { mode: "api" },
      0.05, 6, "zh",
    );
    expect(text).toContain("往期章节摘要");
    expect(text).toContain("第四章摘要");
    expect(text).not.toContain("第五章摘要"); // ch5 = current-1（决策③ + codex MAJOR4）
  });
});
