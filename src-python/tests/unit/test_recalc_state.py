"""重算全局状态单元测试。"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import frontmatter
import pytest

from core.services.recalc_state import recalc_state


@dataclass
class _FakeCastRegistry:
    characters: list[str] = field(default_factory=list)


@dataclass
class _FakeProject:
    cast_registry: _FakeCastRegistry = field(default_factory=_FakeCastRegistry)


class _FakeProjectRepo:
    def __init__(self, project=None):
        self._project = project or _FakeProject()

    def get(self, au_id: str):
        return self._project


@dataclass
class _FakeChapter:
    chapter_num: int
    content: str
    confirmed_focus: list[str] = field(default_factory=list)


class _FakeChapterRepo:
    def __init__(self, chapters=None):
        self._chapters = chapters or []

    def list_main(self, au_id: str):
        return self._chapters


class _FakeState:
    def __init__(self):
        self.au_id = ""
        self.characters_last_seen: dict[str, int] = {}
        self.last_scene_ending: str = ""
        self.last_confirmed_chapter_focus: list[str] = []
        self.revision: int = 0
        self.updated_at: str = ""

    def __getattr__(self, name: str) -> Any:
        # 兜底其他 state 字段
        return getattr(super(), name, None)


class _FakeStateRepo:
    def __init__(self):
        self.saved_state = None

    def get(self, au_id: str):
        s = _FakeState()
        s.au_id = au_id
        return s

    def save(self, state):
        self.saved_state = state


class TestRecalcState:
    def test_no_chapters(self, tmp_path: Path):
        state_repo = _FakeStateRepo()
        result = recalc_state(
            tmp_path, state_repo, _FakeChapterRepo([]), _FakeProjectRepo()
        )
        assert result["chapters_scanned"] == 0
        assert result["characters_last_seen"] == {}
        assert result["last_scene_ending"] == ""
        assert result["last_confirmed_chapter_focus"] == []
        assert state_repo.saved_state is not None

    def test_normal_scan(self, tmp_path: Path):
        chapters = [
            _FakeChapter(1, "林深走进了咖啡馆。陈明在吧台擦杯子。"),
            _FakeChapter(2, "林深点了一杯咖啡。"),
            _FakeChapter(3, "陈明说了一句话。最后一章结尾内容。", confirmed_focus=["f1"]),
        ]
        project = _FakeProject(cast_registry=_FakeCastRegistry(characters=["林深", "陈明"]))
        state_repo = _FakeStateRepo()

        result = recalc_state(
            tmp_path, state_repo, _FakeChapterRepo(chapters), _FakeProjectRepo(project)
        )

        assert result["chapters_scanned"] == 3
        assert result["characters_last_seen"]["林深"] == 2
        assert result["characters_last_seen"]["陈明"] == 3
        assert "最后一章结尾" in result["last_scene_ending"]
        assert result["last_confirmed_chapter_focus"] == ["f1"]

    def test_empty_cast_registry(self, tmp_path: Path):
        chapters = [_FakeChapter(1, "角色A和角色B在对话。")]
        state_repo = _FakeStateRepo()

        result = recalc_state(
            tmp_path, state_repo, _FakeChapterRepo(chapters), _FakeProjectRepo()
        )
        assert result["chapters_scanned"] == 1
        assert result["characters_last_seen"] == {}

    def test_missing_chapter_content(self, tmp_path: Path):
        chapters = [
            _FakeChapter(1, "正常内容。"),
            _FakeChapter(2, ""),  # 空内容
        ]
        state_repo = _FakeStateRepo()

        result = recalc_state(
            tmp_path, state_repo, _FakeChapterRepo(chapters), _FakeProjectRepo()
        )
        # 空内容跳过
        assert result["chapters_scanned"] == 1

    def test_state_written_back(self, tmp_path: Path):
        chapters = [_FakeChapter(1, "测试内容。", confirmed_focus=["f99"])]
        state_repo = _FakeStateRepo()

        recalc_state(tmp_path, state_repo, _FakeChapterRepo(chapters), _FakeProjectRepo())

        assert state_repo.saved_state is not None
        assert state_repo.saved_state.last_confirmed_chapter_focus == ["f99"]
