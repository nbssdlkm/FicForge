"""操作日志领域对象。参见 PRD §2.6.4、DECISIONS D-0010。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class OpsEntry:
    """单条操作日志。

    ops.jsonl 是业务关键依赖（D-0010），用于 undo 快照恢复、dirty 基线、fact 状态回放。
    op_id 是 Phase 1 必须字段。
    """

    op_id: str                          # 操作唯一 ID
    op_type: str                        # 操作类型（如 confirm_chapter / undo_chapter / edit_fact 等）
    target_id: str                      # 操作目标 ID（如 au_id / chapter_id / fact_id）
    timestamp: str                      # ISO 8601
    chapter_num: Optional[int] = None   # 关联章节号（可选）
    payload: dict[str, Any] = field(default_factory=dict)  # 操作负载（快照数据等）
