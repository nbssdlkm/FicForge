"""Facts 生命周期集成测试。"""


import pytest

from core.domain.enums import FactSource, FactStatus
from core.domain.fact import Fact
from core.domain.state import State
from core.services.facts_lifecycle import (
    FactsLifecycleError,
    add_fact,
    edit_fact,
    set_chapter_focus,
    update_fact_status,
)
from infra.storage_local.directory import ensure_au_directories
from repositories.implementations.local_file_fact import LocalFileFactRepository
from repositories.implementations.local_file_ops import LocalFileOpsRepository
from repositories.implementations.local_file_state import LocalFileStateRepository


def _setup_au(tmp_path):
    au = tmp_path / "test_au"
    ensure_au_directories(au)
    return au


def _save_state(au, **overrides):
    defaults = {"au_id": str(au), "current_chapter": 5}
    defaults.update(overrides)
    LocalFileStateRepository().save(State(**defaults))


# ===== add_fact =====

def test_add_fact_basic(tmp_path):
    """新增 fact → facts.jsonl 有新条目 + ops 有 add_fact 记录。"""
    au = _setup_au(tmp_path)
    fact_repo = LocalFileFactRepository()
    ops_repo = LocalFileOpsRepository()

    result = add_fact(
        au, chapter_num=5,
        fact_data={
            "content_raw": "第5章林深提到旧事",
            "content_clean": "林深提到旧事",
            "characters": ["林深"],
            "chapter": 5,
            "status": "active",
            "type": "plot_event",
        },
        fact_repo=fact_repo, ops_repo=ops_repo,
    )

    assert result.id.startswith("f_")
    assert result.content_clean == "林深提到旧事"
    assert result.source == FactSource.MANUAL
    assert result.revision == 1

    # ops
    ops = ops_repo.list_all(str(au))
    add_ops = [o for o in ops if o.op_type == "add_fact"]
    assert len(add_ops) == 1
    assert add_ops[0].chapter_num == 5
    assert add_ops[0].target_id == result.id


def test_add_fact_id_format(tmp_path):
    """fact_id 格式正确。"""
    au = _setup_au(tmp_path)
    result = add_fact(
        au, 1, {"content_raw": "x", "content_clean": "x"},
        LocalFileFactRepository(), LocalFileOpsRepository(),
    )
    parts = result.id.split("_")
    assert parts[0] == "f"
    assert parts[1].isdigit()
    assert len(parts[2]) == 4


def test_add_fact_source_injection(tmp_path):
    """source 自动注入。"""
    au = _setup_au(tmp_path)
    fr = LocalFileFactRepository()
    or_ = LocalFileOpsRepository()

    manual = add_fact(au, 1, {"content_raw": "x", "content_clean": "x"}, fr, or_, source="manual")
    assert manual.source == FactSource.MANUAL

    auto = add_fact(au, 1, {"content_raw": "y", "content_clean": "y"}, fr, or_, source="extract_auto")
    assert auto.source == FactSource.EXTRACT_AUTO


def test_add_fact_alias_normalization(tmp_path):
    """characters 别名归一化。"""
    au = _setup_au(tmp_path)
    result = add_fact(
        au, 1,
        {"content_raw": "x", "content_clean": "x", "characters": ["公子"]},
        LocalFileFactRepository(), LocalFileOpsRepository(),
        character_aliases={"达达利亚": ["公子"]},
    )
    assert result.characters == ["达达利亚"]


def test_add_fact_resolves_linkage(tmp_path):
    """resolves 联动：新增带 resolves 的 fact → 旧 fact 自动变 resolved。"""
    au = _setup_au(tmp_path)
    fr = LocalFileFactRepository()
    or_ = LocalFileOpsRepository()

    # 先添加一个 unresolved 伏笔
    foreshadow = add_fact(au, 1, {
        "content_raw": "伏笔", "content_clean": "伏笔",
        "status": "unresolved", "type": "foreshadowing",
    }, fr, or_)

    # 添加解决伏笔的 fact
    add_fact(au, 5, {
        "content_raw": "揭示", "content_clean": "揭示",
        "resolves": foreshadow.id,
    }, fr, or_)

    # 伏笔应变为 resolved
    updated = fr.get(str(au), foreshadow.id)
    assert updated is not None
    assert updated.status == FactStatus.RESOLVED


# ===== edit_fact =====

