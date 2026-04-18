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
} from "@ficforge/engine";

import {
  resolve_llm_config,
  create_provider,
  split_into_chapters,
  parse_html,
  import_chapters as engineImportChapters,
} from "@ficforge/engine";

import { getEngine } from "./engine-instance";

export type { FileAnalysis, ImportPlan, ImportConflictOptions, NewImportResult, ImportProgress, AnalysisOptions };

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
      const canAssist =
        llmConfig.mode === "ollama" ||
        (llmConfig.mode === "api" && !!llmConfig.api_key);
      if (canAssist) {
        options = { ...options, llmProvider: create_provider(llmConfig) };
      }
    } catch {
      // 无法构建 provider，禁用 AI 辅助
      options = { ...options, useAiAssist: false };
    }
  }
  const { analyzeFile } = await import("@ficforge/engine");
  return analyzeFile(text, filename, options);
}

/**
 * 从分析结果构建导入计划（多文件接续、"续"合并、设定收集）。
 */
export async function buildImportPlanFromAnalyses(
  analyses: FileAnalysis[],
  conflictOptions: ImportConflictOptions,
): Promise<ImportPlan> {
  const { buildImportPlan } = await import("@ficforge/engine");
  return buildImportPlan(analyses, conflictOptions);
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
  const { executeImport } = await import("@ficforge/engine");
  const { adapter, repos, trash } = getEngine();
  return executeImport(plan, {
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
  return chapters.map(c => c.chapter_num).sort((a, b) => a - b);
}

// ===========================================================================
// Legacy Import functions (backward-compatible)
// ===========================================================================

export async function uploadImportFile(file: File): Promise<{
  chapters: { chapter_num: number; title: string; preview: string }[];
  split_method: string;
  total_chapters: number;
}> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "docx") {
    throw Object.assign(new Error("DOCX import is not supported in the local app yet."), {
      error_code: "UNSUPPORTED_IMPORT_FORMAT",
    });
  }

  const rawText = await file.text();
  const text = ext === "html" || ext === "htm" ? parse_html(rawText) : rawText;
  const chapters = split_into_chapters(text);
  const { get_split_method } = await import("@ficforge/engine");
  return {
    chapters: chapters.map((c) => ({ chapter_num: c.chapter_num, title: c.title, preview: c.content.slice(0, 100) })),
    split_method: get_split_method(text),
    total_chapters: chapters.length,
  };
}

export async function confirmImport(params: {
  au_path: string;
  chapters: { chapter_num: number; title: string; content: string }[];
  split_method?: string;
}) {
  const { chapter, state, ops } = getEngine().repos;
  const result = await engineImportChapters({
    au_id: params.au_path,
    chapters: params.chapters.map((c) => ({ chapter_num: c.chapter_num, title: c.title, content: c.content })),
    chapter_repo: chapter,
    state_repo: state,
    ops_repo: ops,
    split_method: params.split_method,
  });
  return result;
}
