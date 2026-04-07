# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""Facts 生命周期单元测试。"""

import pytest

from core.domain.enums import FactSource, FactStatus, FactType
from core.domain.fact import Fact
from core.services.facts_lifecycle import _normalize_characters


def test_normalize_aliases():
    """别名归一化：公子 → 达达利亚。"""
    chars = ["公子", "林深"]
    aliases = {"达达利亚": ["公子", "阿贾克斯"]}
    result = _normalize_characters(chars, aliases)
    assert result == ["达达利亚", "林深"]


def test_normalize_deduplicates():
    """别名归一化后去重。"""
    chars = ["公子", "达达利亚"]
    aliases = {"达达利亚": ["公子"]}
    result = _normalize_characters(chars, aliases)
    assert result == ["达达利亚"]


def test_normalize_no_aliases():
    """无别名时原样返回。"""
    result = _normalize_characters(["林深", "陈明"], {})
    assert result == ["林深", "陈明"]
