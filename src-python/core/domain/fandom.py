# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""Fandom 领域对象。参见 PRD §3.2 fandom.yaml。"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class Fandom:
    """Fandom 元信息。"""

    name: str = ""
    created_at: str = ""                        # ISO 8601
    core_characters: list[str] = field(default_factory=list)
    wiki_source: str = ""                       # 可选
