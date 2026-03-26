"""LocalFileDraftRepository — 本地文件系统草稿存储实现骨架。

实际逻辑待后续任务实现。
"""

from __future__ import annotations

from core.domain.draft import Draft
from repositories.interfaces.draft_repository import DraftRepository


class LocalFileDraftRepository(DraftRepository):
    """基于本地文件系统的草稿存储。"""

    async def get(self, au_id: str, chapter_num: int, variant: str) -> Draft:
        raise NotImplementedError

    async def save(self, draft: Draft) -> None:
        raise NotImplementedError

    async def list_by_chapter(self, au_id: str, chapter_num: int) -> list[Draft]:
        raise NotImplementedError

    async def delete_by_chapter(self, au_id: str, chapter_num: int) -> None:
        raise NotImplementedError

    async def delete_from_chapter(self, au_id: str, from_chapter_num: int) -> None:
        raise NotImplementedError
