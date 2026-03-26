"""OpsRepository 抽象接口。

ops.jsonl 是业务关键依赖（D-0010），用于 undo/dirty/同步。
严格 append-only——永不修改或删除现有条目。
参见 PRD §2.6.5、DECISIONS D-0010、D-0021。

⚠️ 所有方法为同步（def，非 async def）——filelock 是阻塞操作，
FastAPI 路由调用时须通过 run_in_threadpool 包装（D-0021）。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Optional

from core.domain.ops_entry import OpsEntry


class OpsRepository(ABC):
    """操作日志存储抽象接口（严格 append-only）。"""

    @abstractmethod
    def append(self, au_id: str, entry: OpsEntry) -> None:
        """追加一条操作日志。"""
        ...

    @abstractmethod
    def list_all(self, au_id: str) -> list[OpsEntry]:
        """列出 AU 下所有操作日志。"""
        ...

    @abstractmethod
    def list_by_target(self, au_id: str, target_id: str) -> list[OpsEntry]:
        """按操作目标筛选日志。"""
        ...

    @abstractmethod
    def list_by_chapter(self, au_id: str, chapter_num: int) -> list[OpsEntry]:
        """按关联章节筛选日志。"""
        ...

    @abstractmethod
    def get_by_op_type(self, au_id: str, op_type: str) -> list[OpsEntry]:
        """返回指定类型的所有操作记录。"""
        ...

    @abstractmethod
    def get_confirm_for_chapter(
        self, au_id: str, chapter_num: int
    ) -> Optional[OpsEntry]:
        """返回该章节的 confirm_chapter 记录（undo 步骤 6/7 用）。

        读取 payload 中的 last_scene_ending_snapshot / characters_last_seen_snapshot。
        """
        ...

    @abstractmethod
    def get_add_facts_for_chapter(
        self, au_id: str, chapter_num: int
    ) -> list[OpsEntry]:
        """返回 chapter_num==N 且 op_type=="add_fact" 的记录（undo 步骤 4 用）。"""
        ...

    @abstractmethod
    def get_latest_by_type(self, au_id: str, op_type: str) -> Optional[OpsEntry]:
        """返回指定类型的最新一条记录（按文件顺序）。"""
        ...
