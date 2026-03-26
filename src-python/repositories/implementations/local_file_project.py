"""LocalFileProjectRepository — 本地文件系统项目配置存储实现骨架。

project.yaml 读写。
实际逻辑待后续任务实现。
"""

from __future__ import annotations

from core.domain.project import Project
from repositories.interfaces.project_repository import ProjectRepository


class LocalFileProjectRepository(ProjectRepository):
    """基于本地文件系统的项目配置存储（project.yaml）。"""

    async def get(self, au_id: str) -> Project:
        raise NotImplementedError

    async def save(self, project: Project) -> None:
        raise NotImplementedError

    async def list_aus(self, fandom: str) -> list[Project]:
        raise NotImplementedError
