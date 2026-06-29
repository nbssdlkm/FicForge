// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Tokens — 对话顶栏 token 计数 API。
 * 内部跑一次 assemble_chat_context（分层，user_input 占空字符串），返回轻量 budget_report 子集。
 * 注入 facts/threads（badge 如实计入记忆栈）；RAG 由 estimate 有意跳过（避免 embedding 调用）。
 */

import {
  estimate_simple_context_tokens,
  type SimpleContextTokenEstimate,
  type Message,
} from "@ficforge/engine";
import { getEngine } from "./engine-instance";

export type { SimpleContextTokenEstimate };

export async function estimateSimpleContextTokens(
  auPath: string,
  history?: Message[],
): Promise<SimpleContextTokenEstimate> {
  const e = getEngine();
  // facts/threads 取失败不致命：badge 是按键级（防抖）高频 UI chrome，一次记忆读失败应静默回退空、
  // 让 badge 仍出数，而不是每次按键抛错。生成主路径（engine-simple-dispatch）才让 fact 读失败显式冒泡。
  const [project, state, settings, facts] = await Promise.all([
    e.repos.project.get(auPath),
    e.repos.state.get(auPath),
    e.repos.settings.get(),
    e.repos.fact.list_all(auPath).catch(() => []),
  ]);
  const threads = await e.repos.thread.list(auPath).catch(() => []);
  const language = (settings.app?.language === "en" ? "en" : "zh") as "zh" | "en";
  return await estimate_simple_context_tokens({
    au_id: auPath,
    project,
    state,
    chapter_repo: e.repos.chapter,
    adapter: e.adapter,
    language,
    history,
    facts,
    threads,
  });
}
