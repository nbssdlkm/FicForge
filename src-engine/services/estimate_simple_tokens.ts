// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * FicForge Lite — estimate_simple_context_tokens
 *
 * 给对话顶栏 token badge 提供轻量入口：内部完整跑一次 assemble_chat_context（分层），
 * user_input 用空串占位，返回 budget_report 的 token 计数 + context_window。
 * 防抖在调用方（UI hook）做。
 *
 * **有意跳过 RAG**：不传 vector_repo/embedding_provider，避免 badge 每次估算（防抖后仍频繁）
 * 触发 embedding 调用。badge 因此略低估 P4 RAG（RAG 上界 ≈ ctx/4，且本就是"估算非精确账单"）；
 * facts / 剧情线 / 上一章 / 核心设定均如实计入（caller 注入 facts/threads）。
 */

import type { Project } from "../domain/project.js";
import type { Settings } from "../domain/settings.js";
import type { State } from "../domain/state.js";
import type { Fact } from "../domain/fact.js";
import type { Thread } from "../domain/thread.js";
import type { ChapterRepository } from "../repositories/interfaces/chapter.js";
import type { PlatformAdapter } from "../platform/adapter.js";
import type { Message } from "../llm/provider.js";
import { resolve_llm_config } from "../llm/config_resolver.js";
import { assemble_chat_context } from "./context_assembler.js";
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
   * 多轮 chat history（OpenAI 格式 user/assistant 交替）。estimate 把 history tokens
   * 算进 inputTokens 让 badge 反映真实 LLM 请求总量。空数组或省略表示首轮无历史。
   */
  history?: Message[];
  /** 记忆栈事实（P3）；省略 ⇒ badge 不计 facts。caller（engine-tokens.ts）从 repo 注入。 */
  facts?: Fact[];
  /** 活跃剧情线（M8-B）；省略 ⇒ badge 不计剧情线。 */
  threads?: Thread[];
  /**
   * H4：全局 settings。传入时经 resolve_llm_config(session_llm, project, settings)
   * 得到实际生效 LLM 视图喂 assembler —— badge 的窗口/预算与真实组装同源（badge 是
   * 「全塞」历史哲学下唯一的超窗预警防线，双链漂移 = 预警失真）。省略回退 project.llm（旧行为）。
   */
  settings?: Settings;
  /** H4：会话级 LLM 覆盖（与 dispatch 收到的 session_llm 同物，UI 的 sessionLlmPayload）。 */
  session_llm?: Record<string, string> | null;
}

export async function estimate_simple_context_tokens(
  params: EstimateSimpleContextParams,
): Promise<SimpleContextTokenEstimate> {
  const { au_id, project, state, chapter_repo, adapter, language = "zh", history = [], facts = [], threads = [], settings, session_llm = null } = params;

  // H4：与 dispatch 同一条解析链（session > project > settings.default_llm），
  // badge 的窗口/输出上限/预算跟真实请求走同一个模型。
  const effectiveLlm = settings ? resolve_llm_config(session_llm, project, settings) : null;

  const [characterFiles, worldbuildingFiles] = await Promise.all([
    loadMdDir(adapter, joinPath(au_id, "characters")),
    loadMdDir(adapter, joinPath(au_id, "worldbuilding")),
  ]);

  const result = await assemble_chat_context({
    project, state, user_input: "",
    facts, threads,
    chapter_repo, au_id,
    character_files: characterFiles, worldbuilding_files: worldbuildingFiles,
    language,
    effective_llm: effectiveLlm,
    // 有意不传 vector_repo/embedding_provider：badge 路径跳过 RAG（见文件头注释）。
  });

  // 复用 assembler 的内部 tokenizer 一致性 — 不重新挑实现，避免双源漂移。
  // 直接用 count_tokens 跟 budget_report.system_tokens / p1_tokens 同源。
  let historyTokens = 0;
  if (history.length > 0) {
    await ensureTokenizer(); // assembler 已 ensure 过，这里 idempotent
    for (const msg of history) {
      // OpenAI 格式：每条 message 实际 token = role token + content token + 几个 framing token。
      // 简版估算只算 content（与 assembler 同口径，badge 是估算非精确账单）。
      // H4：编码选择与 assembler 同源（count_tokens 现只看 mode，行为等价）。
      historyTokens += count_tokens(msg.content ?? "", effectiveLlm ?? project.llm).count;
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
