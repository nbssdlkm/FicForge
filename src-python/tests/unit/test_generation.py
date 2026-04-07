# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""生成引擎单元测试。"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from core.services.generation import is_empty_intent, _next_draft_label, generate_chapter, _generating


# ===== is_empty_intent =====

def test_empty_intent_continue():
    assert is_empty_intent("继续") is True

def test_empty_intent_then():
    assert is_empty_intent("然后呢") is True

def test_empty_intent_empty():
    assert is_empty_intent("") is True

def test_empty_intent_short():
    assert is_empty_intent("嗯") is True

def test_empty_intent_real_instruction():
    assert is_empty_intent("让林深道歉") is False

def test_empty_intent_english():
    assert is_empty_intent("continue") is True


# ===== _next_draft_label =====

def test_label_no_existing():
    assert _next_draft_label([]) == "A"

def test_label_has_a():
    assert _next_draft_label(["A"]) == "B"

def test_label_has_a_b():
    assert _next_draft_label(["A", "B"]) == "C"

def test_label_gap():
    assert _next_draft_label(["A", "C"]) == "B"


# ===== generate_chapter with mocks =====

@dataclass
class _FakeWS:
    perspective: str = "third_person"
    pov_character: str = ""
    emotion_style: str = "implicit"
    custom_instructions: str = ""

@dataclass
class _FakeLLM:
    mode: str = "api"
    model: str = "test-model"
    api_base: str = "https://test.com"
    api_key: str = "sk-test"
    context_window: int = 10000

@dataclass
class _FakeProject:
    llm: _FakeLLM = field(default_factory=_FakeLLM)
    writing_style: _FakeWS = field(default_factory=_FakeWS)
    pinned_context: list = field(default_factory=list)
    chapter_length: int = 1500
    core_always_include: list = field(default_factory=list)
    core_guarantee_budget: int = 400
    model_params_override: dict = field(default_factory=dict)

@dataclass
class _FakeState:
    current_chapter: int = 1
    chapter_focus: list = field(default_factory=list)
    last_scene_ending: str = ""
    characters_last_seen: dict = field(default_factory=dict)

@dataclass
class _FakeSettings:
    default_llm: _FakeLLM = field(default_factory=_FakeLLM)
    model_params: dict = field(default_factory=dict)


def _make_mock_provider(chunks=None):
    """Create a mock provider that returns fake chunks."""
    from infra.llm.provider import LLMChunk
    if chunks is None:
        chunks = [
            LLMChunk(delta="第一章", is_final=False),
            LLMChunk(delta="正文内容", is_final=False),
            LLMChunk(delta="。", is_final=True, output_tokens=50, finish_reason="stop"),
        ]

    provider = MagicMock()
    provider.generate.return_value = iter(chunks)
    return provider


def _make_mock_draft_repo():
    repo = MagicMock()
    repo.list_by_chapter.return_value = []
    repo.save.return_value = None
    return repo


def _make_mock_chapter_repo():
    repo = MagicMock()
    repo.get_content_only.side_effect = FileNotFoundError
    return repo


def test_generate_full_flow(tmp_path):
    """完整流程：yield token → done。"""
    mock_provider = _make_mock_provider()

    with patch("core.services.generation.create_provider", return_value=mock_provider):
        events = list(generate_chapter(
            au_path=tmp_path,
            chapter_num=1,
            user_input="继续",
            input_type="continue",
            session_llm=None,
            session_params=None,
            project=_FakeProject(),
            state=_FakeState(),
            settings=_FakeSettings(),
            facts=[],
            chapter_repo=_make_mock_chapter_repo(),
            draft_repo=_make_mock_draft_repo(),
        ))

    token_events = [e for e in events if e["event"] == "token"]
    done_events = [e for e in events if e["event"] == "done"]
    assert len(token_events) == 3
    assert len(done_events) == 1
    assert done_events[0]["data"]["draft_label"] == "A"
    assert "generated_with" in done_events[0]["data"]


def test_generate_writes_draft(tmp_path):
    """草稿已写入。"""
    mock_draft_repo = _make_mock_draft_repo()
    mock_provider = _make_mock_provider()

    with patch("core.services.generation.create_provider", return_value=mock_provider):
        list(generate_chapter(
            tmp_path, 1, "继续", "continue", None, None,
            _FakeProject(), _FakeState(), _FakeSettings(), [],
            _make_mock_chapter_repo(), mock_draft_repo,
        ))

    mock_draft_repo.save.assert_called_once()
    saved_draft = mock_draft_repo.save.call_args[0][0]
    assert saved_draft.content == "第一章正文内容。"
    assert saved_draft.variant == "A"


