# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""Context 预算报告数据结构。参见 PRD §4.1。"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class BudgetReport:
    """各层 token 占用报告，供 Context 可视化面板渲染。"""

    context_window: int = 0
    system_tokens: int = 0       # P0 + 规则
    p1_tokens: int = 0           # 当前指令
    p2_tokens: int = 0           # 最近章节
    p3_tokens: int = 0           # 事实表
    p4_tokens: int = 0           # RAG
    p5_tokens: int = 0           # 核心设定
    total_input_tokens: int = 0
    max_output_tokens: int = 0
    budget_remaining: int = 0
    is_fallback_estimate: bool = False
    truncated_layers: list[str] = field(default_factory=list)
    unresolved_soft_degraded: bool = False
