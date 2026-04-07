# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""批注领域对象（FIX-005B）。

批注是覆盖在正文上的独立层，不修改 ch00XX.md 的内容。
不触发 dirty chapter / 重新向量化 / facts 重新确认 / RAG 检索。

存储：chapters/annotations/ch{NNNN}_annotations.json

未来方向（本次不做 UI）：
- 前端批注 UI：选中文字 → 弹出工具栏（高亮/评论/书签）
- "一起磕" agent：侧边栏 AI 读者，通过 RAG 获取上下文讨论剧情
- 批注导出：导出带批注的章节（HTML 格式）
- 批注分享：生成可分享的批注视图
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal


ANNOTATION_SCHEMA_VERSION = "1.0.0"


@dataclass
class Annotation:
    """单条批注。"""

    id: str                                          # "ann_" + 6位随机ID
    type: Literal["highlight", "comment", "bookmark"]
    start_offset: int                                # 正文中的起始字符偏移
    end_offset: int                                  # 结束字符偏移
    color: str = "yellow"                            # highlight 颜色：yellow / green / blue / pink
    comment: str = ""                                # comment 类型时的文字内容
    created_at: str = ""                             # ISO 8601


@dataclass
class ChapterAnnotations:
    """一章的全部批注。"""

    schema_version: str = ANNOTATION_SCHEMA_VERSION
    chapter_num: int = 0
    annotations: list[Annotation] = field(default_factory=list)