def test_edit_fact_basic(tmp_path):
    """修改 content_clean → updated_at + revision 已更新。"""
    au = _setup_au(tmp_path)
    _save_state(au)
    fr = LocalFileFactRepository()
    or_ = LocalFileOpsRepository()
    sr = LocalFileStateRepository()

    original = add_fact(au, 1, {"content_raw": "x", "content_clean": "原始"}, fr, or_)

    edited = edit_fact(au, original.id, {"content_clean": "修改后"}, fr, or_, sr)
    assert edited.content_clean == "修改后"
    assert edited.revision >= 2


def test_edit_fact_ops_no_chapter_num(tmp_path):
    """ops 记录为 edit_fact，无 chapter_num。"""
    au = _setup_au(tmp_path)
    _save_state(au)
    fr = LocalFileFactRepository()
    or_ = LocalFileOpsRepository()
    sr = LocalFileStateRepository()

    f = add_fact(au, 1, {"content_raw": "x", "content_clean": "x"}, fr, or_)
    edit_fact(au, f.id, {"content_clean": "y"}, fr, or_, sr)

    ops = or_.list_all(str(au))
    edit_ops = [o for o in ops if o.op_type == "edit_fact"]
    assert len(edit_ops) == 1
    assert edit_ops[0].chapter_num is None


def test_edit_fact_add_resolves(tmp_path):
    """修改 resolves（新增关联）→ 目标 fact 变 resolved。"""
    au = _setup_au(tmp_path)
    _save_state(au)
    fr = LocalFileFactRepository()
    or_ = LocalFileOpsRepository()
    sr = LocalFileStateRepository()

    foreshadow = add_fact(au, 1, {"content_raw": "伏", "content_clean": "伏", "status": "unresolved"}, fr, or_)
    resolver = add_fact(au, 5, {"content_raw": "解", "content_clean": "解"}, fr, or_)

    edit_fact(au, resolver.id, {"resolves": foreshadow.id}, fr, or_, sr)

    target = fr.get(str(au), foreshadow.id)
    assert target is not None
    assert target.status == FactStatus.RESOLVED


def test_edit_fact_remove_resolves_restores(tmp_path):
    """修改 resolves（移除关联且无其他指向）→ 目标恢复 unresolved。"""
    au = _setup_au(tmp_path)
    _save_state(au)
    fr = LocalFileFactRepository()
    or_ = LocalFileOpsRepository()
    sr = LocalFileStateRepository()

    foreshadow = add_fact(au, 1, {"content_raw": "伏", "content_clean": "伏", "status": "unresolved"}, fr, or_)
    resolver = add_fact(au, 5, {"content_raw": "解", "content_clean": "解", "resolves": foreshadow.id}, fr, or_)

    # 移除 resolves
    edit_fact(au, resolver.id, {"resolves": None}, fr, or_, sr)

    target = fr.get(str(au), foreshadow.id)
    assert target is not None
    assert target.status == FactStatus.UNRESOLVED


def test_edit_fact_remove_resolves_keeps_if_others(tmp_path):
    """修改 resolves（移除但其他 fact 仍指向）→ 目标保持 resolved。"""
    au = _setup_au(tmp_path)
    _save_state(au)
    fr = LocalFileFactRepository()
    or_ = LocalFileOpsRepository()
    sr = LocalFileStateRepository()

    foreshadow = add_fact(au, 1, {"content_raw": "伏", "content_clean": "伏", "status": "unresolved"}, fr, or_)
    resolver1 = add_fact(au, 5, {"content_raw": "解1", "content_clean": "解1", "resolves": foreshadow.id}, fr, or_)
    resolver2 = add_fact(au, 6, {"content_raw": "解2", "content_clean": "解2", "resolves": foreshadow.id}, fr, or_)

    # 移除 resolver1 的 resolves，但 resolver2 仍指向
    edit_fact(au, resolver1.id, {"resolves": None}, fr, or_, sr)

    target = fr.get(str(au), foreshadow.id)
    assert target is not None
    assert target.status == FactStatus.RESOLVED  # 保持


# ===== update_fact_status =====

def test_update_status_deprecated_cleans_focus(tmp_path):
    """status → deprecated → 悬空清理：chapter_focus 中移除该 id。"""
    au = _setup_au(tmp_path)
    fr = LocalFileFactRepository()
    or_ = LocalFileOpsRepository()
    sr = LocalFileStateRepository()

    f = add_fact(au, 1, {"content_raw": "x", "content_clean": "x", "status": "unresolved"}, fr, or_)
    _save_state(au, chapter_focus=[f.id], last_confirmed_chapter_focus=[f.id])

    result = update_fact_status(au, f.id, "deprecated", 5, fr, or_, sr)

    assert result["focus_warning"] is True
    state = sr.get(str(au))
    assert f.id not in state.chapter_focus
    assert f.id not in state.last_confirmed_chapter_focus


