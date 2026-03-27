"""Dirty 章节解除流程集成测试。"""

import asyncio

import pytest

from core.domain.chapter import Chapter
from core.domain.draft import Draft
from core.domain.enums import FactSource, FactStatus, FactType
from core.domain.fact import Fact
from core.domain.fact_change import FactChange
from core.domain.generated_with import GeneratedWith
from core.domain.ops_entry import OpsEntry
from core.domain.state import State
from core.services.au_mutex import AUMutexManager
from core.services.confirm_chapter import ConfirmChapterService
from core.services.dirty_resolve import DirtyResolveError, ResolveDirtyChapterService
from infra.storage_local.directory import ensure_au_directories
from infra.storage_local.file_utils import compute_content_hash
from repositories.implementations.local_file_chapter import LocalFileChapterRepository
from repositories.implementations.local_file_draft import LocalFileDraftRepository
from repositories.implementations.local_file_fact import LocalFileFactRepository
from repositories.implementations.local_file_ops import LocalFileOpsRepository
from repositories.implementations.local_file_state import LocalFileStateRepository


CAST = {"from_core": ["林深", "陈明", "陈律师"], "au_specific": [], "oc": []}


def _build_services():
    chapter_repo = LocalFileChapterRepository()
    draft_repo = LocalFileDraftRepository()
    state_repo = LocalFileStateRepository()
    ops_repo = LocalFileOpsRepository()
    fact_repo = LocalFileFactRepository()
    mutex = AUMutexManager()

    confirm = ConfirmChapterService(
        chapter_repo=chapter_repo, draft_repo=draft_repo,
        state_repo=state_repo, ops_repo=ops_repo, au_mutex=mutex,
    )
    resolve = ResolveDirtyChapterService(
        chapter_repo=chapter_repo, state_repo=state_repo,
        ops_repo=ops_repo, fact_repo=fact_repo, au_mutex=mutex,
    )
    return confirm, resolve, fact_repo, ops_repo, state_repo, chapter_repo


def _setup_au(tmp_path):
    au = tmp_path / "test_au"
    ensure_au_directories(au)
    return au


def _save_draft(au, chapter_num, variant, content):
    asyncio.run(LocalFileDraftRepository().save(
        Draft(au_id=str(au), chapter_num=chapter_num, variant=variant, content=content)
    ))


def _save_state(au, **overrides):
    defaults = {"au_id": str(au), "current_chapter": 1}
    defaults.update(overrides)
    asyncio.run(LocalFileStateRepository().save(State(**defaults)))


def _make_gw():
    return GeneratedWith(
        mode="api", model="deepseek-chat", temperature=1.0, top_p=0.95,
        input_tokens=10000, output_tokens=1500, char_count=1200,
        duration_ms=5000, generated_at="2025-03-24T14:22:00Z",
    )


def _confirm_and_dirty(au, confirm_svc, state_repo, chapter_repo, chapter_num, content):
    """Helper: confirm a chapter then mark it dirty (simulate user edit)."""
    _save_draft(au, chapter_num, "A", content)
    if chapter_num == 1:
        _save_state(au, current_chapter=1)
    confirm_svc.confirm_chapter(au, chapter_num, f"ch{chapter_num:04d}_draft_A.md", _make_gw(), CAST)

    # Simulate user editing the confirmed chapter (mark dirty)
    state = asyncio.run(state_repo.get(str(au)))
    if chapter_num not in state.chapters_dirty:
        state.chapters_dirty.append(chapter_num)
    asyncio.run(state_repo.save(state))

    # Simulate editing the chapter content
    ch = asyncio.run(chapter_repo.get(str(au), chapter_num))
    ch.content = content + "（用户编辑后的新内容）"
    ch.provenance = "mixed"
    asyncio.run(chapter_repo.save(ch))


# ===== 最新章 resolve =====


