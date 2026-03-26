"""章节领域对象。参见 PRD §3.4 frontmatter 字段定义、§2.6.4。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from core.domain.generated_with import GeneratedWith


@dataclass
class Chapter:
    """已确认的主线章节。

    字段名与 PRD §3.4 frontmatter 一致。
    chapter_num 为 int 类型（D-0014），文件名转换封装在 Repository 内部。
    """

    au_id: str
    chapter_num: int                              # 整型，D-0014
    content: str = ""                             # 正文（不含 frontmatter）

    # frontmatter 字段
    chapter_id: str = ""                          # 全局唯一 UUID，创建时生成
    revision: int = 1                             # 每次覆写/确认 +1
    confirmed_focus: list[str] = field(default_factory=list)  # fact id 数组
    confirmed_at: str = ""                        # ISO 8601
    content_hash: str = ""                        # SHA-256，D-0011
    provenance: str = ""                          # 来源标记（如 "generated" / "imported" / "manual"）
    generated_with: Optional[GeneratedWith] = None  # 生成来源快照
