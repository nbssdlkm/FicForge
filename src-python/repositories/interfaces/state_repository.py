"""StateRepository 抽象接口。

管理 AU 运行时状态（state.yaml）的读写。
参见 PRD §3.5。
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from core.domain.state import State


class StateRepository(ABC):
    """运行时状态存储抽象接口。"""

    @abstractmethod
    async def get(self, au_id: str) -> State:
        """读取 AU 运行时状态。"""
        ...

    @abstractmethod
    async def save(self, state: State) -> None:
        """保存 AU 运行时状态。"""
        ...
