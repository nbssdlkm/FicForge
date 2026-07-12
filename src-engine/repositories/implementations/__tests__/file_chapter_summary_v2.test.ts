// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Tests for FileChapterSummaryRepository update_micro / promote_to_v2 (M10-A).
 * TDD: written before implementation.
 */

import { describe, it, expect } from "vitest";
import { FileChapterSummaryRepository } from "../file_chapter_summary.js";
import { createChapterSummary } from "../../../domain/chapter_summary.js";

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

const BASE_STANDARD = {
  version: 1,
  text: "第七章标准摘要",
  generated_at: "2026-06-20T00:00:00Z",
  source_chapter_hash: "h7",
};

describe("FileChapterSummaryRepository.update_micro", () => {
  it("writes micro when no prior summary exists (creates file from scratch)", async () => {
    const repo = new FileChapterSummaryRepository(memAdapter());
    await repo.update_micro("/au", 7, "主角决裂，转折。", "h7");
    const got = await repo.get("/au", 7);
    expect(got?.micro?.text).toBe("主角决裂，转折。");
    expect(got?.micro?.version).toBe(1);
    expect(got?.micro?.source_chapter_hash).toBe("h7");
    expect(got?.standard).toBeNull();
  });

  it("merges micro into existing summary without touching standard", async () => {
    const repo = new FileChapterSummaryRepository(memAdapter());
    const s = createChapterSummary({ standard: BASE_STANDARD });
    await repo.save("/au", 7, s);

    await repo.update_micro("/au", 7, "micro text", "h7");

    const got = await repo.get("/au", 7);
    expect(got?.standard?.text).toBe("第七章标准摘要");
    expect(got?.micro?.text).toBe("micro text");
  });

  it("is idempotent: overwriting micro with same text is safe", async () => {
    const repo = new FileChapterSummaryRepository(memAdapter());
    await repo.update_micro("/au", 7, "first micro", "h7");
    await repo.update_micro("/au", 7, "second micro", "h7");
    const got = await repo.get("/au", 7);
    expect(got?.micro?.text).toBe("second micro");
  });
});

describe("FileChapterSummaryRepository.promote_to_v2", () => {
  it("backs up standard → standard_v1 and writes new standard version:2", async () => {
    const repo = new FileChapterSummaryRepository(memAdapter());
    const s = createChapterSummary({ standard: BASE_STANDARD });
    await repo.save("/au", 7, s);

    await repo.promote_to_v2("/au", 7, "后见之明v2摘要", "h7");

    const got = await repo.get("/au", 7);
    // standard is now v2
    expect(got?.standard?.version).toBe(2);
    expect(got?.standard?.text).toBe("后见之明v2摘要");
    // standard_v1 preserves original
    expect(got?.standard_v1?.version).toBe(1);
    expect(got?.standard_v1?.text).toBe("第七章标准摘要");
  });

  it("is idempotent on standard_v1: does NOT overwrite standard_v1 if already present", async () => {
    const repo = new FileChapterSummaryRepository(memAdapter());
    const s = createChapterSummary({ standard: BASE_STANDARD });
    await repo.save("/au", 7, s);
    // first promote
    await repo.promote_to_v2("/au", 7, "v2-first", "h7");
    // second promote (v2 → v3 scenario, but v1 must not be overwritten)
    await repo.promote_to_v2("/au", 7, "v2-second", "h7");

    const got = await repo.get("/au", 7);
    // standard_v1 still holds the original (version:1)
    expect(got?.standard_v1?.text).toBe("第七章标准摘要");
    // standard is updated to latest v2 text
    expect(got?.standard?.text).toBe("v2-second");
  });

  it("preserves micro when promoting to v2", async () => {
    const repo = new FileChapterSummaryRepository(memAdapter());
    const s = createChapterSummary({ standard: BASE_STANDARD });
    await repo.save("/au", 7, s);
    await repo.update_micro("/au", 7, "micro text", "h7");

    await repo.promote_to_v2("/au", 7, "v2 text", "h7");

    const got = await repo.get("/au", 7);
    expect(got?.micro?.text).toBe("micro text");
    expect(got?.standard?.text).toBe("v2 text");
    expect(got?.standard_v1?.text).toBe("第七章标准摘要");
  });

  it("skips promote_to_v2 gracefully if no current standard exists", async () => {
    // If there's no existing standard, v1 backup is null, we just write v2 as standard
    const repo = new FileChapterSummaryRepository(memAdapter());
    await repo.promote_to_v2("/au", 7, "v2 from empty", "h7");
    const got = await repo.get("/au", 7);
    expect(got?.standard?.text).toBe("v2 from empty");
    expect(got?.standard_v1).toBeUndefined();
  });
});

describe("createChapterSummary round-trip with new fields", () => {
  it("round-trips micro and standard_v1 from disk (no field loss)", async () => {
    const repo = new FileChapterSummaryRepository(memAdapter());
    const s = createChapterSummary({
      standard: BASE_STANDARD,
      micro: { version: 1, text: "micro", generated_at: "t", source_chapter_hash: "h" },
      standard_v1: { version: 1, text: "v1 backup", generated_at: "t", source_chapter_hash: "h" },
    });
    await repo.save("/au", 1, s);
    const got = await repo.get("/au", 1);
    expect(got?.micro?.text).toBe("micro");
    expect(got?.standard_v1?.text).toBe("v1 backup");
    expect(got?.standard?.text).toBe(BASE_STANDARD.text);
  });

  it("old file without micro/standard_v1 returns null/undefined for those fields", async () => {
    const adapter = memAdapter();
    // Write a legacy file with only standard
    const path = "/au/chapters/main/ch0001.summary.jsonl";
    adapter.files.set(path, JSON.stringify({ standard: BASE_STANDARD }));
    const repo = new FileChapterSummaryRepository(adapter);
    const got = await repo.get("/au", 1);
    expect(got?.standard?.text).toBe("第七章标准摘要");
    expect(got?.micro).toBeNull();
    expect(got?.standard_v1).toBeUndefined();
  });
});
