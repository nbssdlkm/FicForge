// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

import { describe, it, expect, vi } from "vitest";
import { generateStandardSummary } from "../chapter_summary.js";

function fakeProvider(reply: string) {
  return { generate: vi.fn(async () => ({ content: reply })) } as any;
}

describe("generateStandardSummary", () => {
  it("returns trimmed LLM text", async () => {
    const p = fakeProvider("  第七章，主角与师父决裂。  ");
    const out = await generateStandardSummary("第七章正文……", 7, p);
    expect(out).toBe("第七章，主角与师父决裂。");
    expect(p.generate).toHaveBeenCalledOnce();
  });

  it("returns null on empty chapter without calling LLM", async () => {
    const p = fakeProvider("x");
    expect(await generateStandardSummary("   ", 7, p)).toBeNull();
    expect(p.generate).not.toHaveBeenCalled();
  });

  it("returns null when LLM throws (degrade, no throw)", async () => {
    const p = {
      generate: vi.fn(async () => {
        throw new Error("network");
      }),
    } as any;
    expect(await generateStandardSummary("正文", 7, p)).toBeNull();
  });

  it("interpolates chapter_num and chapter_text into the user message", async () => {
    const p = fakeProvider("ok");
    await generateStandardSummary("CHAPTER_BODY", 42, p);
    const arg = p.generate.mock.calls[0][0];
    const userMsg = arg.messages.find((m: any) => m.role === "user").content;
    expect(userMsg).toContain("42");
    expect(userMsg).toContain("CHAPTER_BODY");
    expect(userMsg).not.toContain("{chapter_text}");
  });
});
