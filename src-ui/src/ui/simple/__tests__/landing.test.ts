// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect } from "vitest";
import { getAuLandingPage } from "../landing";

describe("getAuLandingPage", () => {
  it("lands simple mode on the chat panel", () => {
    expect(getAuLandingPage("simple")).toBe("chat");
  });

  it("lands full mode on the writer (zero-churn)", () => {
    expect(getAuLandingPage("full")).toBe("writer");
  });
});
