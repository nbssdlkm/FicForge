# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

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
    def get(self, au_id: str) -> State:
        """读取 AU 运行时状态。"""
        ...

    @abstractmethod
    def save(self, state: State) -> None:
        """保存 AU 运行时状态。"""
        ...
