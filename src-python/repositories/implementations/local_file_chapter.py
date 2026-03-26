"""LocalFileChapterRepository — 本地文件系统章节存储实现骨架。

4 位补零文件名转换封装在此处（D-0014）。
实际逻辑待 T-004 实现。
"""

from __future__ import annotations

from core.domain.chapter import Chapter
from repositories.interfaces.chapter_repository import ChapterRepository


class LocalFileChapterRepository(ChapterRepository):
    """基于本地文件系统的章节存储。"""

    async def get(self, au_id: str, chapter_num: int) -> Chapter:
        raise NotImplementedError

    async def save(self, chapter: Chapter) -> None:
        raise NotImplementedError

    async def delete(self, au_id: str, chapter_num: int) -> None:
        raise NotImplementedError

    async def list_main(self, au_id: str) -> list[Chapter]:
        raise NotImplementedError

    async def exists(self, au_id: str, chapter_num: int) -> bool:
        raise NotImplementedError
