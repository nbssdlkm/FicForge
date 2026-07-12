// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 导入 API（engine-import.ts）编排层判别性测试 —— 错误分支优先。
 *
 * 覆盖入口错误/降级分支 + 一条正常闭环：
 *   - isAiAssistAvailable：AI 辅助入口的各「不可用」判据（no_api_key / unsupported_mode /
 *     config_error）+ 可用（ollama）。
 *   - analyzeImportFile：开 AI 辅助但构建 provider 阶段抛错 → 降级 useAiAssist=false、
 *     仍返回纯文本分析（不阻断导入）。
 *   - buildImportPlanFromAnalyses：空分析 → 空计划（计划为空分支）。
 *   - analyze → build → execute 正常闭环：一段正文 → 生成一条章节计划 → 落库一章。
 *
 * 真引擎 + MockAdapter；analyze_file 纯文本路径不打 LLM。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { LLMMode } from "@ficforge/engine";
import { MockAdapter } from "../../../../src-engine/repositories/__tests__/mock_adapter.js";
import { createAu, createFandom } from "../engine-fandoms";
import {
  analyzeImportFile,
  buildImportPlanFromAnalyses,
  executeImportPlan,
  getExistingChapterNums,
  isAiAssistAvailable,
} from "../engine-import";
import { getEngine, initEngine } from "../engine-instance";

let adapter: MockAdapter;
let auPath: string;

async function setDefaultLlm(
  patch: Partial<{ mode: LLMMode; model: string; api_base: string; api_key: string; ollama_model: string }>,
) {
  const s = await getEngine().repos.settings.get();
  Object.assign(s.default_llm, patch);
  await getEngine().repos.settings.save(s);
}

beforeEach(async () => {
  vi.restoreAllMocks();
  adapter = new MockAdapter();
  initEngine(adapter, "/data");
  const fandom = await createFandom("Naruto");
  const au = await createAu(fandom.name, "Canon", fandom.path);
  auPath = au.path;
});

describe("isAiAssistAvailable — AI 辅助入口判据（错误分支优先）", () => {
  it("api 模式但无 key → 不可用 no_api_key", async () => {
    await setDefaultLlm({ mode: LLMMode.API, model: "gpt-x", api_base: "https://x/v1", api_key: "" });
    expect(await isAiAssistAvailable()).toEqual({ available: false, reason: "no_api_key" });
  });

  it("local 模式 → 不可用 unsupported_mode", async () => {
    await setDefaultLlm({ mode: LLMMode.LOCAL, model: "llama" });
    expect(await isAiAssistAvailable()).toEqual({ available: false, reason: "unsupported_mode" });
  });

  it("settings 读取抛错 → catch 降级 config_error", async () => {
    vi.spyOn(getEngine().repos.settings, "get").mockRejectedValue(new Error("读盘失败"));
    expect(await isAiAssistAvailable()).toEqual({ available: false, reason: "config_error" });
  });

  it("ollama 模式 → 可用（无需 key）", async () => {
    await setDefaultLlm({ mode: LLMMode.OLLAMA, ollama_model: "qwen" });
    expect(await isAiAssistAvailable()).toEqual({ available: true });
  });

  it("api 模式且有 key → 可用", async () => {
    await setDefaultLlm({ mode: LLMMode.API, model: "gpt-x", api_base: "https://x/v1", api_key: "sk-real" });
    expect(await isAiAssistAvailable()).toEqual({ available: true });
  });
});

describe("analyzeImportFile — provider 自动构建失败降级", () => {
  it("开 AI 辅助但构建 provider 阶段抛错 → 降级为纯文本分析（不阻断）", async () => {
    // settings.get 抛错落在 analyzeImportFile 的内层 try → catch 置 useAiAssist=false 继续。
    vi.spyOn(getEngine().repos.settings, "get").mockRejectedValue(new Error("读盘失败"));

    const analysis = await analyzeImportFile("第一段正文。", "novel.txt", { useAiAssist: true });

    // 未抛错，仍产出纯文本分析。
    expect(analysis.mode).toBe("text");
    expect(analysis.filename).toBe("novel.txt");
  });
});

describe("buildImportPlanFromAnalyses — 计划为空分支", () => {
  it("空分析数组 → 空计划（零章节）", async () => {
    const plan = await buildImportPlanFromAnalyses([], {
      mode: "append",
      startChapter: 1,
      settingsMode: "separate",
    });
    expect(plan.chapters).toHaveLength(0);
    expect(plan.settings).toHaveLength(0);
  });
});

describe("analyze → build → execute 正常闭环", () => {
  it("一段正文 → 生成一条章节计划 → 落库一章", async () => {
    const analysis = await analyzeImportFile("很短的一段正文，作为单章导入。", "one.txt", {});
    const plan = await buildImportPlanFromAnalyses([analysis], {
      mode: "append",
      startChapter: 1,
      settingsMode: "separate",
    });
    expect(plan.chapters).toHaveLength(1);
    expect(plan.chapters[0].chapterNum).toBe(1);

    const result = await executeImportPlan(plan, auPath);
    expect(result.chaptersImported).toBe(1);

    // 闭环：章节确实落库。
    expect(await getExistingChapterNums(auPath)).toEqual([1]);
  });
});
