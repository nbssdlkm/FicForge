"""FactRepository 抽象接口。

Facts 在常规流程中 append-only，仅在章节回滚时允许物理删除。
参见 PRD §2.6.2、§3.6、DECISIONS D-0003。

⚠️ 所有方法为同步（def，非 async def）——filelock 是阻塞操作，
FastAPI 路由调用时须包装在 run_in_threadpool 中。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from core.domain.enums import FactStatus
from core.domain.fact import Fact


class FactRepository(ABC):
    """事实表存储抽象接口。"""

    @abstractmethod
    def append(self, au_id: str, fact: Fact) -> None:
        """追加一条事实记录（append-only，D-0003）。"""
        ...

    @abstractmethod
    def get(self, au_id: str, fact_id: str) -> Optional[Fact]:
        """获取单条事实记录。不存在时返回 None。"""
        ...

    @abstractmethod
    def list_all(self, au_id: str) -> list[Fact]:
        """列出 AU 下所有事实记录。"""
        ...

    @abstractmethod
    def list_by_status(self, au_id: str, status: FactStatus) -> list[Fact]:
        """按状态筛选事实记录。"""
        ...

    @abstractmethod
    def list_by_chapter(self, au_id: str, chapter_num: int) -> list[Fact]:
        """列出指定章节关联的事实记录。"""
        ...

    @abstractmethod
    def list_by_characters(self, au_id: str, character_names: list[str]) -> list[Fact]:
        """返回 characters 列表与传入有交集的 facts。"""
        ...

    @abstractmethod
    def list_unresolved(self, au_id: str) -> list[Fact]:
        """返回 status=unresolved 的 facts（chapter_focus 选择器用）。"""
        ...

    @abstractmethod
    def update(self, au_id: str, fact: Fact) -> None:
        """更新事实记录（自动刷新 updated_at + revision+1）。"""
        ...

    @abstractmethod
    def delete_by_ids(self, au_id: str, fact_ids: list[str]) -> None:
        """按 ID 列表精准删除（仅限 undo 级联回滚时调用，D-0003）。

        ⚠️ 禁止按 chapter 字段删除——chapter 是用户可变字段。
        """
        ...
