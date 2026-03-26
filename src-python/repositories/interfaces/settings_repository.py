"""SettingsRepository 抽象接口。

管理全局配置（settings.yaml）的读写。
参见 PRD §3.3。
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from core.domain.settings import Settings


class SettingsRepository(ABC):
    """全局配置存储抽象接口。"""

    @abstractmethod
    async def get(self) -> Settings:
        """读取全局配置。"""
        ...

    @abstractmethod
    async def save(self, settings: Settings) -> None:
        """保存全局配置。"""
        ...
