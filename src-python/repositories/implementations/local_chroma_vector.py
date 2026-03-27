"""LocalChromaVectorRepository — ChromaDB 向量存储实现骨架。

必须开启 WAL 模式（D-0013）。
实际逻辑待后续任务实现。
"""

from __future__ import annotations

from typing import Any

from core.domain.chapter import Chapter
from core.domain.chunk import Chunk
from repositories.interfaces.vector_repository import VectorRepository


class LocalChromaVectorRepository(VectorRepository):
    """基于 ChromaDB 的向量存储。"""

    def index_chapter(self, chapter: Chapter) -> None:
        raise NotImplementedError

    def delete_chapter(self, au_id: str, chapter_num: int) -> None:
        raise NotImplementedError

    def search(
        self, au_id: str, query: str, filters: dict[str, Any], top_k: int
    ) -> list[Chunk]:
        raise NotImplementedError
