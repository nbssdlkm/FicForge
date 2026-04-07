# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""生成引擎集成测试（使用真实 DraftRepository）。"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from unittest.mock import MagicMock, patch

from core.services.generation import generate_chapter
from infra.llm.provider import LLMChunk
from infra.storage_local.directory import ensure_au_directories
from repositories.implementations.local_file_draft import LocalFileDraftRepository


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
class _FakeSettings:
    default_llm: _FakeLLM = field(default_factory=_FakeLLM)
    model_params: dict = field(default_factory=dict)

@dataclass
class _FakeState:
    current_chapter: int = 1
    chapter_focus: list = field(default_factory=list)
    last_scene_ending: str = ""
    characters_last_seen: dict = field(default_factory=dict)


def test_full_generation_with_real_draft_repo(tmp_path):
    """完整生成 → 真实草稿文件写入。"""
    au = tmp_path / "test_au"
    ensure_au_directories(au)

    chunks = [
        LLMChunk(delta="林深走进咖啡馆", is_final=False),
        LLMChunk(delta="。陈明正在擦杯子。", is_final=True, output_tokens=30),
    ]
    mock_provider = MagicMock()
    mock_provider.generate.return_value = iter(chunks)

    mock_chapter_repo = MagicMock()
    mock_chapter_repo.get_content_only.side_effect = FileNotFoundError

    draft_repo = LocalFileDraftRepository()

    with patch("core.services.generation.create_provider", return_value=mock_provider):
        events = list(generate_chapter(
            au_path=au, chapter_num=1,
            user_input="开始", input_type="continue",
            session_llm=None, session_params=None,
            project=_FakeProject(), state=_FakeState(), settings=_FakeSettings(),
            facts=[], chapter_repo=mock_chapter_repo, draft_repo=draft_repo,
        ))

    # 验证事件
    token_events = [e for e in events if e["event"] == "token"]
    done_events = [e for e in events if e["event"] == "done"]
    assert len(token_events) == 2
    assert len(done_events) == 1

    # 验证草稿文件实际写入
    draft_path = au / "chapters" / ".drafts" / "ch0001_draft_A.md"
    assert draft_path.exists()

    # 读回验证
    loaded = draft_repo.get(str(au), 1, "A")
    assert "林深走进咖啡馆" in loaded.content
    assert "陈明正在擦杯子" in loaded.content
