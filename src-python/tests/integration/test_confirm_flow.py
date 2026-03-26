"""确认章节完整流程集成测试。"""

import asyncio
import hashlib
import json

import pytest
import yaml

from core.domain.chapter import Chapter
from core.domain.draft import Draft
from core.domain.generated_with import GeneratedWith
from core.domain.state import State
from core.services.au_mutex import AUMutexManager
from core.services.confirm_chapter import ConfirmChapterError, ConfirmChapterService
from infra.storage_local.directory import ensure_au_directories
from infra.storage_local.file_utils import compute_content_hash
from repositories.implementations.local_file_chapter import LocalFileChapterRepository
from repositories.implementations.local_file_draft import LocalFileDraftRepository
from repositories.implementations.local_file_ops import LocalFileOpsRepository
from repositories.implementations.local_file_state import LocalFileStateRepository


def _build_service():
    return ConfirmChapterService(
        chapter_repo=LocalFileChapterRepository(),
        draft_repo=LocalFileDraftRepository(),
        state_repo=LocalFileStateRepository(),
        ops_repo=LocalFileOpsRepository(),
        au_mutex=AUMutexManager(),
    )


def _setup_au(tmp_path):
    au = tmp_path / "test_au"
    ensure_au_directories(au)
    return au


def _save_draft(au, chapter_num, variant, content):
    draft = Draft(au_id=str(au), chapter_num=chapter_num, variant=variant, content=content)
    asyncio.run(LocalFileDraftRepository().save(draft))


def _save_state(au, **overrides):
    defaults = {"au_id": str(au), "current_chapter": 1}
    defaults.update(overrides)
    state = State(**defaults)
    asyncio.run(LocalFileStateRepository().save(state))


# ===== 完整确认流程 =====

def test_full_confirm_flow(tmp_path):
    """准备草稿 → confirm → 验证全部产出。"""
    au = _setup_au(tmp_path)
    content = "第一章正文。林深走进咖啡馆。陈明正在擦杯子。"
    _save_draft(au, 1, "B", content)
    _save_state(au, current_chapter=1, chapter_focus=["f033"])

    gw = GeneratedWith(
        mode="api", model="deepseek-chat", temperature=1.0, top_p=0.95,
        input_tokens=12000, output_tokens=2000, char_count=len(content),
        duration_ms=5000, generated_at="2025-03-24T14:22:00Z",
    )
    cast = {"from_core": ["林深", "陈明"], "au_specific": [], "oc": []}

    service = _build_service()
    result = service.confirm_chapter(
        au_path=au, chapter_num=1, draft_id="ch0001_draft_B.md",
        generated_with=gw, cast_registry=cast,
    )

    # 章节文件已写入
    ch_path = au / "chapters" / "main" / "ch0001.md"
    assert ch_path.exists()

    # frontmatter 全字段
    import frontmatter
    post = frontmatter.loads(ch_path.read_text(encoding="utf-8"))
    assert post.metadata["chapter_id"] == result["chapter_id"]
    assert post.metadata["revision"] == 1
    assert post.metadata["confirmed_focus"] == ["f033"]
    assert post.metadata["confirmed_at"] != ""
    assert post.metadata["provenance"] == "ai"
    gw_meta = post.metadata["generated_with"]
    assert gw_meta["model"] == "deepseek-chat"
    assert gw_meta["mode"] == "api"
    assert gw_meta["temperature"] == 1.0
    assert gw_meta["top_p"] == 0.95
    assert gw_meta["input_tokens"] == 12000
    assert gw_meta["output_tokens"] == 2000
    assert gw_meta["char_count"] == len(content)
    assert gw_meta["duration_ms"] == 5000

    # content_hash 与纯正文 SHA-256 一致
    assert post.metadata["content_hash"] == compute_content_hash(content)

    # state 更新
    state = asyncio.run(LocalFileStateRepository().get(str(au)))
    assert state.current_chapter == 2  # +1
    assert state.last_scene_ending != ""
    assert state.characters_last_seen.get("林深") == 1
    assert state.characters_last_seen.get("陈明") == 1
    assert state.chapter_focus == []  # 已清空
    assert state.last_confirmed_chapter_focus == ["f033"]

    # ops.jsonl 有一条 confirm_chapter 记录
    ops = LocalFileOpsRepository().list_all(str(au))
    assert len(ops) == 1
    assert ops[0].op_type == "confirm_chapter"
    assert ops[0].chapter_num == 1
    assert ops[0].payload["focus"] == ["f033"]
    assert "characters_last_seen_snapshot" in ops[0].payload
    assert "last_scene_ending_snapshot" in ops[0].payload
    assert "generated_with" in ops[0].payload

    # 草稿已清理
    drafts = au / "chapters" / ".drafts"
    assert list(drafts.iterdir()) == [] or not any(
        f.name.startswith("ch0001") for f in drafts.iterdir()
    )


# ===== 状态更新边界 =====

def test_confirm_advances_current_chapter(tmp_path):
    """确认 current_chapter → current_chapter +1。"""
    au = _setup_au(tmp_path)
    _save_draft(au, 5, "A", "内容")
    _save_state(au, current_chapter=5)

    service = _build_service()
    service.confirm_chapter(au, 5, "ch0005_draft_A.md")

    state = asyncio.run(LocalFileStateRepository().get(str(au)))
    assert state.current_chapter == 6


