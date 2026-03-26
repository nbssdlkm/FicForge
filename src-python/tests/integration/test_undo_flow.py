"""撤销最新章完整流程集成测试。"""

import asyncio

import pytest

from core.domain.draft import Draft
from core.domain.enums import FactSource, FactStatus, FactType
from core.domain.fact import Fact
from core.domain.generated_with import GeneratedWith
from core.domain.ops_entry import OpsEntry
from core.domain.state import State
from core.services.au_mutex import AUMutexManager
from core.services.confirm_chapter import ConfirmChapterService
from core.services.undo_chapter import UndoChapterError, UndoChapterService
from infra.storage_local.directory import ensure_au_directories
from repositories.implementations.local_file_chapter import LocalFileChapterRepository
from repositories.implementations.local_file_draft import LocalFileDraftRepository
from repositories.implementations.local_file_fact import LocalFileFactRepository
from repositories.implementations.local_file_ops import LocalFileOpsRepository
from repositories.implementations.local_file_state import LocalFileStateRepository


def _build_services():
    chapter_repo = LocalFileChapterRepository()
    draft_repo = LocalFileDraftRepository()
    state_repo = LocalFileStateRepository()
    ops_repo = LocalFileOpsRepository()
    fact_repo = LocalFileFactRepository()
    mutex = AUMutexManager()

    confirm = ConfirmChapterService(
        chapter_repo=chapter_repo,
        draft_repo=draft_repo,
        state_repo=state_repo,
        ops_repo=ops_repo,
        au_mutex=mutex,
    )
    undo = UndoChapterService(
        chapter_repo=chapter_repo,
        draft_repo=draft_repo,
        state_repo=state_repo,
        ops_repo=ops_repo,
        fact_repo=fact_repo,
        au_mutex=mutex,
    )
    return confirm, undo, fact_repo, ops_repo, state_repo, chapter_repo, draft_repo


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


CAST = {"from_core": ["林深", "陈明", "陈律师"], "au_specific": [], "oc": []}


# ===== 完整流程 =====


def test_full_confirm_then_undo(tmp_path):
    """confirm 一章 → undo → 验证全部回滚。"""
    au = _setup_au(tmp_path)
    content = "林深走进咖啡馆。陈明正在擦杯子。林深关上了灯。"
    _save_draft(au, 1, "A", content)
    _save_state(au, current_chapter=1, chapter_focus=["f033"])

    confirm, undo, fact_repo, ops_repo, state_repo, chapter_repo, _ = _build_services()

    # Confirm chapter 1
    confirm.confirm_chapter(au, 1, "ch0001_draft_A.md", _make_gw(), CAST)

    # Verify confirm worked
    state = asyncio.run(state_repo.get(str(au)))
    assert state.current_chapter == 2

    # Undo
    result = undo.undo_latest_chapter(au, CAST)
    assert result["chapter_num"] == 1
    assert result["new_current_chapter"] == 1

    # 章节文件已删除
    assert not (au / "chapters" / "main" / "ch0001.md").exists()

    # current_chapter 回退
    state = asyncio.run(state_repo.get(str(au)))
    assert state.current_chapter == 1

    # last_scene_ending 回滚（N==1 → 空字符串）
    assert state.last_scene_ending == ""

    # characters_last_seen 回滚（N==1 → 空字典）
    assert state.characters_last_seen == {}

    # chapter_focus 已清空
    assert state.chapter_focus == []

    # last_confirmed_chapter_focus 已回退（N==1 → 空）
    assert state.last_confirmed_chapter_focus == []

    # ops.jsonl 有 undo_chapter 记录，target_id 与 confirm 一致
    ops = ops_repo.list_all(str(au))
    confirm_ops = [o for o in ops if o.op_type == "confirm_chapter"]
    undo_ops = [o for o in ops if o.op_type == "undo_chapter"]
    assert len(confirm_ops) == 1
    assert len(undo_ops) == 1
    assert undo_ops[0].chapter_num == 1
    assert undo_ops[0].payload == {}
    assert undo_ops[0].target_id == confirm_ops[0].target_id  # chapter_id 链完整


# ===== 边界条件 =====


