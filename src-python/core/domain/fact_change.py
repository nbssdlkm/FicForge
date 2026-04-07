# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""Dirty 章节解除时的 Facts 变更指令。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class FactChange:
    """用户在 facts 确认面板上对单条 fact 的操作指令。

    action 取值：
    - "keep": 保留，无变更
    - "update": 修改字段（updated_fields 必须非空）
    - "deprecate": 标记为 deprecated（不物理删除，D-0003）
    """

    fact_id: str
    action: str  # "keep" | "update" | "deprecate"
    updated_fields: Optional[dict[str, Any]] = None
