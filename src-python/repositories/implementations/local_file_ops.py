"""LocalFileOpsRepository — 本地文件系统操作日志存储实现骨架。

ops.jsonl append-only，并发写入必须使用 filelock（D-0010）。
实际逻辑待后续任务实现。
"""

from __future__ import annotations

from core.domain.ops_entry import OpsEntry
from repositories.interfaces.ops_repository import OpsRepository


class LocalFileOpsRepository(OpsRepository):
    """基于本地文件系统的操作日志存储（ops.jsonl）。"""

    async def append(self, au_id: str, entry: OpsEntry) -> None:
        raise NotImplementedError

    async def list_all(self, au_id: str) -> list[OpsEntry]:
        raise NotImplementedError

    async def list_by_target(self, au_id: str, target_id: str) -> list[OpsEntry]:
        raise NotImplementedError

    async def list_by_chapter(self, au_id: str, chapter_num: int) -> list[OpsEntry]:
        raise NotImplementedError
