"""上下文组装器单元测试。"""

from dataclasses import dataclass, field

import pytest

from core.domain.enums import FactStatus, FactType, NarrativeWeight
from core.domain.fact import Fact
from core.services.context_assembler import (
    assemble_context,
    build_core_settings_layer,
    build_facts_layer,
    build_instruction,
    build_system_prompt,
)


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
    context_window: int = 0


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
    current_chapter: int = 38
    chapter_focus: list = field(default_factory=list)
    last_scene_ending: str = ""
    characters_last_seen: dict = field(default_factory=dict)


def _make_fact(fid, status="active", chapter=1, weight="medium", content="测试事实", resolves=None):
    return Fact(
        id=fid, content_raw=content, content_clean=content,
        chapter=chapter, status=FactStatus(status), type=FactType.PLOT_EVENT,
        narrative_weight=NarrativeWeight(weight),
        revision=1, created_at="", updated_at="",
    )


# ===== build_system_prompt =====

def test_system_prompt_with_pinned():
    """pinned_context 非空 → 包含"后台核心铁律"。"""
    p = _FakeProject(pinned_context=["不要道歉", "保持距离"])
    result = build_system_prompt(p)
    assert "后台核心铁律" in result
    assert "不要道歉" in result
    assert "保持距离" in result


def test_system_prompt_no_pinned():
    """pinned_context 为空 → 不包含 P0 铁律段落。"""
    result = build_system_prompt(_FakeProject())
    assert "# 后台核心铁律" not in result  # 段落标题不出现
    assert "不可逾越的叙事底线" not in result  # 段落正文不出现


def test_system_prompt_third_person():
    """perspective=third_person → 包含第三人称。"""
    result = build_system_prompt(_FakeProject())
    assert "第三人称" in result


def test_system_prompt_first_person():
    """perspective=first_person → 包含第一人称。"""
    p = _FakeProject(writing_style=_FakeWS(perspective="first_person", pov_character="林深"))
    result = build_system_prompt(p)
    assert "林深" in result
    assert "第一人称" in result


def test_system_prompt_custom_instructions():
    """custom_instructions 非空 → 追加在末尾。"""
    p = _FakeProject(writing_style=_FakeWS(custom_instructions="写得更文艺"))
    result = build_system_prompt(p)
    assert "写得更文艺" in result


def test_system_prompt_trim_custom():
    """trim_custom=True → custom_instructions 被裁剪。"""
    p = _FakeProject(writing_style=_FakeWS(custom_instructions="很长的自定义说明"))
    result = build_system_prompt(p, trim_custom=True)
    assert "很长的自定义说明" not in result


# ===== build_instruction =====

def test_instruction_with_focus():
    """chapter_focus 非空 → 包含核心推进目标。"""
    facts = [_make_fact("f1", status="unresolved", content="那句没说完的话")]
    state = _FakeState(chapter_focus=["f1"])
    result = build_instruction(state, "继续", facts)
    assert "本章核心推进目标" in result
    assert "那句没说完的话" in result
    assert "继续" in result


def test_instruction_no_focus_with_unresolved():
    """chapter_focus 为空 + 有 unresolved → 铺陈指令。"""
    facts = [_make_fact("f1", status="unresolved")]
    state = _FakeState(chapter_focus=[])
    result = build_instruction(state, "继续", facts)
    assert "本章叙事节奏" in result
    assert "铺陈" in result


def test_instruction_no_focus_no_unresolved():
    """chapter_focus 为空 + 无 unresolved → 无额外指令。"""
    facts = [_make_fact("f1", status="active")]
    state = _FakeState(chapter_focus=[])
    result = build_instruction(state, "开始写作", facts)
    assert "本章核心推进目标" not in result
    assert "本章叙事节奏" not in result
    assert "开始写作" in result


def test_instruction_user_input_always_present():
    """user_input 始终包含。"""
    result = build_instruction(_FakeState(), "让林深道歉", [])
    assert "让林深道歉" in result


# ===== build_facts_layer =====

def test_facts_only_active_unresolved():
    """只包含 active/unresolved。"""
    facts = [
        _make_fact("f1", status="active", content="事实A"),
        _make_fact("f2", status="unresolved", content="伏笔B"),
        _make_fact("f3", status="resolved", content="已解决C"),
        _make_fact("f4", status="deprecated", content="废弃D"),
    ]
    text, _ = build_facts_layer(facts, [], 99999, _FakeLLM())
    assert "事实A" in text
    assert "伏笔B" in text
    assert "已解决C" not in text
    assert "废弃D" not in text


def test_facts_focus_excluded():
    """chapter_focus 的 facts 不重复出现。"""
    facts = [
        _make_fact("f1", status="unresolved", content="焦点事实"),
        _make_fact("f2", status="active", content="普通事实"),
    ]
    text, _ = build_facts_layer(facts, ["f1"], 99999, _FakeLLM())
    assert "焦点事实" not in text
    assert "普通事实" in text


