"""FandomRepository 抽象接口。

管理 Fandom 元信息（fandom.yaml）的读写。
参见 PRD §3.2。
"""

from __future__ import annotations

from abc import ABC, abstractmethod

from core.domain.fandom import Fandom


class FandomRepository(ABC):
    """Fandom 元信息存储抽象接口。"""

    @abstractmethod
    def get(self, fandom_path: str) -> Fandom:
        """读取 fandom.yaml。文件不存在时抛出 FileNotFoundError。"""
        ...

    @abstractmethod
    def save(self, fandom_path: str, fandom: Fandom) -> None:
        """保存 fandom.yaml。"""
        ...

    @abstractmethod
    def list_fandoms(self, data_dir: str) -> list[str]:
        """列出所有 Fandom 目录名。"""
        ...

    @abstractmethod
    def list_aus(self, fandom_path: str) -> list[str]:
        """列出 Fandom 下所有 AU 目录名。"""
        ...
