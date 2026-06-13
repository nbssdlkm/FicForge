// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * Engine Tokens — FicForge Lite C5 顶栏 token 计数 API。
 * 内部跑一次 assemble_context_simple（user_input 占空字符串），返回轻量 budget_report 子集。
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
  const [project, state, settings] = await Promise.all([
    e.repos.project.get(auPath),
    e.repos.state.get(auPath),
    e.repos.settings.get(),
  ]);
  const language = (settings.app?.language === "en" ? "en" : "zh") as "zh" | "en";
  return await estimate_simple_context_tokens({
    au_id: auPath,
    project,
    state,
    chapter_repo: e.repos.chapter,
    adapter: e.adapter,
    language,
    history,
  });
}
