// Copyright (c) 2026 FicForge Contributors
// Licensed under the GNU Affero General Public License v3.0.

/** Context 预算报告数据结构。参见 PRD §4.1。 */

export interface BudgetReport {
  context_window: number;
  system_tokens: number;       // P0 + 规则
  p1_tokens: number;           // 当前指令
  p2_tokens: number;           // 最近章节
  p3_tokens: number;           // 事实表
  p4_tokens: number;           // RAG
  p5_tokens: number;           // 核心设定
  total_input_tokens: number;
  max_output_tokens: number;
  budget_remaining: number;
  is_fallback_estimate: boolean;
  truncated_layers: string[];
  unresolved_soft_degraded: boolean;
}

export function createBudgetReport(partial?: Partial<BudgetReport>): BudgetReport {
  return {
    context_window: 0,
    system_tokens: 0,
    p1_tokens: 0,
    p2_tokens: 0,
    p3_tokens: 0,
    p4_tokens: 0,
    p5_tokens: 0,
    total_input_tokens: 0,
    max_output_tokens: 0,
    budget_remaining: 0,
    is_fallback_estimate: false,
    truncated_layers: [],
    unresolved_soft_degraded: false,
    ...partial,
  };
}
