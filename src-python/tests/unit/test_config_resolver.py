# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""LLM 配置解析器单元测试。"""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest

from infra.llm.config_resolver import create_provider, resolve_llm_config, resolve_llm_params
from infra.llm.local_provider import LocalLLMProvider
from infra.llm.ollama_provider import OllamaProvider
from infra.llm.openai_compatible import OpenAICompatibleProvider


@dataclass
class _FakeLLM:
    mode: str = "api"
    model: str = "deepseek-chat"
    api_base: str = "https://api.deepseek.com"
    api_key: str = "sk-test"


@dataclass
class _FakeProject:
    llm: _FakeLLM = field(default_factory=_FakeLLM)
    model_params_override: dict = field(default_factory=dict)


@dataclass
class _FakeModelParams:
    temperature: float = 0.8
    top_p: float = 0.9


@dataclass
class _FakeSettings:
    default_llm: _FakeLLM = field(default_factory=_FakeLLM)
    model_params: dict = field(default_factory=dict)


# ===== resolve_llm_config =====

def test_config_session_llm_wins():
    """session_llm 有值 → 使用。"""
    cfg = resolve_llm_config(
        {"mode": "api", "model": "gpt-4o", "api_base": "https://api.openai.com", "api_key": "sk-gpt"},
        _FakeProject(), _FakeSettings(),
    )
    assert cfg["model"] == "gpt-4o"


def test_config_fallback_to_project():
    """session 为 None → project.llm。"""
    cfg = resolve_llm_config(None, _FakeProject(), _FakeSettings())
    assert cfg["model"] == "deepseek-chat"


def test_config_fallback_to_settings():
    """project 也为空 → settings。"""
    cfg = resolve_llm_config(
        None,
        _FakeProject(llm=_FakeLLM(model="")),
        _FakeSettings(default_llm=_FakeLLM(model="claude-3")),
    )
    assert cfg["model"] == "claude-3"


def test_config_env_key_override(monkeypatch):
    """环境变量覆盖 api_key。"""
    monkeypatch.setenv("FANFIC_LLM_API_KEY", "env-key-123")
    cfg = resolve_llm_config(None, _FakeProject(), _FakeSettings())
    assert cfg["api_key"] == "env-key-123"


# ===== resolve_llm_params =====

def test_params_session_wins():
    """session_params 有值。"""
    params = resolve_llm_params("model", {"temperature": 0.5, "top_p": 0.8}, _FakeProject(), _FakeSettings())
    assert params["temperature"] == 0.5
    assert params["top_p"] == 0.8


def test_params_project_override():
    """project override。"""
    proj = _FakeProject(model_params_override={"deepseek-chat": {"temperature": 1.3, "top_p": 0.9}})
    params = resolve_llm_params("deepseek-chat", None, proj, _FakeSettings())
    assert params["temperature"] == 1.3


def test_params_settings_memory():
    """settings 记忆值。"""
    settings = _FakeSettings(model_params={"deepseek-chat": _FakeModelParams(temperature=0.8, top_p=0.9)})
    params = resolve_llm_params("deepseek-chat", None, _FakeProject(), settings)
    assert params["temperature"] == 0.8


def test_params_default():
    """全部为空 → 默认值。"""
    params = resolve_llm_params("unknown", None, _FakeProject(), _FakeSettings())
    assert params["temperature"] == 1.0
    assert params["top_p"] == 0.95


# ===== create_provider =====

def test_create_api_provider():
    """mode=api → OpenAICompatibleProvider。"""
    p = create_provider({"mode": "api", "api_base": "x", "api_key": "y", "model": "z"})
    assert isinstance(p, OpenAICompatibleProvider)


def test_create_local_provider():
    """mode=local → LocalLLMProvider。"""
    p = create_provider({"mode": "local"})
    assert isinstance(p, LocalLLMProvider)


def test_create_ollama_provider():
    """mode=ollama → OllamaProvider。"""
    p = create_provider({"mode": "ollama"})
    assert isinstance(p, OllamaProvider)
