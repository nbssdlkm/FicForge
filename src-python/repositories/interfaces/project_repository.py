"""ProjectRepository 抽象接口。

管理 AU 项目配置（project.yaml）的读写。
参见 PRD §3.4。
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from core.domain.project import Project


class ProjectRepository(ABC):
    """项目配置存储抽象接口。"""

    @abstractmethod
    def get(self, au_id: str) -> Project:
        """读取 AU 项目配置。"""
        ...

    @abstractmethod
    def save(self, project: Project) -> None:
        """保存 AU 项目配置。"""
        ...

    @abstractmethod
    def list_aus(self, fandom: str) -> list[Project]:
        """列出 Fandom 下所有 AU 的项目配置。"""
        ...