def test_latest_chapter_resolve(tmp_path):
    """dirty 最新章 → resolve → characters_last_seen 重算 + last_scene_ending 重算。"""
    au = _setup_au(tmp_path)
    confirm, resolve, fact_repo, ops_repo, state_repo, chapter_repo = _build_services()

    _confirm_and_dirty(au, confirm, state_repo, chapter_repo, 1, "林深走进咖啡馆。陈明在擦杯子。")

    result = resolve.resolve_dirty_chapter(au, 1, [], cast_registry=CAST)

    assert result["is_latest"] is True
    assert result["chapter_num"] == 1

    state = asyncio.run(state_repo.get(str(au)))
    # characters_last_seen 已重算
    assert "林深" in state.characters_last_seen
    assert "陈明" in state.characters_last_seen
    # last_scene_ending 已重算（基于编辑后的内容）
    assert "用户编辑后的新内容" in state.last_scene_ending


def test_latest_chapter_content_hash_updated(tmp_path):
    """dirty 最新章 → resolve → content_hash 更新为新内容的 SHA-256。"""
    au = _setup_au(tmp_path)
    confirm, resolve, _, _, state_repo, chapter_repo = _build_services()

    original = "原始内容。"
    _confirm_and_dirty(au, confirm, state_repo, chapter_repo, 1, original)

    resolve.resolve_dirty_chapter(au, 1, [], cast_registry=CAST)

    ch = asyncio.run(chapter_repo.get(str(au), 1))
    expected_content = original + "（用户编辑后的新内容）"
    assert ch.content_hash == compute_content_hash(expected_content)


def test_latest_chapter_dirty_removed(tmp_path):
    """dirty 最新章 → resolve → chapters_dirty 已移除该章。"""
    au = _setup_au(tmp_path)
    confirm, resolve, _, _, state_repo, chapter_repo = _build_services()

    _confirm_and_dirty(au, confirm, state_repo, chapter_repo, 1, "内容。")

    resolve.resolve_dirty_chapter(au, 1, [])

    state = asyncio.run(state_repo.get(str(au)))
    assert 1 not in state.chapters_dirty


# ===== 历史章 resolve =====


def test_historical_chapter_no_state_change(tmp_path):
    """dirty 历史章 → resolve → characters_last_seen 不变 + last_scene_ending 不变。"""
    au = _setup_au(tmp_path)
    confirm, resolve, _, _, state_repo, chapter_repo = _build_services()

    # Confirm ch1 and ch2
    _save_draft(au, 1, "A", "第一章。林深走进门。")
    _save_state(au, current_chapter=1)
    confirm.confirm_chapter(au, 1, "ch0001_draft_A.md", _make_gw(), CAST)

    _save_draft(au, 2, "A", "第二章。陈明出门。陈律师到访。")
    confirm.confirm_chapter(au, 2, "ch0002_draft_A.md", _make_gw(), CAST)

    # Save state before dirty resolve
    state_before = asyncio.run(state_repo.get(str(au)))
    chars_before = dict(state_before.characters_last_seen)
    ending_before = state_before.last_scene_ending

    # Mark ch1 as dirty (historical chapter)
    state_before.chapters_dirty.append(1)
    asyncio.run(state_repo.save(state_before))

    # Edit ch1 content
    ch1 = asyncio.run(chapter_repo.get(str(au), 1))
    ch1.content = "编辑后的第一章。"
    asyncio.run(chapter_repo.save(ch1))

    # Resolve
    result = resolve.resolve_dirty_chapter(au, 1, [])

    assert result["is_latest"] is False
    state_after = asyncio.run(state_repo.get(str(au)))
    # characters_last_seen 不变
    assert state_after.characters_last_seen == chars_before
    # last_scene_ending 不变
    assert state_after.last_scene_ending == ending_before


