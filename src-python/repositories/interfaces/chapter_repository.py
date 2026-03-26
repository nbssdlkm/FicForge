"""ChapterRepository 抽象接口。

业务逻辑不得直接访问文件路径，必须通过此接口。
参见 PRD §2.6.2。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from core.domain.chapter import Chapter


class ChapterRepository(ABC):
    """章节存储抽象接口。"""

    @abstractmethod
    async def get(self, au_id: str, chapter_num: int) -> Chapter:
        """获取指定章节。"""
        ...

    @abstractmethod
    async def save(self, chapter: Chapter) -> None:
        """保存章节（新建或覆盖）。"""
        ...

    @abstractmethod
    async def delete(self, au_id: str, chapter_num: int) -> None:
        """删除指定章节。"""
        ...

    @abstractmethod
    async def list_main(self, au_id: str) -> list[Chapter]:
        """列出 AU 下所有已确认主线章节。"""
        ...
