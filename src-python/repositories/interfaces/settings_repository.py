# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

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
    def get(self) -> Settings:
        """读取全局配置。"""
        ...

    @abstractmethod
    def save(self, settings: Settings) -> None:
        """保存全局配置。"""
        ...