def test_historical_chapter_content_hash_updated(tmp_path):
    """dirty 历史章 → resolve → content_hash 已更新。"""
    au = _setup_au(tmp_path)
    confirm, resolve, _, _, state_repo, chapter_repo = _build_services()

    _save_draft(au, 1, "A", "第一章。")
    _save_state(au, current_chapter=1)
    confirm.confirm_chapter(au, 1, "ch0001_draft_A.md", _make_gw(), CAST)

    _save_draft(au, 2, "A", "第二章。")
    confirm.confirm_chapter(au, 2, "ch0002_draft_A.md", _make_gw(), CAST)

    # Mark ch1 dirty + edit
    state = asyncio.run(state_repo.get(str(au)))
    state.chapters_dirty.append(1)
    asyncio.run(state_repo.save(state))

    ch1 = asyncio.run(chapter_repo.get(str(au), 1))
    ch1.content = "全新的第一章内容。"
    asyncio.run(chapter_repo.save(ch1))

    resolve.resolve_dirty_chapter(au, 1, [])

    ch1_after = asyncio.run(chapter_repo.get(str(au), 1))
    assert ch1_after.content_hash == compute_content_hash("全新的第一章内容。")


def test_historical_chapter_dirty_removed(tmp_path):
    """dirty 历史章 → resolve → chapters_dirty 已移除。"""
    au = _setup_au(tmp_path)
    confirm, resolve, _, _, state_repo, chapter_repo = _build_services()

    _save_draft(au, 1, "A", "ch1")
    _save_state(au, current_chapter=1)
    confirm.confirm_chapter(au, 1, "ch0001_draft_A.md", _make_gw(), CAST)
    _save_draft(au, 2, "A", "ch2")
    confirm.confirm_chapter(au, 2, "ch0002_draft_A.md", _make_gw(), CAST)

    state = asyncio.run(state_repo.get(str(au)))
    state.chapters_dirty.append(1)
    asyncio.run(state_repo.save(state))

    resolve.resolve_dirty_chapter(au, 1, [])

    state = asyncio.run(state_repo.get(str(au)))
    assert 1 not in state.chapters_dirty


# ===== facts 变更 =====


def test_fact_change_deprecate(tmp_path):
    """FactChange action="deprecate" → fact.status 变为 deprecated。"""
    au = _setup_au(tmp_path)
    confirm, resolve, fact_repo, ops_repo, state_repo, chapter_repo = _build_services()

    _confirm_and_dirty(au, confirm, state_repo, chapter_repo, 1, "内容。")

    # Add a fact
    fact = Fact(
        id="f_test", content_raw="测试", content_clean="测试",
        chapter=1, status=FactStatus.ACTIVE, type=FactType.PLOT_EVENT,
        source=FactSource.MANUAL, revision=1,
        created_at="2025-01-01T00:00:00Z", updated_at="2025-01-01T00:00:00Z",
    )
    fact_repo.append(str(au), fact)

    changes = [FactChange(fact_id="f_test", action="deprecate")]
    resolve.resolve_dirty_chapter(au, 1, changes)

    updated = fact_repo.get(str(au), "f_test")
    assert updated is not None
    assert updated.status == FactStatus.DEPRECATED


def test_fact_change_update(tmp_path):
    """FactChange action="update" → fact 字段已更新 + revision+1。"""
    au = _setup_au(tmp_path)
    confirm, resolve, fact_repo, _, state_repo, chapter_repo = _build_services()

    _confirm_and_dirty(au, confirm, state_repo, chapter_repo, 1, "内容。")

    fact = Fact(
        id="f_upd", content_raw="原始", content_clean="原始",
        chapter=1, status=FactStatus.ACTIVE, type=FactType.PLOT_EVENT,
        source=FactSource.MANUAL, revision=1,
        created_at="2025-01-01T00:00:00Z", updated_at="2025-01-01T00:00:00Z",
    )
    fact_repo.append(str(au), fact)

    changes = [FactChange(fact_id="f_upd", action="update", updated_fields={"content_clean": "修改后"})]
    resolve.resolve_dirty_chapter(au, 1, changes)

    updated = fact_repo.get(str(au), "f_upd")
    assert updated is not None
    assert updated.content_clean == "修改后"
    assert updated.revision >= 2