def test_confirm_historical_no_advance(tmp_path):
    """确认历史章节（< current_chapter）→ current_chapter 不变。"""
    au = _setup_au(tmp_path)
    _save_draft(au, 3, "A", "旧章内容")
    _save_state(au, current_chapter=10)

    service = _build_service()
    service.confirm_chapter(au, 3, "ch0003_draft_A.md")

    state = asyncio.run(LocalFileStateRepository().get(str(au)))
    assert state.current_chapter == 10  # 不变


def test_characters_last_seen_max_merge(tmp_path):
    """characters_last_seen 取 max 合并：确认旧章节不降级近期记录。"""
    au = _setup_au(tmp_path)
    _save_draft(au, 3, "A", "林深在旧章出场。")
    _save_state(au, current_chapter=10, characters_last_seen={"林深": 8})

    cast = {"from_core": ["林深"], "au_specific": [], "oc": []}
    service = _build_service()
    service.confirm_chapter(au, 3, "ch0003_draft_A.md", cast_registry=cast)

    state = asyncio.run(LocalFileStateRepository().get(str(au)))
    assert state.characters_last_seen["林深"] == 8  # 保持 8，不降为 3


def test_last_scene_ending_only_on_advance(tmp_path):
    """last_scene_ending 仅推进最新章节时更新。"""
    au = _setup_au(tmp_path)
    _save_draft(au, 3, "A", "旧章结尾。")
    _save_state(au, current_chapter=10, last_scene_ending="原始结尾")

    service = _build_service()
    service.confirm_chapter(au, 3, "ch0003_draft_A.md")

    state = asyncio.run(LocalFileStateRepository().get(str(au)))
    assert state.last_scene_ending == "原始结尾"  # 不变


# ===== 备份逻辑 =====

def test_first_confirm_no_backup(tmp_path):
    """首次确认新章节 → 无备份生成。"""
    au = _setup_au(tmp_path)
    _save_draft(au, 1, "A", "新章内容")
    _save_state(au, current_chapter=1)

    service = _build_service()
    service.confirm_chapter(au, 1, "ch0001_draft_A.md")

    backups = au / "chapters" / "backups"
    backup_files = list(backups.iterdir()) if backups.exists() else []
    assert len(backup_files) == 0


def test_overwrite_creates_backup(tmp_path):
    """覆盖已有章节 → backups/ 下有备份。"""
    au = _setup_au(tmp_path)

    # 第一次确认
    _save_draft(au, 1, "A", "第一版内容")
    _save_state(au, current_chapter=1)
    service = _build_service()
    service.confirm_chapter(au, 1, "ch0001_draft_A.md")

    # 第二次确认（覆盖）
    _save_draft(au, 1, "A", "第二版内容")
    service.confirm_chapter(au, 1, "ch0001_draft_A.md")

    backups = au / "chapters" / "backups"
    backup_files = list(backups.iterdir())
    assert len(backup_files) == 1
    assert "ch0001_v1" in backup_files[0].name


def test_overwrite_increments_version(tmp_path):
    """多次覆盖 → 版本号递增。"""
    au = _setup_au(tmp_path)
    service = _build_service()

    for i in range(3):
        _save_draft(au, 1, "A", f"版本{i+1}")
        if i == 0:
            _save_state(au, current_chapter=1)
        service.confirm_chapter(au, 1, "ch0001_draft_A.md")

    backups = au / "chapters" / "backups"
    backup_files = sorted(backups.iterdir())
    assert len(backup_files) == 2  # v1 and v2 (first confirm has no backup)
    assert "v1" in backup_files[0].name
    assert "v2" in backup_files[1].name


# ===== draft_id 校验 =====

def test_invalid_draft_id_raises(tmp_path):
    """draft_id 对应文件不存在 → 返回错误，不执行任何写入。"""
    au = _setup_au(tmp_path)
    _save_state(au, current_chapter=1)

    service = _build_service()
    with pytest.raises(ConfirmChapterError, match="草稿文件不存在"):
        service.confirm_chapter(au, 1, "ch0001_draft_Z.md")

    # 无章节写入
    assert not (au / "chapters" / "main" / "ch0001.md").exists()
    # 无 ops 写入
    assert not (au / "ops.jsonl").exists()
    # state 未变更
    state = asyncio.run(LocalFileStateRepository().get(str(au)))
    assert state.current_chapter == 1


def test_malformed_draft_id_raises(tmp_path):
    """无效的 draft_id 格式 → 错误。"""
    au = _setup_au(tmp_path)
    _save_state(au, current_chapter=1)

    service = _build_service()
    with pytest.raises(ConfirmChapterError, match="无效的 draft_id"):
        service.confirm_chapter(au, 1, "not_a_draft.md")


def test_confirm_without_generated_with(tmp_path):
    """generated_with=None → 正常确认，ops payload.generated_with 为空 dict。"""
    au = _setup_au(tmp_path)
    _save_draft(au, 1, "A", "无生成信息的内容")
    _save_state(au, current_chapter=1)

    service = _build_service()
    result = service.confirm_chapter(au, 1, "ch0001_draft_A.md", generated_with=None)

    assert result["chapter_num"] == 1
    ops = LocalFileOpsRepository().list_all(str(au))
    assert len(ops) == 1
    assert ops[0].payload["generated_with"] == {}


def test_confirm_chapter_num_zero_raises(tmp_path):
    """chapter_num <= 0 → 错误。"""
    au = _setup_au(tmp_path)
    _save_state(au, current_chapter=1)

    service = _build_service()
    with pytest.raises(ConfirmChapterError, match="正整数"):
        service.confirm_chapter(au, 0, "ch0000_draft_A.md")
