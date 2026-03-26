"""LocalFileStateRepository — 本地文件系统运行时状态存储实现骨架。

state.yaml 读写。
实际逻辑待后续任务实现。
"""

from __future__ import annotations

from core.domain.state import State
from repositories.interfaces.state_repository import StateRepository


class LocalFileStateRepository(StateRepository):
    """基于本地文件系统的运行时状态存储（state.yaml）。"""

    async def get(self, au_id: str) -> State:
        raise NotImplementedError

    async def save(self, state: State) -> None:
        raise NotImplementedError
