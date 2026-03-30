"""ContextSummary 旁路统计数据结构。参见 D-0031。

只读统计对象，在 assemble_context 组装过程中旁路收集。
不参与任何业务决策，不影响 prompt 内容。
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ContextSummary:
    """上下文组装摘要，供前端展示轻量参考信息。"""

    characters_used: list[str] = field(default_factory=list)
    """被注入 P5 核心设定的角色名列表。"""

    worldbuilding_used: list[str] = field(default_factory=list)
    """被注入的世界观文件名列表（P5 + P4 RAG）。"""

    facts_injected: int = 0
    """注入 P3 的 facts 总条数（active + unresolved）。"""

    facts_as_focus: list[str] = field(default_factory=list)
    """chapter_focus 对应的 fact content_clean 前 20 字。"""

    pinned_count: int = 0
    """P0 生效的写作底线条数。"""

    rag_chunks_retrieved: int = 0
    """P4 RAG 召回的 chunk 数。"""

    total_input_tokens: int = 0
    """组装完成后的总输入 token 数。"""

    truncated_layers: list[str] = field(default_factory=list)
    """被截断的层标识列表。"""

    truncated_characters: list[str] = field(default_factory=list)
    """因 P5 预算不足而未注入的角色名列表。"""