def test_undo_no_chapters_raises(tmp_path):
    """current_chapter == 1 → 错误。"""
    au = _setup_au(tmp_path)
    _save_state(au, current_chapter=1)

    _, undo, *_ = _build_services()
    with pytest.raises(UndoChapterError, match="没有已确认章节可撤销"):
        undo.undo_latest_chapter(au)


def test_undo_cleans_chapters_dirty(tmp_path):
    """undo 后 chapters_dirty 中的该章节号已移除。"""
    au = _setup_au(tmp_path)
    _save_draft(au, 1, "A", "内容")
    _save_state(au, current_chapter=1)

    confirm, undo, *_ = _build_services()
    confirm.confirm_chapter(au, 1, "ch0001_draft_A.md")

    # Manually add chapter 1 to dirty list
    state = asyncio.run(LocalFileStateRepository().get(str(au)))
    state.chapters_dirty = [1, 5, 10]
    asyncio.run(LocalFileStateRepository().save(state))

    undo.undo_latest_chapter(au)

    state = asyncio.run(LocalFileStateRepository().get(str(au)))
    assert 1 not in state.chapters_dirty
    assert 5 in state.chapters_dirty  # Others preserved


def test_undo_cleans_drafts_gte_n(tmp_path):
    """≥N 的草稿已清理（D-0016）。"""
    au = _setup_au(tmp_path)
    _save_draft(au, 1, "A", "ch1 内容")
    _save_state(au, current_chapter=1)

    confirm, undo, *_, draft_repo = _build_services()
    confirm.confirm_chapter(au, 1, "ch0001_draft_A.md")

    # Create drafts for ch1 (the undone chapter) and ch2 (future)
    _save_draft(au, 1, "B", "ch1 新草稿")
    _save_draft(au, 2, "A", "ch2 幽灵草稿")

    undo.undo_latest_chapter(au)

    # Both drafts ≥1 should be deleted
    drafts_dir = au / "chapters" / ".drafts"
    remaining = list(drafts_dir.iterdir()) if drafts_dir.exists() else []
    assert len(remaining) == 0


# ===== facts 回滚 =====


def test_undo_resolves_rollback(tmp_path):
    """第 N 章有 resolved fact → undo 后旧伏笔恢复为 unresolved。"""
    au = _setup_au(tmp_path)
    _save_state(au, current_chapter=1)
    confirm, undo, fact_repo, ops_repo, *_ = _build_services()

    # 先添加一个 unresolved 伏笔（在 ch0 上下文中，手动创建）
    foreshadow = Fact(
        id="f_foreshadow", content_raw="伏笔", content_clean="伏笔",
        chapter=0, status=FactStatus.UNRESOLVED, type=FactType.FORESHADOWING,
        source=FactSource.MANUAL, revision=1,
        created_at="2025-01-01T00:00:00Z", updated_at="2025-01-01T00:00:00Z",
    )
    fact_repo.append(str(au), foreshadow)

    # Confirm ch1 with a draft
    _save_draft(au, 1, "A", "第一章正文。")
    confirm.confirm_chapter(au, 1, "ch0001_draft_A.md")

    # 模拟 ch1 中添加了一个 resolving fact（通过 ops add_fact 记录）
    resolving = Fact(
        id="f_resolving", content_raw="揭示", content_clean="揭示",
        chapter=1, status=FactStatus.ACTIVE, type=FactType.CHARACTER_DETAIL,
        resolves="f_foreshadow",
        source=FactSource.MANUAL, revision=1,
        created_at="2025-01-01T00:00:00Z", updated_at="2025-01-01T00:00:00Z",
    )
    fact_repo.append(str(au), resolving)

    # 记录 add_fact ops（undo 步骤 4 需要）
    ops_repo.append(str(au), OpsEntry(
        op_id="op_add_fact", op_type="add_fact", target_id="f_resolving",
        chapter_num=1, timestamp="2025-01-01T00:00:00Z", payload={},
    ))

    # 模拟伏笔已被 resolved（正常流程中由 Service 联动）
    foreshadow.status = FactStatus.RESOLVED
    fact_repo.update(str(au), foreshadow)

    # Undo
    undo.undo_latest_chapter(au)

    # 伏笔应恢复为 unresolved
    restored = fact_repo.get(str(au), "f_foreshadow")
    assert restored is not None
    assert restored.status == FactStatus.UNRESOLVED

    # resolving fact 已物理删除
    assert fact_repo.get(str(au), "f_resolving") is None


