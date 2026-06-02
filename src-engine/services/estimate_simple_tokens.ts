// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge Lite — estimate_simple_context_tokens
 *
 * 给 C5 顶栏 token 计数提供轻量入口：内部完整跑一次 assemble_context_simple
 * 但 user_input 用空串占位，返回 budget_report 的 token 计数 + context_window。
 * 防抖在调用方（UI hook）做。
 */

import type { Project } from "../domain/project.js";
import type { State } from "../domain/state.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import type { PlatformAdapter } from "../platform/adapter.js";
import type { Message } from "../llm/provider.js";
import { assemble_context_simple } from "./context_assembler.js";
import { count_tokens, ensureTokenizer } from "../tokenizer/index.js";
import { joinPath } from "../repositories/implementations/file_utils.js";

async function loadMdDir(
  adapter: PlatformAdapter,
  dirPath: string,
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  let exists = false;
  try {
    exists = await adapter.exists(dirPath);
  } catch {
    return result;
  }
  if (!exists) return result;

  let files: string[] = [];
  try {
    files = await adapter.listDir(dirPath);
  } catch {
    return result;
  }
  for (const f of files.sort()) {
    if (!f.endsWith(".md")) continue;
    try {
      const content = await adapter.readFile(joinPath(dirPath, f));
      result[f.replace(/\.md$/, "")] = content;
    } catch {
      continue;
    }
  }
  return result;
}

export interface SimpleContextTokenEstimate {
  inputTokens: number;
  contextWindow: number;
  maxOutput: number;
  /** inputTokens / contextWindow（0 表示 contextWindow 不可用）。 */
  ratio: number;
  /** UI 颜色档：normal < 0.8 / warn ≥ 0.8 / over ≥ 1.0。 */
  level: "normal" | "warn" | "over";
}

export interface EstimateSimpleContextParams {
  au_id: string;
  project: Project;
  state: State;
  chapter_repo: ChapterRepository;
  adapter: PlatformAdapter;
  language?: "zh" | "en";
  /**
   * 多轮 chat history（OpenAI 格式 user/assistant 交替）。简版"全塞"全带，
   * estimate 把 history tokens 算进 inputTokens 让 badge 反映真实 LLM
   * 请求总量。空数组或省略表示首轮无历史。
   */
  history?: Message[];
}

export async function estimate_simple_context_tokens(
  params: EstimateSimpleContextParams,
): Promise<SimpleContextTokenEstimate> {
  const { au_id, project, state, chapter_repo, adapter, language = "zh", history = [] } = params;

  const [characterFiles, worldbuildingFiles] = await Promise.all([
    loadMdDir(adapter, joinPath(au_id, "characters")),
    loadMdDir(adapter, joinPath(au_id, "worldbuilding")),
  ]);

  const result = await assemble_context_simple(
    project, state, "",
    chapter_repo, au_id,
    characterFiles, worldbuildingFiles, language,
  );

  // 复用 assembler 的内部 tokenizer 一致性 — 不重新挑实现，避免双源漂移。
  // 直接用 count_tokens 跟 budget_report.system_tokens / p1_tokens 同源。
  let historyTokens = 0;
  if (history.length > 0) {
    await ensureTokenizer(); // assembler 已 ensure 过，这里 idempotent
    for (const msg of history) {
      // OpenAI 格式：每条 message 实际 token = role token + content token + 几个 framing token。
      // 简版估算只算 content（与 assembler 同口径，badge 是估算非精确账单）。
      historyTokens += count_tokens(msg.content ?? "", project.llm).count;
    }
  }

  const inputTokens = result.budget_report.total_input_tokens + historyTokens;
  const contextWindow = result.budget_report.context_window || 0;
  const maxOutput = result.budget_report.max_output_tokens;
  const ratio = contextWindow > 0 ? inputTokens / contextWindow : 0;
  let level: SimpleContextTokenEstimate["level"] = "normal";
  if (ratio >= 1.0) level = "over";
  else if (ratio >= 0.8) level = "warn";

  return { inputTokens, contextWindow, maxOutput, ratio, level };
}
