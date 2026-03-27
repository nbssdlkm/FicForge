"""阶段 1 核心状态机全量集成审计。

模拟完整用户旅程，验证所有 Repository + Service 在整个生命周期中保持数据一致。
覆盖：confirm → add_fact → set_focus → undo → re-confirm → dirty resolve → 边界条件。
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from core.domain.chapter import Chapter
from core.domain.draft import Draft
from core.domain.enums import FactSource, FactStatus, FactType
from core.domain.fact import Fact
from core.domain.generated_with import GeneratedWith
from core.domain.state import State
from core.services.au_mutex import AUMutexManager
from core.services.confirm_chapter import ConfirmChapterService
from core.services.dirty_resolve import DirtyResolveError, ResolveDirtyChapterService
from core.services.facts_lifecycle import (
    FactsLifecycleError,
    add_fact,
    edit_fact,
    set_chapter_focus,
    update_fact_status,
)
from core.services.undo_chapter import UndoChapterError, UndoChapterService
from infra.storage_local.directory import ensure_au_directories
from infra.storage_local.file_utils import compute_content_hash
from repositories.implementations.local_file_chapter import LocalFileChapterRepository
from repositories.implementations.local_file_draft import LocalFileDraftRepository
from repositories.implementations.local_file_fact import LocalFileFactRepository
from repositories.implementations.local_file_ops import LocalFileOpsRepository
from repositories.implementations.local_file_state import LocalFileStateRepository


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

CAST = {"from_core": ["林深", "陈明", "陈律师"], "au_specific": [], "oc": []}


def _gw() -> GeneratedWith:
    return GeneratedWith(
        mode="api", model="deepseek-chat", temperature=1.0, top_p=0.95,
        input_tokens=10000, output_tokens=1500, char_count=1200,
        duration_ms=5000, generated_at="2025-03-24T14:22:00Z",
    )


class _Env:
    """Shared test environment — repos + services wired together."""

    def __init__(self, au: Path) -> None:
        self.au = au
        self.chapter_repo = LocalFileChapterRepository()
        self.draft_repo = LocalFileDraftRepository()
        self.state_repo = LocalFileStateRepository()
        self.ops_repo = LocalFileOpsRepository()
        self.fact_repo = LocalFileFactRepository()
        mutex = AUMutexManager()

        self.confirm = ConfirmChapterService(
            chapter_repo=self.chapter_repo,
            draft_repo=self.draft_repo,
            state_repo=self.state_repo,
            ops_repo=self.ops_repo,
            au_mutex=mutex,
        )
        self.undo = UndoChapterService(
            chapter_repo=self.chapter_repo,
            draft_repo=self.draft_repo,
            state_repo=self.state_repo,
            ops_repo=self.ops_repo,
            fact_repo=self.fact_repo,
            au_mutex=mutex,
        )
        self.dirty = ResolveDirtyChapterService(
            chapter_repo=self.chapter_repo,
            state_repo=self.state_repo,
            ops_repo=self.ops_repo,
            fact_repo=self.fact_repo,
            au_mutex=mutex,
        )

    # convenience wrappers
    def save_draft(self, ch: int, variant: str, content: str) -> None:
        self.draft_repo.save(
            Draft(au_id=str(self.au), chapter_num=ch, variant=variant, content=content)
        )

    def save_state(self, **kw: object) -> None:
        defaults: dict = {"au_id": str(self.au), "current_chapter": 1}
        defaults.update(kw)
        self.state_repo.save(State(**defaults))

    def get_state(self) -> State:
        return self.state_repo.get(str(self.au))

    def get_chapter(self, n: int) -> Chapter:
        return self.chapter_repo.get(str(self.au), n)

    def confirm_ch(self, n: int, content: str) -> dict:
        self.save_draft(n, "A", content)
        return self.confirm.confirm_chapter(
            self.au, n, f"ch{n:04d}_draft_A.md", _gw(), CAST,
        )

    def all_ops(self) -> list:
        return self.ops_repo.list_all(str(self.au))


def _setup(tmp_path: Path) -> _Env:
    au = tmp_path / "lifecycle_au"
    ensure_au_directories(au)
    env = _Env(au)
    env.save_state(current_chapter=1)
    return env


def _assert_op_ids_unique(ops: list) -> None:
    ids = [o.op_id for o in ops]
    assert len(ids) == len(set(ids)), f"Duplicate op_ids: {ids}"
    for oid in ids:
        assert re.match(r"^op_\d+_[a-z0-9]{4}$", oid), f"Bad op_id format: {oid}"


# ===========================================================================
# 场景 1：完整写作循环
# ===========================================================================


def test_scenario1_full_writing_cycle(tmp_path: Path) -> None:
    """完整写作循环：confirm → add facts → set focus → confirm ch2 → undo → re-confirm → dirty resolve。"""
    env = _setup(tmp_path)
    au = str(env.au)

    # --- step 3: 验证初始状态 ---
    s = env.get_state()
    assert s.current_chapter == 1
    assert s.characters_last_seen == {}
    assert s.chapter_focus == []

    # --- step 4-5: 生成两个草稿，确认 B ---
    env.save_draft(1, "A", "草稿 A 内容，不被选中。")
    env.save_draft(1, "B", "第一章正文。林深走进咖啡馆。陈明正在擦杯子。")
    env.confirm.confirm_chapter(
        env.au, 1, "ch0001_draft_B.md", _gw(), CAST,
    )

    # --- step 6: 验证确认结果 ---
    import frontmatter as fm
    ch1_path = env.au / "chapters" / "main" / "ch0001.md"
    assert ch1_path.exists()
    post = fm.loads(ch1_path.read_text("utf-8"))
    assert post.metadata["chapter_id"] != ""
    assert post.metadata["revision"] == 1
    assert "confirmed_at" in post.metadata
    assert post.metadata["content_hash"] == compute_content_hash(post.content)
    assert post.metadata["provenance"] == "ai"
    assert "generated_with" in post.metadata

    s = env.get_state()
    assert s.current_chapter == 2
    assert s.chapter_focus == []
    assert s.last_scene_ending != ""
    assert "林深" in s.characters_last_seen
    assert "陈明" in s.characters_last_seen

    ops = env.all_ops()
    confirm_ops = [o for o in ops if o.op_type == "confirm_chapter"]
    assert len(confirm_ops) == 1
    assert "characters_last_seen_snapshot" in confirm_ops[0].payload

    # .drafts/ 已清理
    drafts = list((env.au / "chapters" / ".drafts").iterdir())
    ch1_drafts = [d for d in drafts if d.name.startswith("ch0001")]
    assert len(ch1_drafts) == 0

    # --- step 7-8: add facts + set focus ---
    f_unresolved = add_fact(
        env.au, 1,
        {"content_raw": "伏笔 A", "content_clean": "伏笔 A",
         "status": "unresolved", "type": "foreshadowing", "chapter": 1},
        env.fact_repo, env.ops_repo,
    )
    f_active = add_fact(
        env.au, 1,
        {"content_raw": "事件 B", "content_clean": "事件 B",
         "status": "active", "type": "plot_event", "chapter": 1},
        env.fact_repo, env.ops_repo,
    )

    set_chapter_focus(env.au, [f_unresolved.id], env.fact_repo, env.ops_repo, env.state_repo)

    # --- step 9: 验证 ---
    s = env.get_state()
    assert s.chapter_focus == [f_unresolved.id]
    focus_ops = [o for o in env.all_ops() if o.op_type == "set_chapter_focus"]
    assert len(focus_ops) == 1

    # --- step 10-11: 确认第 2 章 ---
    env.confirm_ch(2, "第二章正文。陈律师突然到访。林深看了一眼。")
    s = env.get_state()
    assert s.current_chapter == 3
    assert s.last_confirmed_chapter_focus == [f_unresolved.id]
    assert "陈律师" in s.characters_last_seen

    # --- step 12-13: 撤销第 2 章 ---
    # 先为第 2 章添加一个 fact（通过 ops add_fact 记录），验证 undo 时被精准删除
    f_ch2 = add_fact(
        env.au, 2,
        {"content_raw": "ch2 fact", "content_clean": "ch2 fact",
         "status": "active", "type": "plot_event", "chapter": 2},
        env.fact_repo, env.ops_repo,
    )

    env.undo.undo_latest_chapter(env.au, CAST)

    s = env.get_state()
    assert s.current_chapter == 2
    assert not (env.au / "chapters" / "main" / "ch0002.md").exists()
    # ch2 的 fact 已物理删除
    assert env.fact_repo.get(au, f_ch2.id) is None
    # ch1 的 facts 不受影响
    assert env.fact_repo.get(au, f_unresolved.id) is not None
    assert env.fact_repo.get(au, f_active.id) is not None
    # characters_last_seen 回滚（陈律师只在 ch2，不应在）
    assert s.characters_last_seen.get("林深") == 1
    assert "陈律师" not in s.characters_last_seen

    undo_ops = [o for o in env.all_ops() if o.op_type == "undo_chapter"]
    assert len(undo_ops) == 1

    # --- step 14-15: 重新确认第 2 章 ---
    env.confirm_ch(2, "新版第二章。陈明出门买咖啡。")
    s = env.get_state()
    assert s.current_chapter == 3

    # --- step 16-19: dirty resolve ---
    ch2 = env.get_chapter(2)
    ch2.content = "编辑后的第二章。林深换了灯泡。"
    ch2.provenance = "mixed"
    env.chapter_repo.save(ch2)

    s = env.get_state()
    s.chapters_dirty.append(2)
    env.state_repo.save(s)

    env.dirty.resolve_dirty_chapter(env.au, 2, [], cast_registry=CAST)

    s = env.get_state()
    assert 2 not in s.chapters_dirty
    ch2_after = env.get_chapter(2)
    assert ch2_after.content_hash == compute_content_hash("编辑后的第二章。林深换了灯泡。")
    assert s.last_scene_ending != ""  # 最新章，重算了

    resolve_ops = [o for o in env.all_ops() if o.op_type == "resolve_dirty_chapter"]
    assert len(resolve_ops) == 1

    # --- 全局一致性检查 ---
    all_ops = env.all_ops()
    _assert_op_ids_unique(all_ops)
    assert s.revision > 0
    assert s.updated_at != ""


# ===========================================================================
# 场景 2：连续操作压力
# ===========================================================================


def test_scenario2_sequential_pressure(tmp_path: Path) -> None:
    """连续确认 5 章 → 撤销 3 章 → 再确认 2 章。"""
    env = _setup(tmp_path)

    contents = [
        "第一章。林深出场。",
        "第二章。陈明登场。",
        "第三章。陈律师到访。",
        "第四章。林深和陈明对话。",
        "第五章。陈律师提出方案。",
    ]

    # 连续确认 5 章
    for i, content in enumerate(contents, 1):
        env.confirm_ch(i, content)

    s = env.get_state()
    assert s.current_chapter == 6
    assert "林深" in s.characters_last_seen
    assert "陈明" in s.characters_last_seen
    assert "陈律师" in s.characters_last_seen

    # 连续撤销 3 章 (ch5, ch4, ch3)
    for _ in range(3):
        env.undo.undo_latest_chapter(env.au, CAST)

    s = env.get_state()
    assert s.current_chapter == 3
    assert not (env.au / "chapters" / "main" / "ch0005.md").exists()
    assert not (env.au / "chapters" / "main" / "ch0004.md").exists()
    assert not (env.au / "chapters" / "main" / "ch0003.md").exists()
    assert (env.au / "chapters" / "main" / "ch0001.md").exists()
    assert (env.au / "chapters" / "main" / "ch0002.md").exists()

    # 再确认 2 章
    env.confirm_ch(3, "新版第三章。林深做了决定。")
    env.confirm_ch(4, "新版第四章。故事继续。")

    s = env.get_state()
    assert s.current_chapter == 5

    # 全局一致性
    all_ops = env.all_ops()
    _assert_op_ids_unique(all_ops)
    confirm_count = sum(1 for o in all_ops if o.op_type == "confirm_chapter")
    undo_count = sum(1 for o in all_ops if o.op_type == "undo_chapter")
    assert confirm_count == 7  # 5 + 2
    assert undo_count == 3


# ===========================================================================
# 场景 3：Facts 生命周期完整流程
# ===========================================================================


def test_scenario3_facts_lifecycle(tmp_path: Path) -> None:
    """resolves 正向联动 → 反向级联 → 悬空清理 → 完整 ops 链。"""
    env = _setup(tmp_path)
    au = str(env.au)
    fr = env.fact_repo
    or_ = env.ops_repo
    sr = env.state_repo

    # 1. add_fact（unresolved 伏笔 A）
    fact_a = add_fact(env.au, 1, {
        "content_raw": "伏笔 A", "content_clean": "伏笔 A",
        "status": "unresolved", "type": "foreshadowing", "chapter": 1,
    }, fr, or_)
    assert fact_a.status == FactStatus.UNRESOLVED

    # 2. add_fact（fact B resolves A）
    fact_b = add_fact(env.au, 2, {
        "content_raw": "揭示 B", "content_clean": "揭示 B",
        "status": "active", "type": "character_detail", "chapter": 2,
        "resolves": fact_a.id,
    }, fr, or_)

    # 3. 验证 A 自动变 resolved
    a_loaded = fr.get(au, fact_a.id)
    assert a_loaded is not None
    assert a_loaded.status == FactStatus.RESOLVED

    # 4. edit_fact B，移除 resolves
    edit_fact(env.au, fact_b.id, {"resolves": None}, fr, or_, sr)

    # 5. 验证 A 恢复 unresolved（反向级联）
    a_loaded = fr.get(au, fact_a.id)
    assert a_loaded is not None
    assert a_loaded.status == FactStatus.UNRESOLVED

    # 6. 设置 chapter_focus 为 A
    set_chapter_focus(env.au, [fact_a.id], fr, or_, sr)
    s = env.get_state()
    assert s.chapter_focus == [fact_a.id]

    # 7. update_fact_status A → deprecated
    result = update_fact_status(env.au, fact_a.id, "deprecated", 1, fr, or_, sr)
    assert result["focus_warning"] is True

    # 8. 验证 chapter_focus 中 A 已被移除
    s = env.get_state()
    assert fact_a.id not in s.chapter_focus

    # 9. 验证完整 ops 链
    all_ops = env.all_ops()
    _assert_op_ids_unique(all_ops)
    op_types = [o.op_type for o in all_ops]
    assert op_types.count("add_fact") == 2
    assert op_types.count("edit_fact") == 1
    assert op_types.count("set_chapter_focus") == 1
    assert op_types.count("update_fact_status") == 1


# ===========================================================================
# 场景 4：Dirty 历史章 vs 最新章
# ===========================================================================


def test_scenario4_dirty_historical_vs_latest(tmp_path: Path) -> None:
    """历史章 dirty resolve 不动全局状态；最新章 dirty resolve 重算。"""
    env = _setup(tmp_path)

    # 确认 3 章
    env.confirm_ch(1, "第一章。林深。")
    env.confirm_ch(2, "第二章。陈明来了。")
    env.confirm_ch(3, "第三章。陈律师出场。林深思考。")

    s = env.get_state()
    assert s.current_chapter == 4
    chars_before = dict(s.characters_last_seen)
    ending_before = s.last_scene_ending

    # --- dirty 第 2 章（历史章）→ resolve ---
    ch2 = env.get_chapter(2)
    ch2.content = "编辑后的第二章。全新内容。"
    env.chapter_repo.save(ch2)
    s = env.get_state()
    s.chapters_dirty.append(2)
    env.state_repo.save(s)

    env.dirty.resolve_dirty_chapter(env.au, 2, [])

    s = env.get_state()
    assert 2 not in s.chapters_dirty
    # 历史章：characters_last_seen 和 last_scene_ending 不变
    assert s.characters_last_seen == chars_before
    assert s.last_scene_ending == ending_before

    # --- dirty 第 3 章（最新章）→ resolve ---
    ch3 = env.get_chapter(3)
    ch3.content = "重写的第三章。只有林深。全新结尾场景。"
    env.chapter_repo.save(ch3)
    s = env.get_state()
    s.chapters_dirty.append(3)
    env.state_repo.save(s)

    env.dirty.resolve_dirty_chapter(env.au, 3, [], cast_registry=CAST)

    s = env.get_state()
    assert 3 not in s.chapters_dirty
    # 最新章：content_hash + characters_last_seen + last_scene_ending 已重算
    ch3_after = env.get_chapter(3)
    assert ch3_after.content_hash == compute_content_hash("重写的第三章。只有林深。全新结尾场景。")
    assert "全新结尾场景" in s.last_scene_ending


# ===========================================================================
# 场景 5：边界条件
# ===========================================================================


def test_scenario5_empty_au_undo(tmp_path: Path) -> None:
    """空 AU 尝试 undo → 错误。"""
    env = _setup(tmp_path)
    with pytest.raises(UndoChapterError, match="没有已确认章节"):
        env.undo.undo_latest_chapter(env.au)


def test_scenario5_empty_au_dirty(tmp_path: Path) -> None:
    """空 AU 尝试 dirty resolve → 错误。"""
    env = _setup(tmp_path)
    with pytest.raises(DirtyResolveError, match="不在 chapters_dirty"):
        env.dirty.resolve_dirty_chapter(env.au, 1, [])


def test_scenario5_confirm_then_undo_to_zero(tmp_path: Path) -> None:
    """确认一章后 undo 回到零 → current_chapter=1。"""
    env = _setup(tmp_path)
    env.confirm_ch(1, "唯一一章。林深。")
    s = env.get_state()
    assert s.current_chapter == 2

    env.undo.undo_latest_chapter(env.au, CAST)
    s = env.get_state()
    assert s.current_chapter == 1
    assert s.characters_last_seen == {}
    assert s.last_scene_ending == ""


def test_scenario5_add_fact_creates_file(tmp_path: Path) -> None:
    """facts.jsonl 不存在时 add_fact → 正常创建文件。"""
    env = _setup(tmp_path)
    facts_path = env.au / "facts.jsonl"
    assert not facts_path.exists()

    add_fact(env.au, 1, {"content_raw": "x", "content_clean": "x"},
             env.fact_repo, env.ops_repo)

    assert facts_path.exists()
    facts = env.fact_repo.list_all(str(env.au))
    assert len(facts) == 1


def test_scenario5_focus_deprecated_fact(tmp_path: Path) -> None:
    """chapter_focus 选择 deprecated fact → 错误。"""
    env = _setup(tmp_path)

    f = add_fact(env.au, 1, {
        "content_raw": "x", "content_clean": "x", "status": "unresolved",
    }, env.fact_repo, env.ops_repo)

    update_fact_status(env.au, f.id, "deprecated", 1,
                       env.fact_repo, env.ops_repo, env.state_repo)

    with pytest.raises(FactsLifecycleError, match="只能选 unresolved"):
        set_chapter_focus(env.au, [f.id], env.fact_repo, env.ops_repo, env.state_repo)


def test_scenario5_focus_too_many(tmp_path: Path) -> None:
    """chapter_focus > 2 → 错误。"""
    env = _setup(tmp_path)
    with pytest.raises(FactsLifecycleError, match="最多 2 个"):
        set_chapter_focus(env.au, ["a", "b", "c"],
                          env.fact_repo, env.ops_repo, env.state_repo)


# ===========================================================================
# 全局一致性辅助检查
# ===========================================================================


def test_consistency_revision_increments(tmp_path: Path) -> None:
    """state.revision 每次写操作都 +1。"""
    env = _setup(tmp_path)
    revisions: list[int] = []

    s = env.get_state()
    revisions.append(s.revision)

    env.confirm_ch(1, "第一章。林深。")
    s = env.get_state()
    revisions.append(s.revision)

    set_chapter_focus(env.au, [], env.fact_repo, env.ops_repo, env.state_repo)
    s = env.get_state()
    revisions.append(s.revision)

    env.confirm_ch(2, "第二章。陈明。")
    s = env.get_state()
    revisions.append(s.revision)

    env.undo.undo_latest_chapter(env.au, CAST)
    s = env.get_state()
    revisions.append(s.revision)

    # 每次都应严格递增
    for i in range(1, len(revisions)):
        assert revisions[i] > revisions[i - 1], (
            f"Revision did not increase: {revisions}"
        )


def test_consistency_content_hash_always_matches(tmp_path: Path) -> None:
    """content_hash 始终与纯正文 SHA-256 一致。"""
    env = _setup(tmp_path)

    for i, content in enumerate(["一。林深。", "二。陈明。", "三。陈律师。"], 1):
        env.confirm_ch(i, content)

    # 验证每章 content_hash 一致
    for i, content in enumerate(["一。林深。", "二。陈明。", "三。陈律师。"], 1):
        ch = env.get_chapter(i)
        assert ch.content_hash == compute_content_hash(content), (
            f"Chapter {i} content_hash mismatch"
        )
