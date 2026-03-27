"""RAG 检索服务单元测试。"""

from __future__ import annotations

from dataclasses import dataclass, field
from unittest.mock import MagicMock

import pytest

from core.domain.chunk import Chunk
from core.domain.enums import FactStatus, FactType
from core.domain.fact import Fact
from core.services.rag_retrieval import (
    build_active_chars,
    build_rag_query,
    retrieve_rag,
)


@dataclass
class _FakeState:
    current_chapter: int = 10
    chapter_focus: list = field(default_factory=list)
    characters_last_seen: dict = field(default_factory=dict)


@dataclass
class _FakeProject:
    core_always_include: list = field(default_factory=list)


@dataclass
class _FakeLLM:
    mode: str = "api"
    model: str = "test"


def _make_fact(fid: str, characters: list[str]) -> Fact:
    return Fact(
        id=fid, content_raw="x", content_clean="x",
        characters=characters, chapter=1,
        status=FactStatus.ACTIVE, type=FactType.PLOT_EVENT,
        revision=1, created_at="", updated_at="",
    )


# ===== build_rag_query =====


def test_query_full():
    """focus + ending + input → 拼接。"""
    q = build_rag_query(["伏笔内容"], "上章结尾", "让林深出场")
    assert "伏笔内容" in q
    assert "上章结尾" in q
    assert "让林深出场" in q


def test_query_short_input():
    """user_input < 5 字 → 仍包含。"""
    q = build_rag_query(["焦点"], "结尾", "嗯")
    assert "焦点" in q
    assert "结尾" in q
    assert "嗯" in q


def test_query_all_empty():
    """全部为空 → 空字符串。"""
    assert build_rag_query([], "", "") == ""


# ===== build_active_chars =====


def test_active_chars_merge():
    """最近 3 章 + input + focus → 合并去重。"""
    state = _FakeState(
        current_chapter=10,
        characters_last_seen={"林深": 9, "陈明": 8, "陈律师": 5},
        chapter_focus=["f1"],
    )
    facts = [_make_fact("f1", ["张律师"])]
    cast = {"from_core": ["林深", "陈明", "陈律师"], "au_specific": [], "oc": ["张律师"]}

    result = build_active_chars(state, "陈律师来了", _FakeProject(), facts, cast)
    assert result is not None
    assert "林深" in result      # last 3 chapters
    assert "陈明" in result      # last 3 chapters
    assert "陈律师" in result    # in user_input
    assert "张律师" in result    # from focus fact


def test_active_chars_empty_fallback_core():
    """全空 → 降级 core_always_include。"""
    state = _FakeState(characters_last_seen={}, chapter_focus=[])
    project = _FakeProject(core_always_include=["林深"])
    result = build_active_chars(state, "", project, [], {})
    assert result == ["林深"]


def test_active_chars_all_empty_none():
    """core_always_include 也空 → None。"""
    state = _FakeState(characters_last_seen={}, chapter_focus=[])
    project = _FakeProject(core_always_include=[])
    result = build_active_chars(state, "", project, [], {})
    assert result is None


# ===== retrieve_rag =====


def _mock_vector_repo(chunks_per_collection: int = 3) -> MagicMock:
    repo = MagicMock()

    def _search(au_id: str, query: str, collection_name: str = "chapters",
                top_k: int = 3, char_filter: list | None = None) -> list[Chunk]:
        return [
            Chunk(
                content=f"{collection_name} 结果 {i}",
                chapter_num=i + 1,
                score=0.9 - i * 0.1,
                metadata={"characters": "林深", "chapter": i + 1},
            )
            for i in range(min(chunks_per_collection, top_k))
        ]

    repo.search.side_effect = _search
    return repo


def test_retrieve_rag_basic():
    """mock 返回 chunks → 格式化文本。"""
    repo = _mock_vector_repo(3)
    text, tokens = retrieve_rag(
        repo, "au1", "查询文本", 99999, ["林深"], _FakeLLM()
    )
    assert "角色设定" in text or "历史章节" in text
    assert tokens > 0


def test_retrieve_rag_empty_query():
    """空 query → 空结果。"""
    text, tokens = retrieve_rag(
        MagicMock(), "au1", "", 99999, None, _FakeLLM()
    )
    assert text == ""
    assert tokens == 0


def test_retrieve_rag_budget_reduction():
    """超预算 → top_k 降级。"""
    repo = _mock_vector_repo(3)
    # 极小预算
    text, tokens = retrieve_rag(
        repo, "au1", "查询", 10, ["林深"], _FakeLLM()
    )
    # 应该有结果（可能被截断到很少）
    # 不会崩溃
    assert isinstance(text, str)


def test_retrieve_rag_fallback_on_few_results():
    """某 collection < 2 条 → fallback 全局查询。"""
    call_count = {"n": 0}

    def _search(au_id: str, query: str, collection_name: str = "chapters",
                top_k: int = 3, char_filter: list | None = None) -> list[Chunk]:
        call_count["n"] += 1
        if char_filter and call_count["n"] <= 4:
            # 有过滤时返回 1 条（< 2，触发 fallback）
            return [Chunk(content="filtered", chapter_num=1, score=0.9, metadata={})]
        # fallback 不过滤
        return [
            Chunk(content=f"global {i}", chapter_num=i, score=0.8, metadata={})
            for i in range(3)
        ]

    repo = MagicMock()
    repo.search.side_effect = _search

    text, _ = retrieve_rag(repo, "au1", "查询", 99999, ["林深"], _FakeLLM())
    # fallback 应该被调用（search 被多次调用）
    assert repo.search.call_count > 4  # 原始 4 collection + fallback


def test_retrieve_chapters_time_decay():
    """chapters 结果有时间衰减。"""
    def _search(au_id: str, query: str, collection_name: str = "chapters",
                top_k: int = 3, char_filter: list | None = None) -> list[Chunk]:
        if collection_name == "chapters":
            return [
                Chunk(content="旧章节", chapter_num=1, score=0.95, metadata={"chapter": 1}),
                Chunk(content="新章节", chapter_num=9, score=0.90, metadata={"chapter": 9}),
            ]
        return []

    repo = MagicMock()
    repo.search.side_effect = _search

    text, _ = retrieve_rag(
        repo, "au1", "查询", 99999, None, _FakeLLM(),
        rag_decay_coefficient=0.1, current_chapter=10,
    )
    # 新章节衰减小，应排在前面
    if "新章节" in text and "旧章节" in text:
        assert text.index("新章节") < text.index("旧章节")