def test_undo_facts_deletion_via_ops(tmp_path):
    """facts 通过 ops target_id 精准删除，不波及其他章节。"""
    au = _setup_au(tmp_path)
    _save_state(au, current_chapter=1)
    confirm, undo, fact_repo, ops_repo, *_ = _build_services()

    # 其他章的 fact（不应被删除）
    other_fact = Fact(
        id="f_other", content_raw="其他", content_clean="其他",
        chapter=99, status=FactStatus.ACTIVE, type=FactType.PLOT_EVENT,
        source=FactSource.MANUAL, revision=1,
        created_at="2025-01-01T00:00:00Z", updated_at="2025-01-01T00:00:00Z",
    )
    fact_repo.append(str(au), other_fact)

    # Confirm ch1
    _save_draft(au, 1, "A", "正文")
    confirm.confirm_chapter(au, 1, "ch0001_draft_A.md")

    # ch1 的 fact + ops 记录
    ch1_fact = Fact(
        id="f_ch1", content_raw="ch1 fact", content_clean="ch1 fact",
        chapter=1, status=FactStatus.ACTIVE, type=FactType.PLOT_EVENT,
        source=FactSource.MANUAL, revision=1,
        created_at="2025-01-01T00:00:00Z", updated_at="2025-01-01T00:00:00Z",
    )
    fact_repo.append(str(au), ch1_fact)
    ops_repo.append(str(au), OpsEntry(
        op_id="op_af1", op_type="add_fact", target_id="f_ch1",
        chapter_num=1, timestamp="2025-01-01T00:00:00Z", payload={},
    ))

    # Undo
    undo.undo_latest_chapter(au)

    # ch1 fact 已删除
    assert fact_repo.get(str(au), "f_ch1") is None
    # 其他 fact 不受影响
    assert fact_repo.get(str(au), "f_other") is not None


# ===== 快照降级 =====


def test_snapshot_restore_from_ops(tmp_path):
    """ops 中有 N-1 的快照 → 从快照恢复。"""
    au = _setup_au(tmp_path)
    _save_state(au, current_chapter=1)
    confirm, undo, _, _, state_repo, *_ = _build_services()

    # Confirm ch1 → ch2
    _save_draft(au, 1, "A", "第一章。林深走出门外。")
    confirm.confirm_chapter(au, 1, "ch0001_draft_A.md", _make_gw(), CAST)

    # 记录 ch1 确认后的状态（用于验证 undo ch2 后的恢复）
    state_after_ch1 = asyncio.run(state_repo.get(str(au)))
    ch1_scene_ending = state_after_ch1.last_scene_ending
    ch1_chars = dict(state_after_ch1.characters_last_seen)

    # Confirm ch2 → ch3
    _save_draft(au, 2, "A", "第二章。陈明开始整理。陈律师突然到访。")
    confirm.confirm_chapter(au, 2, "ch0002_draft_A.md", _make_gw(), CAST)

    state = asyncio.run(state_repo.get(str(au)))
    assert state.current_chapter == 3

    # Undo ch2
    undo.undo_latest_chapter(au, CAST)

    state = asyncio.run(state_repo.get(str(au)))
    assert state.current_chapter == 2

    # last_scene_ending 从 ch1 的 ops 快照精确恢复
    assert state.last_scene_ending == ch1_scene_ending

    # characters_last_seen 从 ch1 的 ops 快照精确恢复
    assert state.characters_last_seen == ch1_chars
    assert "林深" in state.characters_last_seen
    # 陈律师只在 ch2 出场，ch1 快照中不含，undo 后不应存在
    assert "陈律师" not in state.characters_last_seen


