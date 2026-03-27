"""上下文组装器集成测试。"""

from dataclasses import dataclass, field
from pathlib import Path

import pytest

from core.domain.budget_report import BudgetReport
from core.domain.enums import FactStatus, FactType, NarrativeWeight
from core.domain.fact import Fact
from core.services.context_assembler import assemble_context
from infra.storage_local.directory import ensure_au_directories
from repositories.implementations.local_file_chapter import LocalFileChapterRepository
from core.domain.chapter import Chapter
from infra.storage_local.file_utils import compute_content_hash


@dataclass
class _FakeWS:
    perspective: str = "third_person"
    pov_character: str = ""
    emotion_style: str = "implicit"
    custom_instructions: str = ""


@dataclass
class _FakeLLM:
    mode: str = "api"
    model: str = "deepseek-chat"
    context_window: int = 65536


@dataclass
class _FakeProject:
    llm: _FakeLLM = field(default_factory=_FakeLLM)
    writing_style: _FakeWS = field(default_factory=_FakeWS)
    pinned_context: list = field(default_factory=list)
    chapter_length: int = 1500
    core_always_include: list = field(default_factory=list)
    core_guarantee_budget: int = 400


@dataclass
class _FakeState:
    current_chapter: int = 1
    chapter_focus: list = field(default_factory=list)
    last_scene_ending: str = ""
    characters_last_seen: dict = field(default_factory=dict)


def _make_fact(fid, status="active", chapter=1, weight="medium", content="测试"):
    return Fact(
        id=fid, content_raw=content, content_clean=content,
        chapter=chapter, status=FactStatus(status), type=FactType.PLOT_EVENT,
        narrative_weight=NarrativeWeight(weight),
        revision=1, created_at="", updated_at="",
    )


def test_assemble_returns_messages_and_budget(tmp_path):
    """返回 messages + max_tokens + budget_report。"""
    au = tmp_path / "au"
    ensure_au_directories(au)
    repo = LocalFileChapterRepository()

    result = assemble_context(
        _FakeProject(), _FakeState(), "继续", [],
        repo, au,
    )

    assert "messages" in result
    assert "max_tokens" in result
    assert "budget_report" in result
    msgs = result["messages"]
    assert len(msgs) == 2
    assert msgs[0]["role"] == "system"
    assert msgs[1]["role"] == "user"
    assert isinstance(result["budget_report"], BudgetReport)


def test_assemble_budget_formula(tmp_path):
    """budget = context_window * 0.60 - system_tokens。"""
    au = tmp_path / "au"
    ensure_au_directories(au)

    result = assemble_context(
        _FakeProject(llm=_FakeLLM(context_window=10000)),
        _FakeState(), "继续", [],
        LocalFileChapterRepository(), au,
    )

    report = result["budget_report"]
    assert report.context_window == 10000
    expected_budget = int(10000 * 0.60) - report.system_tokens
    assert report.budget_remaining <= expected_budget


def test_assemble_max_tokens(tmp_path):
    """max_tokens = min(model_max_output, context_window*0.40)。"""
    au = tmp_path / "au"
    ensure_au_directories(au)

    result = assemble_context(
        _FakeProject(llm=_FakeLLM(model="deepseek-chat", context_window=65536)),
        _FakeState(), "继续", [],
        LocalFileChapterRepository(), au,
    )

    # deepseek-chat max_output=8192, context*0.40=26214
    assert result["max_tokens"] == 8192


def test_assemble_zero_chapter_cold_start(tmp_path):
    """零章节冷启动 → 正常返回。"""
    au = tmp_path / "au"
    ensure_au_directories(au)

    result = assemble_context(
        _FakeProject(), _FakeState(current_chapter=1), "开始创作", [],
        LocalFileChapterRepository(), au,
    )

    assert result["messages"][1]["role"] == "user"
    assert "开始创作" in result["messages"][1]["content"]


def test_assemble_with_facts_and_chapter(tmp_path):
    """有 facts + 有章节 → 各层正确注入。"""
    au = tmp_path / "au"
    ensure_au_directories(au)
    repo = LocalFileChapterRepository()

    # 写入一个已确认章节
    ch = Chapter(
        au_id=str(au), chapter_num=1, content="第一章正文内容。林深走进咖啡馆。",
        chapter_id="ch1", revision=1, confirmed_at="2025-01-01T00:00:00Z",
        content_hash=compute_content_hash("第一章正文内容。林深走进咖啡馆。"),
    )
    repo.save(ch)

    facts = [
        _make_fact("f1", status="active", content="林深在咖啡馆工作"),
        _make_fact("f2", status="unresolved", content="那句没说完的话"),
    ]

    result = assemble_context(
        _FakeProject(), _FakeState(current_chapter=2, chapter_focus=["f2"]),
        "让陈明出场", facts,
        repo, au,
    )

    user_content = result["messages"][1]["content"]
    # P1: 用户输入
    assert "让陈明出场" in user_content
    # P3: facts (f1 in P3, f2 in P1 not P3)
    assert "林深在咖啡馆工作" in user_content
    # P2: 最近章节
    assert "林深走进咖啡馆" in user_content
    # P1 focus
    assert "那句没说完的话" in user_content


def test_assemble_system_prompt_too_long_raises(tmp_path):
    """system_prompt 过长 → raise ValueError。"""
    au = tmp_path / "au"
    ensure_au_directories(au)

    # 极小 context window + 长 pinned
    project = _FakeProject(
        llm=_FakeLLM(context_window=100),
        pinned_context=["长规则" * 100],
    )

    with pytest.raises(ValueError, match="system_prompt_exceeds_budget"):
        assemble_context(project, _FakeState(), "x", [], LocalFileChapterRepository(), au)
