// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/**
 * 生成调试包（开发者模式观测面，spec: docs/superpowers/specs/2026-09-08-dev-mode-generation-debug-design.md）。
 *
 * 每次生成（写文 / 对话）一份 bundle：完整 prompt 消息序列 + 分层预算 + RAG 命中 +
 * 结果统计或错误。纯观测数据——捕获与否不改变任何生成行为。
 *
 * 字段语义契约：
 * - start_messages：首轮发送的消息序列（对话 = startMessages 含历史；写文 = 组装的 messages）。
 * - final_messages：末轮实际发送的完整序列 = [...start_messages, ...internalHistory]
 *   （对话 agent loop 每轮追加 tool call/result/guard hint）。写文单轮，两者相同。
 * - iterations：1 基轮数（agent_loop 内部 iter 零基，捕获点已 +1 归一）。
 * - budget_report / context_summary / params 为 null 表示失败发生在对应解析步骤之前
 *   （骨架在路径入口建立，有什么填什么）。
 */

import type { Message } from "../llm/provider.js";
import type { BudgetReport } from "./budget_report.js";
import type { ContextSummary } from "./context_summary.js";

export interface GenerationDebugParams {
  max_tokens: number;
  temperature: number;
  top_p: number;
}

export interface GenerationDebugResult {
  input_tokens: number | null;
  output_tokens: number | null;
  duration_ms: number;
  draft_label?: string;
}

export interface GenerationDebugError {
  code: string;
  /** 已经过 redactString 脱敏（防 provider 错误回显密钥）。 */
  message: string;
}

export interface GenerationDebugBundle {
  /** capture 时分配（时间戳 + 会话内自增序号）；骨架创建时为空串。 */
  id: string;
  /** 骨架创建时间（ISO）——生成开始时刻，不是 capture 时刻。 */
  ts: string;
  path: "write" | "chat";
  au_id: string;
  chapter_num: number;
  /** 实际生效模型；resolveLlmConfig 前失败则为空串。 */
  model: string;
  params: GenerationDebugParams | null;
  start_messages: Message[];
  final_messages: Message[];
  iterations: number;
  budget_report: BudgetReport | null;
  context_summary: ContextSummary | null;
  result?: GenerationDebugResult;
  error?: GenerationDebugError;
}

export function createGenerationDebugBundle(
  partial: Pick<GenerationDebugBundle, "path" | "au_id" | "chapter_num"> & Partial<GenerationDebugBundle>,
): GenerationDebugBundle {
  return {
    id: "",
    ts: new Date().toISOString(),
    model: "",
    params: null,
    start_messages: [],
    final_messages: [],
    iterations: 0,
    budget_report: null,
    context_summary: null,
    ...partial,
  };
}

/** 列表用轻量元数据（不含 messages 全文）。 */
export interface DebugBundleMeta {
  id: string;
  ts: string;
  path: "write" | "chat";
  au_id: string;
  chapter_num: number;
  model: string;
  status: "ok" | "error" | "unknown";
  input_tokens: number | null;
  output_tokens: number | null;
  duration_ms: number | null;
  iterations: number;
}

export function toDebugBundleMeta(b: GenerationDebugBundle): DebugBundleMeta {
  return {
    id: b.id,
    ts: b.ts,
    path: b.path,
    au_id: b.au_id,
    chapter_num: b.chapter_num,
    model: b.model,
    status: b.error ? "error" : b.result ? "ok" : "unknown",
    input_tokens: b.result?.input_tokens ?? null,
    output_tokens: b.result?.output_tokens ?? null,
    duration_ms: b.result?.duration_ms ?? null,
    iterations: b.iterations,
  };
}
