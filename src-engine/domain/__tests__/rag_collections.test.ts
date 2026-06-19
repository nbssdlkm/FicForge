// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect } from "vitest";
import { RAG_COLLECTIONS } from "../context_summary.js";

describe("RAG_COLLECTIONS", () => {
  it("includes the summaries collection", () => {
    expect(RAG_COLLECTIONS).toContain("summaries");
  });

  it("keeps the existing collections", () => {
    expect(RAG_COLLECTIONS).toContain("chapters");
    expect(RAG_COLLECTIONS).toContain("characters");
    expect(RAG_COLLECTIONS).toContain("worldbuilding");
  });
});
