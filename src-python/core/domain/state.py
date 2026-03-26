"""运行时状态领域对象。参见 PRD §3.5 state.yaml。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from core.domain.enums import IndexStatus


@dataclass
class EmbeddingFingerprint:
    """Embedding 配置指纹，用于索引一致性校验。参见 PRD §3.5。"""

    mode: str = ""       # api / local / ollama
    model: str = ""
    api_base: str = ""


@dataclass
class State:
    """AU 运行时状态。

    字段名与 PRD §3.5 state.yaml 一致。
    存放运行时变化量，非长期配置。
    """

    au_id: str
    revision: int = 1                              # 每次运行态变更 +1
    updated_at: str = ""                           # ISO 8601
    current_chapter: int = 1                       # 当前待写章节号（D-0001）
    last_scene_ending: str = ""
    last_confirmed_chapter_focus: list[str] = field(default_factory=list)
    characters_last_seen: dict[str, int] = field(default_factory=dict)
    chapter_focus: list[str] = field(default_factory=list)  # fact id 数组，最多 2 个
    chapters_dirty: list[int] = field(default_factory=list)
    index_status: IndexStatus = IndexStatus.READY
    index_built_with: Optional[EmbeddingFingerprint] = None
    sync_unsafe: bool = False
