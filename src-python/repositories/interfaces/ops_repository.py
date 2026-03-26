"""OpsRepository 抽象接口。

ops.jsonl 是业务关键依赖（D-0010），用于 undo/dirty/同步。
Append-only 写入，并发写入必须使用 filelock。
参见 PRD §2.6.4、DECISIONS D-0010。
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from core.domain.ops_entry import OpsEntry


class OpsRepository(ABC):
    """操作日志存储抽象接口（append-only）。"""

    @abstractmethod
    async def append(self, au_id: str, entry: OpsEntry) -> None:
        """追加一条操作日志。"""
        ...

    @abstractmethod
    async def list_all(self, au_id: str) -> list[OpsEntry]:
        """列出 AU 下所有操作日志。"""
        ...

    @abstractmethod
    async def list_by_target(self, au_id: str, target_id: str) -> list[OpsEntry]:
        """按操作目标筛选日志。"""
        ...

    @abstractmethod
    async def list_by_chapter(self, au_id: str, chapter_num: int) -> list[OpsEntry]:
        """按关联章节筛选日志。"""
        ...