def test_generate_409_idempotent(tmp_path):
    """同一章节同时生成 → 409。"""
    from core.services.generation import _generating
    key = f"{tmp_path}:1"
    _generating[key] = True

    try:
        events = list(generate_chapter(
            tmp_path, 1, "继续", "continue", None, None,
            _FakeProject(), _FakeState(), _FakeSettings(), [],
            _make_mock_chapter_repo(), _make_mock_draft_repo(),
        ))
        assert len(events) == 1
        assert events[0]["event"] == "error"
        assert events[0]["data"]["error_code"] == "GENERATION_IN_PROGRESS"
    finally:
        _generating.pop(key, None)


def test_generate_409_clears_after_completion(tmp_path):
    """第一次完成后 → 第二次可正常生成。"""
    mock_provider = _make_mock_provider()

    with patch("core.services.generation.create_provider", return_value=mock_provider):
        # 第一次生成
        events1 = list(generate_chapter(
            tmp_path, 1, "继续", "continue", None, None,
            _FakeProject(), _FakeState(), _FakeSettings(), [],
            _make_mock_chapter_repo(), _make_mock_draft_repo(),
        ))
    assert any(e["event"] == "done" for e in events1)

    # 第二次生成（应该正常，不报 409）
    mock_provider2 = _make_mock_provider()
    with patch("core.services.generation.create_provider", return_value=mock_provider2):
        events2 = list(generate_chapter(
            tmp_path, 1, "继续", "continue", None, None,
            _FakeProject(), _FakeState(), _FakeSettings(), [],
            _make_mock_chapter_repo(), _make_mock_draft_repo(),
        ))
    assert any(e["event"] == "done" for e in events2)
    assert not any(e["event"] == "error" and e["data"]["error_code"] == "GENERATION_IN_PROGRESS" for e in events2)


def test_generate_stream_error_saves_partial(tmp_path):
    """流式中断 → 部分文本保留为草稿。"""
    from infra.llm.provider import LLMChunk, LLMError

    def _failing_stream():
        yield LLMChunk(delta="部分")
        yield LLMChunk(delta="文本")
        raise LLMError(error_code="network_error", message="连接中断", actions=["retry"])

    mock_provider = MagicMock()
    mock_provider.generate.return_value = _failing_stream()
    mock_draft_repo = _make_mock_draft_repo()

    with patch("core.services.generation.create_provider", return_value=mock_provider):
        events = list(generate_chapter(
            tmp_path, 1, "继续", "continue", None, None,
            _FakeProject(), _FakeState(), _FakeSettings(), [],
            _make_mock_chapter_repo(), mock_draft_repo,
        ))

    error_events = [e for e in events if e["event"] == "error"]
    assert len(error_events) == 1
    assert error_events[0]["data"]["error_code"] == "network_error"
    assert error_events[0]["data"]["partial_draft_label"] == "A"

    # 部分草稿已保存
    mock_draft_repo.save.assert_called_once()
    saved = mock_draft_repo.save.call_args[0][0]
    assert saved.content == "部分文本"


def test_generate_context_summary_event(tmp_path):
    """SSE 流在第一个 token 前发送 context_summary 事件（D-0031）。"""
    mock_provider = _make_mock_provider()

    with patch("core.services.generation.create_provider", return_value=mock_provider):
        events = list(generate_chapter(
            au_path=tmp_path,
            chapter_num=1,
            user_input="继续",
            input_type="continue",
            session_llm=None,
            session_params=None,
            project=_FakeProject(pinned_context=["不要道歉"]),
            state=_FakeState(),
            settings=_FakeSettings(),
            facts=[],
            chapter_repo=_make_mock_chapter_repo(),
            draft_repo=_make_mock_draft_repo(),
        ))

    # context_summary 事件存在
    summary_events = [e for e in events if e["event"] == "context_summary"]
    assert len(summary_events) == 1

    # 可解析且包含必要字段
    data = summary_events[0]["data"]
    assert "characters_used" in data
    assert "pinned_count" in data
    assert data["pinned_count"] == 1
    assert "facts_injected" in data
    assert "total_input_tokens" in data
    assert data["total_input_tokens"] > 0

    # context_summary 在第一个 token 之前
    event_types = [e["event"] for e in events]
    cs_idx = event_types.index("context_summary")
    first_token_idx = event_types.index("token")
    assert cs_idx < first_token_idx


def test_generate_session_llm_used(tmp_path):
    """session_llm 有值 → 使用 session_llm 的模型。"""
    mock_provider = _make_mock_provider()

    with patch("core.services.generation.create_provider", return_value=mock_provider) as mock_create:
        list(generate_chapter(
            tmp_path, 1, "继续", "continue",
            session_llm={"mode": "api", "model": "gpt-4o", "api_base": "https://api.openai.com", "api_key": "sk-gpt"},
            session_params=None,
            project=_FakeProject(),
            state=_FakeState(),
            settings=_FakeSettings(),
            facts=[],
            chapter_repo=_make_mock_chapter_repo(),
            draft_repo=_make_mock_draft_repo(),
        ))

    # create_provider should have been called with gpt-4o config
    call_args = mock_create.call_args[0][0]
    assert call_args["model"] == "gpt-4o"
