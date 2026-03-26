"""事实领域对象。参见 PRD §3.6 facts.jsonl 字段定义。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from core.domain.enums import FactSource, FactStatus, FactType, NarrativeWeight


@dataclass
class Fact:
    """单条事实记录。

    字段名与 PRD §3.6 一致。
    常规流程 append-only，仅章节回滚时允许物理删除（D-0003）。
    """

    id: str                                        # 格式: f_{时间戳}_{4位随机}
    content_raw: str                               # 带章节编号，用于管理和追溯
    content_clean: str                             # 纯叙事描述，注入 prompt 时使用
    characters: list[str] = field(default_factory=list)  # 涉及角色
    timeline: str = ""                             # 所属时间线标签
    story_time: str = ""                           # 故事内时间（可选）
    chapter: int = 0                               # 产生于第几章
    status: FactStatus = FactStatus.ACTIVE
    type: FactType = FactType.PLOT_EVENT
    resolves: Optional[str] = None                 # 被解决的 fact id
    narrative_weight: NarrativeWeight = NarrativeWeight.MEDIUM
    source: FactSource = FactSource.MANUAL         # Phase 1 写入，Phase 2 消费
    revision: int = 1                              # 每次编辑 +1
    created_at: str = ""                           # ISO 8601
    updated_at: str = ""                           # ISO 8601
