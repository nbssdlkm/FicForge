"""Fandom 领域对象。参见 PRD §3.2 fandom.yaml。"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Fandom:
    """Fandom 元信息。"""

    name: str = ""
    created_at: str = ""                        # ISO 8601
    core_characters: list[str] = field(default_factory=list)
    wiki_source: str = ""                       # 可选
