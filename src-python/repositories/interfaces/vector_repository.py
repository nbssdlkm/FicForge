"""VectorRepository 抽象接口。

业务逻辑不得直接访问 ChromaDB，必须通过此接口。
参见 PRD §2.6.2。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from core.domain.chapter import Chapter
from core.domain.chunk import Chunk


class VectorRepository(ABC):
    """向量存储抽象接口。"""

    @abstractmethod
    def index_chapter(self, chapter: Chapter) -> None:
        """将章节向量化并入库。"""
        ...

    @abstractmethod
    def delete_chapter(self, au_id: str, chapter_num: int) -> None:
        """删除指定章节的向量索引。"""
        ...

    @abstractmethod
    def search(
        self, au_id: str, query: str, filters: dict[str, Any], top_k: int
    ) -> list[Chunk]:
        """向量检索，返回最相关的文本片段。"""
        ...
