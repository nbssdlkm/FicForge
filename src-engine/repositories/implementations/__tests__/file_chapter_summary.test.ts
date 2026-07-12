// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect } from "vitest";
import { FileChapterSummaryRepository, summaryPath } from "../file_chapter_summary.js";
import { createChapterSummary } from "../../../domain/chapter_summary.js";

// 内存 adapter（仅实现本测试用到的方法）
function memAdapter() {
  const fs = new Map<string, string>();
  return {
    files: fs,
    async exists(p: string) {
      return fs.has(p);
    },
    async readFile(p: string) {
      const v = fs.get(p);
      if (v === undefined) throw new Error("ENOENT");
      return v;
    },
    async writeFile(p: string, c: string) {
      fs.set(p, c);
    },
    async mkdir(_p: string) {},
    async deleteFile(p: string) {
      fs.delete(p);
    },
    async rename(from: string, to: string) {
      const v = fs.get(from);
      if (v === undefined) throw new Error("ENOENT");
      fs.set(to, v);
      fs.delete(from);
    },
  } as any;
}

describe("FileChapterSummaryRepository", () => {
  it("round-trips a standard summary", async () => {
    const repo = new FileChapterSummaryRepository(memAdapter());
    const s = createChapterSummary({
      standard: { version: 1, text: "第七章摘要", generated_at: "2026-06-20T00:00:00Z", source_chapter_hash: "h7" },
    });
    await repo.save("/au", 7, s);
    const got = await repo.get("/au", 7);
    expect(got?.standard?.text).toBe("第七章摘要");
    expect(got?.standard?.source_chapter_hash).toBe("h7");
  });

  it("returns null when no summary file exists", async () => {
    const repo = new FileChapterSummaryRepository(memAdapter());
    expect(await repo.get("/au", 99)).toBeNull();
  });

  it("removes a summary file", async () => {
    const repo = new FileChapterSummaryRepository(memAdapter());
    await repo.save(
      "/au",
      3,
      createChapterSummary({
        standard: { version: 1, text: "x", generated_at: "t", source_chapter_hash: "h" },
      }),
    );
    await repo.remove("/au", 3);
    expect(await repo.get("/au", 3)).toBeNull();
  });

  it("pads chapter number to 4 digits in the path", () => {
    expect(summaryPath("/au", 7)).toBe("/au/chapters/main/ch0007.summary.jsonl");
  });
});
