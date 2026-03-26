"""DraftRepository 抽象接口。

管理章节草稿的读写。草稿存储在 .drafts/ 目录下。
参见 PRD §2.6.1 中 LocalFileDraftRepository。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from core.domain.draft import Draft


class DraftRepository(ABC):
    """草稿存储抽象接口。"""

    @abstractmethod
    async def get(self, au_id: str, chapter_num: int, variant: str) -> Draft:
        """获取指定章节的指定草稿变体。"""
        ...

    @abstractmethod
    async def save(self, draft: Draft) -> None:
        """保存草稿。"""
        ...

    @abstractmethod
    async def list_by_chapter(self, au_id: str, chapter_num: int) -> list[Draft]:
        """列出指定章节的所有草稿变体。"""
        ...

    @abstractmethod
    async def delete_by_chapter(self, au_id: str, chapter_num: int) -> None:
        """删除指定章节的所有草稿（用于 undo 级联清理）。"""
        ...

    @abstractmethod
    async def delete_from_chapter(self, au_id: str, from_chapter_num: int) -> None:
        """删除章节号 >= from_chapter_num 的所有草稿（D-0016 undo 清理）。"""
        ...
