// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect } from "vitest";
import { createChapterSummary } from "../chapter_summary.js";

describe("createChapterSummary", () => {
  it("builds a standard tier with provided fields", () => {
    const s = createChapterSummary({
      standard: { version: 1, text: "摘要", generated_at: "2026-06-20T00:00:00Z", source_chapter_hash: "abc" },
    });
    expect(s.standard?.text).toBe("摘要");
    expect(s.standard?.version).toBe(1);
    expect(s.standard?.source_chapter_hash).toBe("abc");
  });

  it("defaults standard to null when absent", () => {
    expect(createChapterSummary({}).standard).toBeNull();
  });
});
