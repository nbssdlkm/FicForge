"""LocalFileFactRepository — 本地文件系统事实表存储实现骨架。

facts.jsonl append-only（D-0003）。
实际逻辑待后续任务实现。
"""

from __future__ import annotations

from core.domain.enums import FactStatus
from core.domain.fact import Fact
from repositories.interfaces.fact_repository import FactRepository


class LocalFileFactRepository(FactRepository):
    """基于本地文件系统的事实表存储（facts.jsonl）。"""

    async def append(self, au_id: str, fact: Fact) -> None:
        raise NotImplementedError

    async def get(self, au_id: str, fact_id: str) -> Fact:
        raise NotImplementedError

    async def list_all(self, au_id: str) -> list[Fact]:
        raise NotImplementedError

    async def list_by_status(self, au_id: str, status: FactStatus) -> list[Fact]:
        raise NotImplementedError

    async def list_by_chapter(self, au_id: str, chapter_num: int) -> list[Fact]:
        raise NotImplementedError

    async def update(self, au_id: str, fact: Fact) -> None:
        raise NotImplementedError

    async def delete_by_chapter(self, au_id: str, chapter_num: int) -> None:
        raise NotImplementedError
