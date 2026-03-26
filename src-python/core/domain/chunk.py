"""向量检索结果片段。参见 PRD §2.6.2。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class Chunk:
    """向量检索返回的文本片段。"""

    content: str
    chapter_num: int
    score: float
    metadata: dict[str, Any] = field(default_factory=dict)
