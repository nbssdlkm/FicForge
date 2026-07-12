// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 审计 H4 — 预算真相源归一：assembler / estimate 按实际生效 LLM（resolve 三层结果）
 * 计算窗口与输出上限，不再只看 project.llm。
 *
 * 判别性：回退旧码（assembler 忽略 effective_llm / estimate 不接 settings）时，
 * 「131072 窗口」断言全部退回 DEFAULT_CONTEXT_WINDOW=32000 而失败。
 * 向后兼容：不传 effective 视图的调用与修改前逐字节一致（等价性用例钉死）。
 */

import { describe, expect, it } from "vitest";
import { assemble_context, assemble_chat_context } from "../context_assembler.js";
import { estimate_simple_context_tokens } from "../estimate_simple_tokens.js";
import { createProject, createLLMConfig } from "../../domain/project.js";
import { createSettings } from "../../domain/settings.js";
import { createState } from "../../domain/state.js";
import { MockAdapter } from "../../repositories/__tests__/mock_adapter.js";
import { FileChapterRepository } from "../../repositories/implementations/file_chapter.js";

const EFFECTIVE_128K = { mode: "api", model: "unmapped-model-x", context_window: 131_072 };

function bareProject(auId: string) {
  // 主流受害配置：AU 无 LLM 覆盖（model=""、context_window=0）——旧码在此按 32k 兜底
  return createProject({ project_id: "p", au_id: auId, llm: createLLMConfig() });
}

describe("assemble_context — effective_llm（审计 H4）", () => {
  it("project.llm 空 + effective 视图 131072：窗口/预算按实际生效模型计算", async () => {
    const adapter = new MockAdapter();
    const repo = new FileChapterRepository(adapter);
    const state = createState({ au_id: "au_h4a", current_chapter: 1 });

    const withEffective = await assemble_context(
      bareProject("au_h4a"),
      state,
      "继续写",
      [],
      repo,
      "au_h4a",
      null,
      null,
      null,
      "zh",
      [],
      EFFECTIVE_128K,
    );
    const withoutEffective = await assemble_context(
      bareProject("au_h4a"),
      state,
      "继续写",
      [],
      repo,
      "au_h4a",
      null,
      null,
      null,
      "zh",
      [],
    );

    expect(withEffective.budget_report.context_window).toBe(131_072);
    // 旧码路径（不传视图）保持 32k 兜底 —— 同时证明差异确实来自 effective 参数
    expect(withoutEffective.budget_report.context_window).toBe(32_000);
  });

  it("等价性：effective 视图 == project.llm 时输出与不传视图逐项一致（向后兼容）", async () => {
    const adapter = new MockAdapter();
    const repo = new FileChapterRepository(adapter);
    const project = createProject({
      project_id: "p",
      au_id: "au_h4b",
      llm: createLLMConfig({ mode: "api", model: "m-proj", context_window: 64_000 }),
    });
    const state = createState({ au_id: "au_h4b", current_chapter: 1 });

    const viaEffective = await assemble_context(
      project,
      state,
      "继续写",
      [],
      repo,
      "au_h4b",
      null,
      null,
      null,
      "zh",
      [],
      { mode: "api", model: "m-proj", context_window: 64_000 },
    );
    const legacy = await assemble_context(project, state, "继续写", [], repo, "au_h4b", null, null, null, "zh", []);

    expect(viaEffective.budget_report.context_window).toBe(legacy.budget_report.context_window);
    expect(viaEffective.max_tokens).toBe(legacy.max_tokens);
    expect(viaEffective.budget_report.input_budget).toBe(legacy.budget_report.input_budget);
    expect(viaEffective.messages).toEqual(legacy.messages);
  });
});

describe("assemble_chat_context — effective_llm（审计 H4）", () => {
  it("对话路径同样按 effective 视图计算窗口", async () => {
    const adapter = new MockAdapter();
    const repo = new FileChapterRepository(adapter);
    const state = createState({ au_id: "au_h4c", current_chapter: 1 });

    const withEffective = await assemble_chat_context({
      project: bareProject("au_h4c"),
      state,
      user_input: "写下一章",
      facts: [],
      threads: [],
      chapter_repo: repo,
      au_id: "au_h4c",
      language: "zh",
      effective_llm: EFFECTIVE_128K,
    });
    const withoutEffective = await assemble_chat_context({
      project: bareProject("au_h4c"),
      state,
      user_input: "写下一章",
      facts: [],
      threads: [],
      chapter_repo: repo,
      au_id: "au_h4c",
      language: "zh",
    });

    expect(withEffective.budget_report.context_window).toBe(131_072);
    expect(withoutEffective.budget_report.context_window).toBe(32_000);
  });
});

describe("estimate_simple_context_tokens — 与真实组装同源（审计 H4）", () => {
  it("settings.default_llm 手动窗口进 badge（主流配置修复的直接体现）", async () => {
    const adapter = new MockAdapter();
    const repo = new FileChapterRepository(adapter);
    const state = createState({ au_id: "au_h4d", current_chapter: 1 });
    const settings = createSettings({
      default_llm: createLLMConfig({ mode: "api", model: "m-set", context_window: 131_072 }),
    });

    const withSettings = await estimate_simple_context_tokens({
      au_id: "au_h4d",
      project: bareProject("au_h4d"),
      state,
      chapter_repo: repo,
      adapter,
      language: "zh",
      settings,
    });
    const withoutSettings = await estimate_simple_context_tokens({
      au_id: "au_h4d",
      project: bareProject("au_h4d"),
      state,
      chapter_repo: repo,
      adapter,
      language: "zh",
    });

    expect(withSettings.contextWindow).toBe(131_072);
    expect(withoutSettings.contextWindow).toBe(32_000);
  });

  it("session 覆盖优先于 settings（badge 跟随会话切模型）", async () => {
    const adapter = new MockAdapter();
    const repo = new FileChapterRepository(adapter);
    const state = createState({ au_id: "au_h4e", current_chapter: 1 });
    const settings = createSettings({
      default_llm: createLLMConfig({ mode: "api", model: "m-set", context_window: 131_072 }),
    });

    const r = await estimate_simple_context_tokens({
      au_id: "au_h4e",
      project: bareProject("au_h4e"),
      state,
      chapter_repo: repo,
      adapter,
      language: "zh",
      settings,
      session_llm: { mode: "api", model: "m-sess", context_window: "200000" },
    });

    expect(r.contextWindow).toBe(200_000);
  });
});
