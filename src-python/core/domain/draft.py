"""草稿领域对象。参见 PRD §2.6.2。"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from core.domain.generated_with import GeneratedWith


@dataclass
class Draft:
    """章节草稿。

    存储在 .drafts/ 目录下，文件名格式如 ch0038_draft_A.md（D-0014）。
    """

    au_id: str
    chapter_num: int           # 整型，D-0014
    variant: str               # 草稿变体标识，如 "A", "B", "C"
    content: str = ""          # 正文
    generated_with: Optional[GeneratedWith] = None