def test_facts_uses_content_clean():
    """使用 content_clean。"""
    f = _make_fact("f1", content="纯叙事描述")
    text, _ = build_facts_layer([f], [], 99999, _FakeLLM())
    assert "纯叙事描述" in text


# ===== build_core_settings_layer =====

def test_core_settings_returns_injected_names():
    """P5 返回注入的角色名列表。"""
    p = _FakeProject(core_always_include=["Connor"])
    files = {"Connor": "# Connor\nDetective.", "Hank": "# Hank\nLieutenant."}
    text, injected, truncated = build_core_settings_layer(p, files, 99999, _FakeLLM())
    assert "Connor" in injected
    assert "Hank" in injected
    assert truncated == []
    assert "Connor" in text
    assert "Hank" in text


def test_core_settings_truncated_names():
    """P5 budget 不足 → 记录被截断的角色。"""
    p = _FakeProject(core_always_include=[], core_guarantee_budget=0)
    files = {"Connor": "# Connor\n" + "x" * 5000}
    text, injected, truncated = build_core_settings_layer(p, files, 1, _FakeLLM())
    # budget=1 token，无法注入任何角色
    assert injected == []
    assert "Connor" in truncated


# ===== ContextSummary 集成收集 =====

@dataclass
class _FakeChapterRepo:
    """用于 assemble_context 测试的 mock chapter_repo。"""
    def get_content_only(self, au_id: str, chapter_num: int) -> str:
        return "上一章的内容，林深在雨中站了很久。"


def test_context_summary_pinned_count():
    """ContextSummary 正确统计 pinned_count。"""
    p = _FakeProject(pinned_context=["不要道歉", "保持距离", "角色不能飞"])
    state = _FakeState()
    result = assemble_context(p, state, "继续", [], _FakeChapterRepo(), "test/au")
    summary = result["context_summary"]
    assert summary.pinned_count == 3


def test_context_summary_facts_injected():
    """ContextSummary 正确统计 facts_injected。"""
    facts = [
        _make_fact("f1", status="active", content="事实A"),
        _make_fact("f2", status="unresolved", content="伏笔B"),
        _make_fact("f3", status="resolved", content="已解决"),
    ]
    p = _FakeProject()
    state = _FakeState()
    result = assemble_context(p, state, "继续", facts, _FakeChapterRepo(), "test/au")
    summary = result["context_summary"]
    assert summary.facts_injected == 2  # active + unresolved，不含 resolved


def test_context_summary_characters_used():
    """ContextSummary 正确记录 P5 注入的角色名。"""
    p = _FakeProject()
    state = _FakeState()
    files = {"Connor": "# Connor\nDetective.", "Hank": "# Hank\nLieutenant."}
    result = assemble_context(p, state, "继续", [], _FakeChapterRepo(), "test/au", character_files=files)
    summary = result["context_summary"]
    assert "Connor" in summary.characters_used
    assert "Hank" in summary.characters_used
    assert summary.truncated_characters == []


def test_context_summary_focus_facts():
    """ContextSummary 记录 focus facts 前 20 字。"""
    facts = [_make_fact("f1", status="unresolved", content="这是一个很长很长的伏笔描述，超过二十个字符")]
    state = _FakeState(chapter_focus=["f1"])
    p = _FakeProject()
    result = assemble_context(p, state, "继续", facts, _FakeChapterRepo(), "test/au")
    summary = result["context_summary"]
    assert len(summary.facts_as_focus) == 1
    assert len(summary.facts_as_focus[0]) == 20


def test_context_summary_total_tokens():
    """ContextSummary 记录 total_input_tokens。"""
    p = _FakeProject()
    state = _FakeState()
    result = assemble_context(p, state, "继续", [], _FakeChapterRepo(), "test/au")
    summary = result["context_summary"]
    assert summary.total_input_tokens > 0
    assert summary.total_input_tokens == result["budget_report"].total_input_tokens


def test_context_summary_worldbuilding_used():
    """ContextSummary 记录注入的世界观文件名 + 内容出现在 prompt 中。"""
    p = _FakeProject()
    state = _FakeState()
    wb_files = {"圣锚星系": "# 圣锚星系\n一个虚构的星系。", "魔法体系": "# 魔法体系\n元素魔法。"}
    result = assemble_context(
        p, state, "继续", [], _FakeChapterRepo(), "test/au",
        worldbuilding_files=wb_files,
    )
    summary = result["context_summary"]
    assert "圣锚星系" in summary.worldbuilding_used
    assert "魔法体系" in summary.worldbuilding_used
    # 验证世界观内容实际注入 prompt
    user_content = result["messages"][1]["content"]
    assert "世界观设定" in user_content
    assert "虚构的星系" in user_content
