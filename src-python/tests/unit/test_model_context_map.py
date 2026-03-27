"""Model Context Map + get_context_window + get_model_max_output 单元测试。"""

from __future__ import annotations

from dataclasses import dataclass

from core.domain.model_context_map import (
    DEFAULT_CONTEXT_WINDOW,
    DEFAULT_MAX_OUTPUT,
    get_context_window,
    get_model_max_output,
)


@dataclass
class _FakeLLM:
    mode: str = "api"
    model: str = ""
    context_window: int = 0


@dataclass
class _FakeProject:
    llm: _FakeLLM


# ===== get_context_window =====


def test_context_window_manual_override():
    """project.yaml 手动填写 context_window=8192 → 返回 8192。"""
    project = _FakeProject(llm=_FakeLLM(context_window=8192))
    assert get_context_window(project) == 8192


def test_context_window_zero_uses_map():
    """context_window=0 → 走映射表。"""
    project = _FakeProject(llm=_FakeLLM(model="deepseek-chat", context_window=0))
    assert get_context_window(project) == 65_536


def test_context_window_zero_unknown_model():
    """context_window=0 + 未知模型 → 32000。"""
    project = _FakeProject(llm=_FakeLLM(model="unknown-model", context_window=0))
    assert get_context_window(project) == DEFAULT_CONTEXT_WINDOW


def test_context_window_exact_match():
    """精确匹配："deepseek-chat" → 65536。"""
    project = _FakeProject(llm=_FakeLLM(model="deepseek-chat"))
    assert get_context_window(project) == 65_536


def test_context_window_fuzzy_match():
    """模糊匹配："deepseek-chat-v2" → 65536（前缀匹配）。"""
    project = _FakeProject(llm=_FakeLLM(model="deepseek-chat-v2"))
    assert get_context_window(project) == 65_536


def test_context_window_fuzzy_match_claude():
    """模糊匹配："claude-3-5-sonnet-20241022" → 200000。"""
    project = _FakeProject(llm=_FakeLLM(model="claude-3-5-sonnet-20241022"))
    assert get_context_window(project) == 200_000


# ===== get_model_max_output =====


def test_max_output_known_model():
    """已知模型 → 返回对应值。"""
    assert get_model_max_output("deepseek-chat") == 8_192
    assert get_model_max_output("gpt-4o") == 4_096


def test_max_output_unknown_model():
    """未知模型 → 4096。"""
    assert get_model_max_output("unknown-model") == DEFAULT_MAX_OUTPUT


def test_max_output_fuzzy():
    """模糊匹配。"""
    assert get_model_max_output("deepseek-chat-v2") == 8_192
