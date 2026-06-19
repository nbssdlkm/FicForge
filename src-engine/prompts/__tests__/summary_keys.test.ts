// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect } from "vitest";
import { getPrompts } from "../index.js";

describe("summary prompt keys", () => {
  for (const lang of ["zh", "en"] as const) {
    it(`${lang} defines summary keys`, () => {
      const P = getPrompts(lang);
      expect(P.SUMMARY_STANDARD_SYSTEM.length).toBeGreaterThan(0);
      expect(P.SUMMARY_STANDARD_USER).toContain("{chapter_text}");
      expect(P.SUMMARY_STANDARD_USER).toContain("{chapter_num}");
      expect(P.RAG_LABEL_SUMMARIES.length).toBeGreaterThan(0);
    });
  }
});
