"""ProjectRepository 抽象接口。

管理 AU 项目配置（project.yaml）的读写。
参见 PRD §2.6.1 中 LocalFileProjectRepository。
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class ProjectRepository(ABC):
    """项目配置存储抽象接口。"""

    @abstractmethod
    async def get(self, au_id: str) -> dict[str, Any]:
        """读取 AU 项目配置。"""
        ...

    @abstractmethod
    async def save(self, au_id: str, config: dict[str, Any]) -> None:
        """保存 AU 项目配置。"""
        ...

    @abstractmethod
    async def list_aus(self, fandom_id: str) -> list[dict[str, Any]]:
        """列出 Fandom 下所有 AU。"""
        ...
