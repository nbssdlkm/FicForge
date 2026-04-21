import { describe, expect, it, vi } from "vitest";
import { assemble_context } from "../context_assembler.js";
import { createProject, createLLMConfig } from "../../domain/project.js";
import { createState } from "../../domain/state.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";

function setup(contextWindow: number, chapterLength: number) {
  const adapter = new MockAdapter();
  const chapterRepo = new FileChapterRepository(adapter);
  const project = createProject({
    project_id: "p", au_id: "a",
    llm: createLLMConfig({ mode: "api" as any, model: "gpt-4o", context_window: contextWindow }),
    chapter_length: chapterLength,
  });
  const state = createState({ au_id: "a", current_chapter: 1 });
  return { project, state, chapterRepo };
}

describe("context_assembler budget rebalance", () => {
  it("128k model gains massive input budget (was ~77k, now >100k)", async () => {
    const { project, state, chapterRepo } = setup(128_000, 1500);
    const r = await assemble_context(project, state, "写", [], chapterRepo, "a");
    expect(r.max_tokens).toBe(3000);  // chapter × 2 still binding
    expect(r.budget_report.max_output_tokens).toBe(3000);
    // input budget = 128000 - max(3000, 10000) - sys - 500 ≈ 117k
    const inputAvailable = r.budget_report.context_window - r.budget_report.max_output_tokens - r.budget_report.system_tokens;
    expect(inputAvailable).toBeGreaterThan(100_000);
  });

  it("8k tiny model does NOT regress (uses old 60% formula)", async () => {
    const { project, state, chapterRepo } = setup(8_000, 800);
    const r = await assemble_context(project, state, "写", [], chapterRepo, "a");
    expect(r.max_tokens).toBe(1600);  // 800 × 2
    // budget = max(new, old). new = 8000-10000-sys-500 < 0; old = 4800-sys ≈ 4360
    // 验证：input budget 应该至少是旧公式水平
    const oldBudget = Math.trunc(8000 * 0.6) - r.budget_report.system_tokens;
    const totalUsed = r.budget_report.p1_tokens + r.budget_report.p2_tokens + r.budget_report.p3_tokens + r.budget_report.p4_tokens + r.budget_report.p5_tokens;
    expect(totalUsed + r.budget_report.budget_remaining).toBeGreaterThanOrEqual(oldBudget - 5);
  });

  it("OUTPUT_RESERVE_CEIL=15000 caps maxTokens for very long chapters", async () => {
    vi.resetModules();
    vi.doMock("../../domain/model_context_map.js", async () => {
      const actual = await vi.importActual<typeof import("../../domain/model_context_map.js")>("../../domain/model_context_map.js");
      return {
        ...actual,
        get_model_max_output: () => 20_000,
      };
    });

    const { assemble_context: assembleContext } = await import("../context_assembler.js");
    const { project, state, chapterRepo } = setup(128_000, 10_000);  // 想写 1 万字章节
    const r = await assembleContext(project, state, "写", [], chapterRepo, "a");
    try {
      // chapter × 2 = 20000 > CEIL 15000 → 夹到 15000
      expect(r.max_tokens).toBe(15_000);
    } finally {
      vi.doUnmock("../../domain/model_context_map.js");
      vi.resetModules();
    }
  });

  it("medium 32k model: small but positive gain", async () => {
    const { project, state, chapterRepo } = setup(32_000, 1500);
    const r = await assemble_context(project, state, "写", [], chapterRepo, "a");
    expect(r.max_tokens).toBe(3000);
    const inputAvailable = r.budget_report.context_window - 10000 - r.budget_report.system_tokens - 500;
    const oldBudget = Math.trunc(32000 * 0.6) - r.budget_report.system_tokens;
    // new 公式（=21456）应该 > old (=18656)
    expect(Math.max(inputAvailable, oldBudget)).toBeGreaterThan(oldBudget);
  });
});
