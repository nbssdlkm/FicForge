// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Tests for micro summary generation (M10-A).
 * TDD: written before implementation.
 */

import { describe, it, expect, vi } from "vitest";
import { generateMicroSummary } from "../chapter_summary.js";

function fakeProvider(reply: string) {
  return { generate: vi.fn(async () => ({ content: reply })) } as any;
}

describe("generateMicroSummary", () => {
  it("returns trimmed LLM text", async () => {
    const p = fakeProvider("  主角与师父决裂，故事转折。  ");
    const out = await generateMicroSummary("第七章正文……", 7, p);
    expect(out).toBe("主角与师父决裂，故事转折。");
    expect(p.generate).toHaveBeenCalledOnce();
  });

  it("returns null on empty chapter without calling LLM", async () => {
    const p = fakeProvider("x");
    expect(await generateMicroSummary("   ", 7, p)).toBeNull();
    expect(p.generate).not.toHaveBeenCalled();
  });

  it("returns null when LLM throws (degrade, no throw)", async () => {
    const p = {
      generate: vi.fn(async () => {
        throw new Error("network");
      }),
    } as any;
    expect(await generateMicroSummary("正文", 7, p)).toBeNull();
  });

  it("interpolates chapter_num and chapter_text into the user message", async () => {
    const p = fakeProvider("ok");
    await generateMicroSummary("CHAPTER_BODY", 42, p);
    const arg = p.generate.mock.calls[0][0];
    const userMsg = arg.messages.find((m: any) => m.role === "user").content;
    expect(userMsg).toContain("42");
    expect(userMsg).toContain("CHAPTER_BODY");
    expect(userMsg).not.toContain("{chapter_text}");
  });

  it("returns null when LLM returns empty string", async () => {
    const p = fakeProvider("   ");
    expect(await generateMicroSummary("正文", 7, p)).toBeNull();
  });

  it("uses 'en' language prompts when specified", async () => {
    const p = fakeProvider("micro summary text");
    const out = await generateMicroSummary("chapter body", 3, p, { language: "en" });
    expect(out).toBe("micro summary text");
    const arg = p.generate.mock.calls[0][0];
    const sysMsg = arg.messages.find((m: any) => m.role === "system").content;
    expect(typeof sysMsg).toBe("string");
    expect(sysMsg.length).toBeGreaterThan(0);
  });

  it("uses lower max_tokens than standard (micro is shorter)", async () => {
    const p = fakeProvider("ok");
    await generateMicroSummary("text", 1, p);
    const arg = p.generate.mock.calls[0][0];
    expect(arg.max_tokens).toBeLessThanOrEqual(200);
  });
});