def test_fact_changes_ops_records(tmp_path):
    """每条变更有对应 ops 记录。"""
    au = _setup_au(tmp_path)
    confirm, resolve, fact_repo, ops_repo, state_repo, chapter_repo = _build_services()

    _confirm_and_dirty(au, confirm, state_repo, chapter_repo, 1, "内容。")

    for i in range(3):
        fact_repo.append(str(au), Fact(
            id=f"f_{i}", content_raw=f"fact{i}", content_clean=f"fact{i}",
            chapter=1, status=FactStatus.ACTIVE, type=FactType.PLOT_EVENT,
            source=FactSource.MANUAL, revision=1,
            created_at="2025-01-01T00:00:00Z", updated_at="2025-01-01T00:00:00Z",
        ))

    changes = [
        FactChange(fact_id="f_0", action="keep"),
        FactChange(fact_id="f_1", action="update", updated_fields={"content_clean": "changed"}),
        FactChange(fact_id="f_2", action="deprecate"),
    ]
    resolve.resolve_dirty_chapter(au, 1, changes)

    ops = ops_repo.list_all(str(au))
    edit_ops = [o for o in ops if o.op_type == "edit_fact"]
    status_ops = [o for o in ops if o.op_type == "update_fact_status"]
    resolve_ops = [o for o in ops if o.op_type == "resolve_dirty_chapter"]

    assert len(edit_ops) == 1  # f_1 update
    assert edit_ops[0].chapter_num is None  # edit_fact 无 chapter_num（PRD §2.6.5）
    assert len(status_ops) == 1  # f_2 deprecate
    assert status_ops[0].chapter_num == 1  # update_fact_status 有 chapter_num
    assert status_ops[0].payload["old_status"] == "active"  # 真实旧状态
    assert status_ops[0].payload["new_status"] == "deprecated"
    assert len(resolve_ops) == 1  # final resolve


# ===== 边界条件 =====


def test_not_in_dirty_raises(tmp_path):
    """章节不在 chapters_dirty 中 → 返回错误。"""
    au = _setup_au(tmp_path)
    _, resolve, *_ = _build_services()
    _save_state(au, current_chapter=5, chapters_dirty=[3, 7])

    with pytest.raises(DirtyResolveError, match="不在 chapters_dirty"):
        resolve.resolve_dirty_chapter(au, 1, [])


def test_empty_fact_changes_still_updates_state(tmp_path):
    """无关联 facts → 跳过 facts 步骤但 state 仍刷新。"""
    au = _setup_au(tmp_path)
    confirm, resolve, _, _, state_repo, chapter_repo = _build_services()

    _confirm_and_dirty(au, confirm, state_repo, chapter_repo, 1, "内容。林深在场。")

    # Empty fact changes
    result = resolve.resolve_dirty_chapter(au, 1, [], cast_registry=CAST)

    # State still refreshed
    state = asyncio.run(state_repo.get(str(au)))
    assert 1 not in state.chapters_dirty
    assert result["content_hash"] != ""


def test_snapshot_fallback_scan(tmp_path):
    """ops 无快照 → 降级扫描重算。"""
    au = _setup_au(tmp_path)

    # Create chapters via direct save (no ops confirm records)
    for i, content in enumerate(["林深出现。", "陈明出现。林深也在。", "陈律师到访。"], 1):
        ch = Chapter(
            au_id=str(au), chapter_num=i, content=content,
            chapter_id=f"ch_imp_{i}", revision=1, confirmed_at="2025-01-01T00:00:00Z",
            content_hash=compute_content_hash(content), provenance="imported",
        )
        asyncio.run(LocalFileChapterRepository().save(ch))

    _save_state(au, current_chapter=4, chapters_dirty=[3])

    _, resolve, *_ = _build_services()
    resolve.resolve_dirty_chapter(au, 3, [], cast_registry=CAST)

    state = asyncio.run(LocalFileStateRepository().get(str(au)))
    # Latest chapter (3 == current_chapter-1), so characters recalculated
    assert "林深" in state.characters_last_seen
    assert "陈明" in state.characters_last_seen
    assert "陈律师" in state.characters_last_seen