def test_update_status_resolved_cleans_focus(tmp_path):
    """status → resolved → 悬空清理。"""
    au = _setup_au(tmp_path)
    fr = LocalFileFactRepository()
    or_ = LocalFileOpsRepository()
    sr = LocalFileStateRepository()

    f = add_fact(au, 1, {"content_raw": "x", "content_clean": "x", "status": "unresolved"}, fr, or_)
    _save_state(au, chapter_focus=[f.id])

    update_fact_status(au, f.id, "resolved", 5, fr, or_, sr)

    state = sr.get(str(au))
    assert f.id not in state.chapter_focus


def test_update_status_ops_has_chapter_num(tmp_path):
    """ops 记录有 chapter_num。"""
    au = _setup_au(tmp_path)
    fr = LocalFileFactRepository()
    or_ = LocalFileOpsRepository()
    sr = LocalFileStateRepository()
    _save_state(au)

    f = add_fact(au, 1, {"content_raw": "x", "content_clean": "x"}, fr, or_)
    update_fact_status(au, f.id, "deprecated", 7, fr, or_, sr)

    ops = or_.list_all(str(au))
    status_ops = [o for o in ops if o.op_type == "update_fact_status"]
    assert len(status_ops) == 1
    assert status_ops[0].chapter_num == 7
    assert status_ops[0].payload["old_status"] == "active"
    assert status_ops[0].payload["new_status"] == "deprecated"


# ===== set_chapter_focus =====

def test_set_focus_two_unresolved(tmp_path):
    """选择 2 个 unresolved → state.chapter_focus 已更新。"""
    au = _setup_au(tmp_path)
    fr = LocalFileFactRepository()
    or_ = LocalFileOpsRepository()
    sr = LocalFileStateRepository()
    _save_state(au)

    f1 = add_fact(au, 1, {"content_raw": "a", "content_clean": "a", "status": "unresolved"}, fr, or_)
    f2 = add_fact(au, 1, {"content_raw": "b", "content_clean": "b", "status": "unresolved"}, fr, or_)

    set_chapter_focus(au, [f1.id, f2.id], fr, or_, sr)

    state = sr.get(str(au))
    assert state.chapter_focus == [f1.id, f2.id]


def test_set_focus_non_unresolved_raises(tmp_path):
    """选择 non-unresolved → 错误。"""
    au = _setup_au(tmp_path)
    fr = LocalFileFactRepository()
    or_ = LocalFileOpsRepository()
    sr = LocalFileStateRepository()
    _save_state(au)

    f = add_fact(au, 1, {"content_raw": "x", "content_clean": "x", "status": "active"}, fr, or_)

    with pytest.raises(FactsLifecycleError, match="只能选 unresolved"):
        set_chapter_focus(au, [f.id], fr, or_, sr)


def test_set_focus_too_many_raises(tmp_path):
    """选择 > 2 个 → 错误。"""
    au = _setup_au(tmp_path)
    _save_state(au)

    with pytest.raises(FactsLifecycleError, match="最多 2 个"):
        set_chapter_focus(au, ["a", "b", "c"], LocalFileFactRepository(), LocalFileOpsRepository(), LocalFileStateRepository())


def test_set_focus_empty_clears(tmp_path):
    """空列表 → chapter_focus = []。"""
    au = _setup_au(tmp_path)
    fr = LocalFileFactRepository()
    or_ = LocalFileOpsRepository()
    sr = LocalFileStateRepository()
    _save_state(au, chapter_focus=["old_id"])

    set_chapter_focus(au, [], fr, or_, sr)

    state = sr.get(str(au))
    assert state.chapter_focus == []


def test_set_focus_ops_record(tmp_path):
    """ops 有 set_chapter_focus 记录。"""
    au = _setup_au(tmp_path)
    fr = LocalFileFactRepository()
    or_ = LocalFileOpsRepository()
    sr = LocalFileStateRepository()
    _save_state(au)

    f = add_fact(au, 1, {"content_raw": "x", "content_clean": "x", "status": "unresolved"}, fr, or_)
    set_chapter_focus(au, [f.id], fr, or_, sr)

    ops = or_.list_all(str(au))
    focus_ops = [o for o in ops if o.op_type == "set_chapter_focus"]
    assert len(focus_ops) == 1
    assert focus_ops[0].payload["focus"] == [f.id]
