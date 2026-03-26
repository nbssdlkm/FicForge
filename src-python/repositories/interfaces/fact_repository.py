"""FactRepository 抽象接口。

Facts 在常规流程中 append-only，仅在章节回滚时允许物理删除。
参见 PRD §2.6.2 和 DECISIONS D-0003。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from core.domain.fact import Fact


class FactRepository(ABC):
    """事实表存储抽象接口。"""

    @abstractmethod
    async def append(self, au_id: str, fact: Fact) -> None:
        """追加一条事实记录（append-only）。"""
        ...

    @abstractmethod
    async def list_all(self, au_id: str) -> list[Fact]:
        """列出 AU 下所有事实记录。"""
        ...

    @abstractmethod
    async def list_by_chapter(self, au_id: str, chapter_num: int) -> list[Fact]:
        """列出指定章节关联的事实记录。"""
        ...

    @abstractmethod
    async def delete_by_chapter(self, au_id: str, chapter_num: int) -> None:
        """删除指定章节的事实记录（仅限章节回滚时调用）。"""
        ...

    @abstractmethod
    async def update_status(self, au_id: str, fact_id: str, new_status: str) -> None:
        """更新事实状态。"""
        ...
