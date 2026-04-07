# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""Tokenizer 路由 + LRU Cache 单元测试。"""

from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import patch

import pytest

from core.domain.tokenizer import TokenCount, clear_tokenizer_cache, count_tokens

# tiktoken 可能在某些环境不可用（离线/网络问题）
_tiktoken_available = False
try:
    import tiktoken
    tiktoken.get_encoding("cl100k_base")
    _tiktoken_available = True
except Exception:
    pass

_requires_tiktoken = pytest.mark.skipif(
    not _tiktoken_available, reason="tiktoken 不可用（离线环境）"
)


@dataclass
class _FakeLLM:
    mode: str = "api"
    model: str = "deepseek-chat"
    local_model_path: str = ""


# ===== count_tokens 基础 =====


@_requires_tiktoken
def test_api_mode_english():
    """API 模式 + 英文文本 → 正整数（需要 tiktoken）。"""
    result = count_tokens("Hello, world!", _FakeLLM(mode="api"))
    assert result.count > 0
    assert result.is_estimate is False


@_requires_tiktoken
def test_api_mode_chinese():
    """API 模式 + 中文文本 → 正整数（且大于等长英文文本）。"""
    en = count_tokens("abcdef", _FakeLLM(mode="api"))
    zh = count_tokens("你好世界测试吧", _FakeLLM(mode="api"))
    assert zh.count > 0
    assert zh.count >= en.count  # 中文 token 密度更高


def test_api_mode_empty():
    """API 模式 + 空字符串 → 返回 0。"""
    result = count_tokens("", _FakeLLM(mode="api"))
    assert result.count == 0
    assert result.is_estimate is False


@_requires_tiktoken
def test_ollama_mode_same_as_api():
    """Ollama 模式 → 与 API 模式一致（都用 tiktoken）。"""
    text = "测试文本 test"
    api_result = count_tokens(text, _FakeLLM(mode="api"))
    ollama_result = count_tokens(text, _FakeLLM(mode="ollama"))
    assert api_result.count == ollama_result.count


@_requires_tiktoken
def test_local_mode_no_tokenizer_json(tmp_path):
    """Local 模式 + 无 tokenizer.json → 降级为 tiktoken。"""
    result = count_tokens("test text", _FakeLLM(mode="local", local_model_path=str(tmp_path)))
    assert result.count > 0
    assert result.is_estimate is False


def test_fallback_char_mul1_5():
    """tiktoken 加载失败 → fallback 为 char_mul1.5 估算。"""
    clear_tokenizer_cache()
    with patch("core.domain.tokenizer._get_tiktoken_encoding", side_effect=RuntimeError("no tiktoken")):
        result = count_tokens("测试文本", _FakeLLM(mode="api"))
        assert result.count == int(len("测试文本") * 1.5)
        assert result.is_estimate is True
    clear_tokenizer_cache()


# ===== LRU Cache =====


@_requires_tiktoken
def test_cache_hit():
    """连续两次调用同一模型 → tokenizer 实例缓存命中。"""
    clear_tokenizer_cache()
    from core.domain.tokenizer import _get_tiktoken_encoding
    _get_tiktoken_encoding("cl100k_base")
    info1 = _get_tiktoken_encoding.cache_info()
    _get_tiktoken_encoding("cl100k_base")
    info2 = _get_tiktoken_encoding.cache_info()
    assert info2.hits > info1.hits
    clear_tokenizer_cache()


@_requires_tiktoken
def test_clear_cache():
    """clear_tokenizer_cache() 后 → 缓存已清空。"""
    from core.domain.tokenizer import _get_tiktoken_encoding
    _get_tiktoken_encoding("cl100k_base")
    clear_tokenizer_cache()
    info = _get_tiktoken_encoding.cache_info()
    assert info.currsize == 0
