"""Facts 轻量提取单元测试。"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from unittest.mock import MagicMock

import pytest

from core.services.facts_extraction import (
    ExtractedFact,
    _parse_llm_output,
    extract_facts_from_chapter,
)
from infra.llm.provider import LLMResponse


@dataclass
class _FakeLLM:
    mode: str = "api"
    model: str = "test"


def _mock_provider(json_output: list[dict]) -> MagicMock:
    """Mock LLM provider 返回 JSON 文本。"""
    provider = MagicMock()
    provider.generate.return_value = LLMResponse(
        content=json.dumps(json_output, ensure_ascii=False),
        model="test",
    )
    return provider


_SAMPLE_FACTS = [
    {
        "content_raw": "第5章中林深提到手腕有旧疤",
        "content_clean": "林深手腕有一道旧疤",
        "characters": ["林深"],
        "type": "character_detail",
        "narrative_weight": "high",
        "status": "unresolved",
    },
    {
        "content_raw": "第5章陈明说了句没说完的话",
        "content_clean": "陈明有一句没说完的话",
        "characters": ["陈明", "林深"],
        "type": "foreshadowing",
        "narrative_weight": "high",
        "status": "unresolved",
    },
]


# ===== 提取主流程 =====


def test_extract_basic():
    """mock LLM 返回有效 JSON → 解析出 facts。"""
    provider = _mock_provider(_SAMPLE_FACTS)
    results = extract_facts_from_chapter(
        "林深走进咖啡馆，手腕上的旧疤若隐若现。陈明欲言又止。",
        chapter_num=5,
        existing_facts=[],
        cast_registry={"from_core": ["林深", "陈明"], "au_specific": [], "oc": []},
        character_aliases=None,
        llm_provider=provider,
        llm_config=_FakeLLM(),
    )
    assert len(results) == 2
    assert all(isinstance(r, ExtractedFact) for r in results)
    assert results[0].content_clean == "林深手腕有一道旧疤"
    assert results[0].fact_type == "character_detail"


def test_extract_required_fields():
    """每条 fact 包含必须字段。"""
    provider = _mock_provider(_SAMPLE_FACTS)
    results = extract_facts_from_chapter(
        "正文内容。", 5, [], {}, None, provider, _FakeLLM(),
    )
    for r in results:
        assert r.content_raw != ""
        assert r.content_clean != ""
        assert isinstance(r.characters, list)
        assert r.fact_type in ("character_detail", "relationship", "plot_event",
                               "foreshadowing", "backstory", "world_rule")
        assert r.narrative_weight in ("high", "medium", "low")
        assert r.status in ("unresolved", "active")
        assert r.chapter == 5


def test_extract_source_auto():
    """source 自动设为 extract_auto。"""
    provider = _mock_provider(_SAMPLE_FACTS)
    results = extract_facts_from_chapter(
        "正文。", 1, [], {}, None, provider, _FakeLLM(),
    )
    for r in results:
        assert r.source == "extract_auto"


# ===== 解析容错 =====


def test_parse_json_with_code_block():
    """LLM 返回 ```json 包裹 → 正确剥离。"""
    text = '```json\n[{"content_clean": "测试", "content_raw": "测试"}]\n```'
    result = _parse_llm_output(text)
    assert len(result) == 1
    assert result[0]["content_clean"] == "测试"


def test_parse_invalid_json():
    """LLM 返回无效 JSON → 空列表。"""
    assert _parse_llm_output("这不是 JSON") == []


def test_parse_empty_array():
    """LLM 返回空数组。"""
    assert _parse_llm_output("[]") == []


# ===== 后处理 =====


def test_alias_normalization():
    """characters 别名归一化。"""
    facts_data = [{
        "content_raw": "x", "content_clean": "公子出场了",
        "characters": ["公子"], "type": "plot_event",
        "narrative_weight": "medium", "status": "active",
    }]
    provider = _mock_provider(facts_data)
    results = extract_facts_from_chapter(
        "公子出场。", 1, [], {},
        character_aliases={"达达利亚": ["公子", "阿贾克斯"]},
        llm_provider=provider, llm_config=_FakeLLM(),
    )
    assert results[0].characters == ["达达利亚"]


def test_filter_short_content():
    """content_clean < 5 字 → 过滤。"""
    facts_data = [
        {"content_raw": "x", "content_clean": "短", "type": "plot_event",
         "narrative_weight": "low", "status": "active", "characters": []},
        {"content_raw": "x", "content_clean": "这是一条足够长的内容", "type": "plot_event",
         "narrative_weight": "low", "status": "active", "characters": []},
    ]
    provider = _mock_provider(facts_data)
    results = extract_facts_from_chapter(
        "正文。", 1, [], {}, None, provider, _FakeLLM(),
    )
    assert len(results) == 1
    assert "足够长" in results[0].content_clean


def test_chapter_num_auto_fill():
    """chapter 自动填充为传入的 chapter_num。"""
    facts_data = [{"content_raw": "x", "content_clean": "事实内容描述",
                   "type": "plot_event", "narrative_weight": "medium",
                   "status": "active", "characters": []}]
    provider = _mock_provider(facts_data)
    results = extract_facts_from_chapter(
        "正文。", 42, [], {}, None, provider, _FakeLLM(),
    )
    assert results[0].chapter == 42


# ===== 分块 =====


def test_short_chapter_single_call():
    """短章节 → 单次调用。"""
    provider = _mock_provider([])
    extract_facts_from_chapter(
        "短正文。", 1, [], {}, None, provider, _FakeLLM(),
    )
    assert provider.generate.call_count == 1


def test_long_chapter_split():
    """长章节 → 分块调用。"""
    long_text = "长段落内容。\n" * 500  # 很长
    provider = _mock_provider([])
    extract_facts_from_chapter(
        long_text, 1, [], {}, None, provider, _FakeLLM(),
        max_chunk_tokens=100,  # 极低阈值强制分块
    )
    assert provider.generate.call_count == 2


def test_empty_text():
    """空文本 → 空列表。"""
    results = extract_facts_from_chapter(
        "", 1, [], {}, None, MagicMock(), _FakeLLM(),
    )
    assert results == []


def test_llm_error_returns_empty():
    """LLM 调用失败 → 空列表，不崩溃。"""
    provider = MagicMock()
    provider.generate.side_effect = RuntimeError("API error")
    results = extract_facts_from_chapter(
        "正文内容。", 1, [], {}, None, provider, _FakeLLM(),
    )
    assert results == []