# ===== 审计修复验证 =====


def test_deprecate_cleans_dangling_focus(tmp_path):
    """dirty resolve 中 deprecate fact → chapter_focus 已清理悬空 ID。"""
    au = _setup_au(tmp_path)
    confirm, resolve, fact_repo, ops_repo, state_repo, chapter_repo = _build_services()

    _confirm_and_dirty(au, confirm, state_repo, chapter_repo, 1, "内容。")

    # 添加 unresolved fact 并设为 chapter_focus
    fact = Fact(
        id="f_focus_test", content_raw="伏笔", content_clean="伏笔",
        chapter=1, status=FactStatus.UNRESOLVED, type=FactType.FORESHADOWING,
        source=FactSource.MANUAL, revision=1,
        created_at="2025-01-01T00:00:00Z", updated_at="2025-01-01T00:00:00Z",
    )
    fact_repo.append(str(au), fact)

    state = asyncio.run(state_repo.get(str(au)))
    state.chapter_focus = ["f_focus_test"]
    asyncio.run(state_repo.save(state))

    # dirty resolve 中 deprecate 该 fact
    changes = [FactChange(fact_id="f_focus_test", action="deprecate")]
    resolve.resolve_dirty_chapter(au, 1, changes)

    # chapter_focus 应已清理
    state = asyncio.run(state_repo.get(str(au)))
    assert "f_focus_test" not in state.chapter_focus


def test_update_resolves_linkage_in_dirty(tmp_path):
    """dirty resolve 中 update fact 的 resolves → 被指向的旧 fact 状态已联动。"""
    au = _setup_au(tmp_path)
    confirm, resolve, fact_repo, ops_repo, state_repo, chapter_repo = _build_services()

    _confirm_and_dirty(au, confirm, state_repo, chapter_repo, 1, "内容。")

    # 添加一个 unresolved 伏笔
    foreshadow = Fact(
        id="f_foreshadow_dr", content_raw="伏笔", content_clean="伏笔",
        chapter=0, status=FactStatus.UNRESOLVED, type=FactType.FORESHADOWING,
        source=FactSource.MANUAL, revision=1,
        created_at="2025-01-01T00:00:00Z", updated_at="2025-01-01T00:00:00Z",
    )
    fact_repo.append(str(au), foreshadow)

    # 添加一个 fact 用于修改
    resolver = Fact(
        id="f_resolver_dr", content_raw="揭示", content_clean="揭示",
        chapter=1, status=FactStatus.ACTIVE, type=FactType.CHARACTER_DETAIL,
        source=FactSource.MANUAL, revision=1,
        created_at="2025-01-01T00:00:00Z", updated_at="2025-01-01T00:00:00Z",
    )
    fact_repo.append(str(au), resolver)

    # dirty resolve 中 update resolver 添加 resolves 关联
    changes = [FactChange(
        fact_id="f_resolver_dr", action="update",
        updated_fields={"resolves": "f_foreshadow_dr"},
    )]
    resolve.resolve_dirty_chapter(au, 1, changes)

    # 伏笔应已被联动为 resolved
    target = fact_repo.get(str(au), "f_foreshadow_dr")
    assert target is not None
    assert target.status == FactStatus.RESOLVED


def test_dirty_resolve_bumps_chapter_revision(tmp_path):
    """dirty resolve 后 chapter.revision 已 +1。"""
    au = _setup_au(tmp_path)
    confirm, resolve, _, _, state_repo, chapter_repo = _build_services()

    _confirm_and_dirty(au, confirm, state_repo, chapter_repo, 1, "内容。")

    ch_before = asyncio.run(chapter_repo.get(str(au), 1))
    rev_before = ch_before.revision

    resolve.resolve_dirty_chapter(au, 1, [])

    ch_after = asyncio.run(chapter_repo.get(str(au), 1))
    assert ch_after.revision == rev_before + 1
