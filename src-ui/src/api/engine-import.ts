// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Import API — 从 engine-client.ts 拆出的导入相关函数。
 * 只在导入流程动态引入，减小主包体积。
 */

import type {
  FileAnalysis,
  ImportPlan,
  ImportConflictOptions,
  NewImportResult,
  ImportProgress,
  AnalysisOptions,
  AnalysisStage,
} from "@ficforge/engine";

import { resolve_llm_config, create_provider } from "@ficforge/engine";

import { getEngine } from "./engine-instance";

export type {
  FileAnalysis,
  ImportPlan,
  ImportConflictOptions,
  NewImportResult,
  ImportProgress,
  AnalysisOptions,
  AnalysisStage,
};

/**
 * 检测 AI 辅助当前是否可用。
 * reason: "no_api_key"（api 模式缺 key）/ "unsupported_mode"（local 等未实现）/ "config_error"（异常）。
 */
export async function isAiAssistAvailable(): Promise<{ available: boolean; reason?: string }> {
  try {
    const { settings } = getEngine().repos;
    const sett = await settings.get();
    const llmConfig = resolve_llm_config(null, {}, sett as unknown as Record<string, unknown>);
    if (llmConfig.mode === "ollama") return { available: true };
    if (llmConfig.mode === "api") {
      return llmConfig.api_key ? { available: true } : { available: false, reason: "no_api_key" };
    }
    return { available: false, reason: "unsupported_mode" };
  } catch {
    return { available: false, reason: "config_error" };
  }
}

/**
 * 分析单个文件——检测对话格式 or 纯正文，返回分析结果。
 * 前端负责文件读取和格式转换（docx/html → 纯文本）。
 */
export async function analyzeImportFile(
  text: string,
  filename: string,
  options: AnalysisOptions = {},
): Promise<FileAnalysis> {
  // 如果用户开启了 AI 辅助但没传 provider，自动构建一个
  if (options.useAiAssist && !options.llmProvider) {
    try {
      const { settings } = getEngine().repos;
      const sett = await settings.get();
      const llmConfig = resolve_llm_config(null, {}, sett as unknown as Record<string, unknown>);
      // api 和 ollama 都支持 AI 辅助导入；local 未实现时静默禁用即可
      const canAssist = llmConfig.mode === "ollama" || (llmConfig.mode === "api" && !!llmConfig.api_key);
      if (canAssist) {
        options = { ...options, llmProvider: create_provider(llmConfig) };
      }
      // canAssist=false 时不设 llmProvider；下游 splitChapters 检查 llmProvider 为 undefined 会自动跳过 AI
    } catch {
      // 无法构建 provider，禁用 AI 辅助
      options = { ...options, useAiAssist: false };
    }
  }
  const { analyze_file } = await import("@ficforge/engine");
  return analyze_file(text, filename, options);
}

/**
 * 从分析结果构建导入计划（多文件接续、"续"合并、设定收集）。
 */
export async function buildImportPlanFromAnalyses(
  analyses: FileAnalysis[],
  conflictOptions: ImportConflictOptions,
): Promise<ImportPlan> {
  const { build_import_plan } = await import("@ficforge/engine");
  return build_import_plan(analyses, conflictOptions);
}

/**
 * 执行导入计划——写入章节、设定、ops，更新 state。
 */
export async function executeImportPlan(
  plan: ImportPlan,
  auPath: string,
  onProgress?: (progress: ImportProgress) => void,
  locale?: "zh" | "en",
): Promise<NewImportResult> {
  const { execute_import } = await import("@ficforge/engine");
  const { adapter, repos, trash } = getEngine();
  return execute_import(plan, {
    auId: auPath,
    chapterRepo: repos.chapter,
    stateRepo: repos.state,
    opsRepo: repos.ops,
    adapter,
    trashService: trash,
    onProgress,
    locale,
  });
}

/**
 * 获取 AU 已有章节数（用于冲突检测）。
 */
export async function getExistingChapterNums(auPath: string): Promise<number[]> {
  const { chapter } = getEngine().repos;
  const chapters = await chapter.list_main(auPath);
  return chapters.map((c) => c.chapter_num).sort((a, b) => a - b);
}

// 旧版导入入口 uploadImportFile / confirmImport 已删除（2026-07-09 盲审孤儿管线清理）：
// 全仓零调用点、未挂 barrel；现行导入走 analyze_file → build_import_plan → execute_import。
