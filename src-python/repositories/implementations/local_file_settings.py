"""LocalFileSettingsRepository — 本地文件系统全局配置存储实现骨架。

settings.yaml 读写。
实际逻辑待后续任务实现。
"""

from __future__ import annotations

from core.domain.settings import Settings
from repositories.interfaces.settings_repository import SettingsRepository


class LocalFileSettingsRepository(SettingsRepository):
    """基于本地文件系统的全局配置存储（settings.yaml）。"""

    async def get(self) -> Settings:
        raise NotImplementedError

    async def save(self, settings: Settings) -> None:
        raise NotImplementedError