def test_fallback_last_scene_ending_from_file(tmp_path):
    """ops 中无快照 → last_scene_ending 从 ch{N-1}.md 末尾读取。"""
    au = _setup_au(tmp_path)

    # 手动创建已确认章节 (不通过 confirm，模拟导入)
    from core.domain.chapter import Chapter
    from infra.storage_local.file_utils import compute_content_hash

    ch1_content = "导入的第一章内容。这是最后一句话。"
    ch1 = Chapter(
        au_id=str(au), chapter_num=1, content=ch1_content,
        chapter_id="ch_import_1", revision=1, confirmed_at="2025-01-01T00:00:00Z",
        content_hash=compute_content_hash(ch1_content), provenance="imported",
    )
    asyncio.run(LocalFileChapterRepository().save(ch1))

    ch2_content = "导入的第二章内容。"
    ch2 = Chapter(
        au_id=str(au), chapter_num=2, content=ch2_content,
        chapter_id="ch_import_2", revision=1, confirmed_at="2025-01-01T00:00:00Z",
        content_hash=compute_content_hash(ch2_content), provenance="imported",
    )
    asyncio.run(LocalFileChapterRepository().save(ch2))

    _save_state(au, current_chapter=3)

    _, undo, *_ = _build_services()
    undo.undo_latest_chapter(au, CAST)

    state = asyncio.run(LocalFileStateRepository().get(str(au)))
    # Should fallback to reading ch1 last ~50 chars
    assert "这是最后一句话" in state.last_scene_ending


def test_fallback_characters_full_scan(tmp_path):
    """ops 中无快照 → characters_last_seen 全量扫描重建。"""
    au = _setup_au(tmp_path)

    from core.domain.chapter import Chapter
    from infra.storage_local.file_utils import compute_content_hash

    # 两章导入（无 ops confirm 记录）
    for i, (content, chars) in enumerate([
        ("林深在场。", ["林深"]),
        ("陈明出现了。林深也在。", ["陈明", "林深"]),
    ], 1):
        ch = Chapter(
            au_id=str(au), chapter_num=i, content=content,
            chapter_id=f"ch_imp_{i}", revision=1, confirmed_at="2025-01-01T00:00:00Z",
            content_hash=compute_content_hash(content), provenance="imported",
        )
        asyncio.run(LocalFileChapterRepository().save(ch))

    # ch3 to be undone
    ch3 = Chapter(
        au_id=str(au), chapter_num=3, content="陈律师来了。",
        chapter_id="ch_imp_3", revision=1, confirmed_at="2025-01-01T00:00:00Z",
        content_hash=compute_content_hash("陈律师来了。"), provenance="imported",
    )
    asyncio.run(LocalFileChapterRepository().save(ch3))

    _save_state(au, current_chapter=4)

    _, undo, *_ = _build_services()
    undo.undo_latest_chapter(au, CAST)

    state = asyncio.run(LocalFileStateRepository().get(str(au)))
    # 全量扫描 ch1+ch2 重建
    assert state.characters_last_seen.get("林深") == 2
    assert state.characters_last_seen.get("陈明") == 2
    # 陈律师 only in ch3 (deleted), should not appear
    assert "陈律师" not in state.characters_last_seen


# ===== 连续操作 =====


def test_confirm_two_undo_two(tmp_path):
    """confirm 两章 → undo → 再 undo → 回到初始状态。"""
    au = _setup_au(tmp_path)
    _save_state(au, current_chapter=1)
    confirm, undo, _, _, state_repo, chapter_repo, _ = _build_services()

    # Confirm ch1
    _save_draft(au, 1, "A", "第一章。林深。")
    confirm.confirm_chapter(au, 1, "ch0001_draft_A.md", _make_gw(), CAST)

    # Confirm ch2
    _save_draft(au, 2, "A", "第二章。陈明。")
    confirm.confirm_chapter(au, 2, "ch0002_draft_A.md", _make_gw(), CAST)

    state = asyncio.run(state_repo.get(str(au)))
    assert state.current_chapter == 3

    # Undo ch2
    undo.undo_latest_chapter(au, CAST)
    state = asyncio.run(state_repo.get(str(au)))
    assert state.current_chapter == 2
    assert not (au / "chapters" / "main" / "ch0002.md").exists()
    assert (au / "chapters" / "main" / "ch0001.md").exists()

    # Undo ch1
    undo.undo_latest_chapter(au, CAST)
    state = asyncio.run(state_repo.get(str(au)))
    assert state.current_chapter == 1
    assert not (au / "chapters" / "main" / "ch0001.md").exists()

    # 回到初始状态
    assert state.characters_last_seen == {}
    assert state.last_scene_ending == ""
    assert state.chapter_focus == []
