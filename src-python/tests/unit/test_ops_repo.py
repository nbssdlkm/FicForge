# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""Ops Repository 单元测试。"""

import json
import threading

import pytest
import yaml

from core.domain.enums import OpType
from core.domain.ops_entry import OpsEntry
from infra.storage_local.directory import ensure_au_directories
from infra.storage_local.validate_repair import validate_and_repair_project
from repositories.implementations.local_file_ops import (
    LocalFileOpsRepository,
    generate_op_id,
)


def _setup_au(tmp_path):
    au = tmp_path / "test_au"
    ensure_au_directories(au)
    return au


def _make_entry(**overrides):
    defaults = {
        "op_id": generate_op_id(),
        "op_type": "confirm_chapter",
        "target_id": "ch_abc123",
        "timestamp": "2025-03-24T14:22:00Z",
        "chapter_num": 38,
        "payload": {
            "focus": ["f033"],
            "last_scene_ending_snapshot": "林深关上了咖啡馆的灯",
            "characters_last_seen_snapshot": {"林深": 38, "陈明": 37},
        },
    }
    defaults.update(overrides)
    return OpsEntry(**defaults)


# ===== 基础读写 =====


def test_empty_file_returns_empty(tmp_path):
    """空文件 → get_all 返回空列表。"""
    au = _setup_au(tmp_path)
    (au / "ops.jsonl").write_text("", encoding="utf-8")
    repo = LocalFileOpsRepository()
    assert repo.list_all(str(au)) == []


def test_no_file_returns_empty(tmp_path):
    """文件不存在 → get_all 返回空列表。"""
    au = _setup_au(tmp_path)
    repo = LocalFileOpsRepository()
    assert repo.list_all(str(au)) == []


def test_append_and_read_single(tmp_path):
    """append 一条 → 读回验证所有字段正确。"""
    au = _setup_au(tmp_path)
    repo = LocalFileOpsRepository()
    entry = _make_entry(
        op_id="op_123_abcd",
        op_type="confirm_chapter",
        target_id="ch_test",
        chapter_num=5,
    )
    repo.append(str(au), entry)

    loaded = repo.list_all(str(au))
    assert len(loaded) == 1
    e = loaded[0]
    assert e.op_id == "op_123_abcd"
    assert e.op_type == "confirm_chapter"
    assert e.target_id == "ch_test"
    assert e.chapter_num == 5
    assert e.timestamp == "2025-03-24T14:22:00Z"
    assert e.payload["focus"] == ["f033"]
    assert e.payload["last_scene_ending_snapshot"] == "林深关上了咖啡馆的灯"


def test_append_multiple_order(tmp_path):
    """append 多条不同 op_type → 读回顺序正确且逐条完整。"""
    au = _setup_au(tmp_path)
    repo = LocalFileOpsRepository()
    types = ["confirm_chapter", "add_fact", "edit_fact", "undo_chapter", "set_chapter_focus"]
    for i, t in enumerate(types):
        repo.append(str(au), _make_entry(op_id=f"op_{i}_test", op_type=t))

    loaded = repo.list_all(str(au))
    assert len(loaded) == 5
    assert [e.op_type for e in loaded] == types


def test_each_line_valid_json(tmp_path):
    """每行是独立有效 JSON。"""
    au = _setup_au(tmp_path)
    repo = LocalFileOpsRepository()
    for i in range(3):
        repo.append(str(au), _make_entry(op_id=f"op_{i}_json"))

    lines = (au / "ops.jsonl").read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == 3
    for line in lines:
        d = json.loads(line)
        assert "op_id" in d


# ===== op_id =====


def test_generate_op_id_format():
    """generate_op_id 格式正确。"""
    oid = generate_op_id()
    parts = oid.split("_")
    assert parts[0] == "op"
    assert parts[1].isdigit()
    assert len(parts[2]) == 4
    assert all(c in "abcdefghijklmnopqrstuvwxyz0123456789" for c in parts[2])


def test_generate_op_id_unique():
    """连续生成不重复。"""
    ids = {generate_op_id() for _ in range(100)}
    assert len(ids) == 100


# ===== OpType 枚举 =====


def test_op_type_enum_values():
    """11 个 op_type 值全部存在且可序列化为字符串。"""
    expected = [
        "confirm_chapter", "undo_chapter", "import_project",
        "add_fact", "edit_fact", "update_fact_status",
        "set_chapter_focus", "resolve_dirty_chapter",
        "rebuild_index", "recalc_global_state", "update_pinned",
    ]
    assert len(OpType) == 11
    for val in expected:
        member = OpType(val)
        assert member.value == val
        assert str(member.value) == val


# ===== 查询方法 =====


def test_get_by_chapter(tmp_path):
    """get_by_chapter 正确过滤。"""
    au = _setup_au(tmp_path)
    repo = LocalFileOpsRepository()
    repo.append(str(au), _make_entry(op_id="op_c1", chapter_num=1))
    repo.append(str(au), _make_entry(op_id="op_c2", chapter_num=2))
    repo.append(str(au), _make_entry(op_id="op_c1b", chapter_num=1))

    result = repo.list_by_chapter(str(au), 1)
    assert [e.op_id for e in result] == ["op_c1", "op_c1b"]


def test_get_by_op_type(tmp_path):
    """get_by_op_type 正确过滤。"""
    au = _setup_au(tmp_path)
    repo = LocalFileOpsRepository()
    repo.append(str(au), _make_entry(op_id="op_a", op_type="add_fact"))
    repo.append(str(au), _make_entry(op_id="op_b", op_type="confirm_chapter"))
    repo.append(str(au), _make_entry(op_id="op_c", op_type="add_fact"))

    result = repo.get_by_op_type(str(au), "add_fact")
    assert [e.op_id for e in result] == ["op_a", "op_c"]


def test_get_confirm_for_chapter(tmp_path):
    """get_confirm_for_chapter 返回正确的 confirm_chapter 记录。"""
    au = _setup_au(tmp_path)
    repo = LocalFileOpsRepository()
    repo.append(str(au), _make_entry(
        op_id="op_conf",
        op_type="confirm_chapter",
        chapter_num=38,
        payload={
            "last_scene_ending_snapshot": "场景结尾",
            "characters_last_seen_snapshot": {"林深": 38},
        },
    ))
    repo.append(str(au), _make_entry(op_id="op_other", op_type="add_fact", chapter_num=38))

    result = repo.get_confirm_for_chapter(str(au), 38)
    assert result is not None
    assert result.op_id == "op_conf"
    assert result.payload["last_scene_ending_snapshot"] == "场景结尾"
    assert result.payload["characters_last_seen_snapshot"]["林深"] == 38


def test_get_confirm_for_chapter_none(tmp_path):
    """get_confirm_for_chapter 无记录时返回 None。"""
    au = _setup_au(tmp_path)
    repo = LocalFileOpsRepository()
    repo.append(str(au), _make_entry(op_type="add_fact", chapter_num=38))

    assert repo.get_confirm_for_chapter(str(au), 38) is None
    assert repo.get_confirm_for_chapter(str(au), 99) is None


def test_get_add_facts_for_chapter(tmp_path):
    """get_add_facts_for_chapter 返回正确的 add_fact 记录列表。"""
    au = _setup_au(tmp_path)
    repo = LocalFileOpsRepository()
    repo.append(str(au), _make_entry(op_id="op_af1", op_type="add_fact", target_id="f001", chapter_num=38))
    repo.append(str(au), _make_entry(op_id="op_cf", op_type="confirm_chapter", chapter_num=38))
    repo.append(str(au), _make_entry(op_id="op_af2", op_type="add_fact", target_id="f002", chapter_num=38))
    repo.append(str(au), _make_entry(op_id="op_af3", op_type="add_fact", target_id="f003", chapter_num=39))

    result = repo.get_add_facts_for_chapter(str(au), 38)
    assert [e.target_id for e in result] == ["f001", "f002"]


def test_get_add_facts_for_chapter_empty(tmp_path):
    """get_add_facts_for_chapter 无记录时返回空列表。"""
    au = _setup_au(tmp_path)
    repo = LocalFileOpsRepository()
    assert repo.get_add_facts_for_chapter(str(au), 99) == []


def test_get_latest_by_type(tmp_path):
    """get_latest_by_type 返回最新一条。"""
    au = _setup_au(tmp_path)
    repo = LocalFileOpsRepository()
    repo.append(str(au), _make_entry(op_id="op_1", op_type="rebuild_index"))
    repo.append(str(au), _make_entry(op_id="op_2", op_type="add_fact"))
    repo.append(str(au), _make_entry(op_id="op_3", op_type="rebuild_index"))

    result = repo.get_latest_by_type(str(au), "rebuild_index")
    assert result is not None
    assert result.op_id == "op_3"

    assert repo.get_latest_by_type(str(au), "import_project") is None


# ===== append-only 语义 =====


def test_append_only_grows(tmp_path):
    """连续 append 多条后文件内容只增不减。"""
    au = _setup_au(tmp_path)
    repo = LocalFileOpsRepository()
    sizes = []
    for i in range(5):
        repo.append(str(au), _make_entry(op_id=f"op_{i}"))
        sizes.append((au / "ops.jsonl").stat().st_size)
    for i in range(1, len(sizes)):
        assert sizes[i] > sizes[i - 1]


def test_no_update_or_delete_methods():
    """不提供 update 或 delete 方法。"""
    repo = LocalFileOpsRepository()
    assert not hasattr(repo, "update")
    assert not hasattr(repo, "delete")
    assert not hasattr(repo, "delete_by_ids")
    assert not hasattr(repo, "delete_by_chapter")


# ===== 损坏行容错 =====


def test_corrupted_middle_line(tmp_path):
    """中间一行损坏 → 跳过该行，其余正常加载。"""
    au = _setup_au(tmp_path)
    valid1 = json.dumps({"op_id": "op_1", "op_type": "add_fact", "target_id": "f1", "timestamp": "t1", "payload": {}})
    valid2 = json.dumps({"op_id": "op_2", "op_type": "add_fact", "target_id": "f2", "timestamp": "t2", "payload": {}})
    content = valid1 + "\n{{corrupted}}\n" + valid2 + "\n"
    (au / "ops.jsonl").write_text(content, encoding="utf-8")

    repo = LocalFileOpsRepository()
    entries = repo.list_all(str(au))
    assert len(entries) == 2
    assert entries[0].op_id == "op_1"
    assert entries[1].op_id == "op_2"


def test_corrupted_tail_line(tmp_path):
    """末尾一行损坏（半截 JSON）→ 截断丢弃。"""
    au = _setup_au(tmp_path)
    valid = json.dumps({"op_id": "op_1", "op_type": "add_fact", "target_id": "f1", "timestamp": "t1", "payload": {}})
    content = valid + '\n{"op_id": "op_2", "op_type": "add_fa'  # 半截 JSON
    (au / "ops.jsonl").write_text(content, encoding="utf-8")

    repo = LocalFileOpsRepository()
    entries = repo.list_all(str(au))
    assert len(entries) == 1
    assert entries[0].op_id == "op_1"


# ===== validate_repair =====


def test_validate_repair_ops_backup(tmp_path):
    """末尾损坏行截断 + .bak 备份生成 + needs_sync_unsafe。"""
    au = _setup_au(tmp_path)
    valid = json.dumps({"op_id": "op_v", "op_type": "add_fact", "target_id": "f1", "timestamp": "t1", "payload": {}})
    (au / "ops.jsonl").write_text(valid + "\n{{bad tail}}\n", encoding="utf-8")
    (au / "project.yaml").write_text(
        yaml.dump({"project_id": "p1", "au_id": str(au)}), encoding="utf-8"
    )
    (au / "state.yaml").write_text(
        yaml.dump({"sync_unsafe": False}), encoding="utf-8"
    )

    result = validate_and_repair_project(au)

    # .bak 已生成
    assert (au / "ops.jsonl.bak").exists()
    # needs_sync_unsafe 已标记
    assert result.needs_sync_unsafe is True
    # state.yaml sync_unsafe 已更新
    state_raw = yaml.safe_load((au / "state.yaml").read_text(encoding="utf-8"))
    assert state_raw["sync_unsafe"] is True
    # 干净文件只有有效行
    repo = LocalFileOpsRepository()
    entries = repo.list_all(str(au))
    assert len(entries) == 1
    assert entries[0].op_id == "op_v"
    # repair log 包含相关记录
    assert any("损坏行跳过" in r for r in result.repairs)
    assert any("备份" in r for r in result.repairs)
    assert any("sync_unsafe" in r for r in result.repairs)


def test_validate_repair_ops_clean(tmp_path):
    """无损坏时不触发 sync_unsafe。"""
    au = _setup_au(tmp_path)
    valid = json.dumps({"op_id": "op_ok", "op_type": "add_fact", "target_id": "f1", "timestamp": "t1", "payload": {}})
    (au / "ops.jsonl").write_text(valid + "\n", encoding="utf-8")
    (au / "project.yaml").write_text(
        yaml.dump({"project_id": "p1", "au_id": str(au)}), encoding="utf-8"
    )

    result = validate_and_repair_project(au)
    assert result.needs_sync_unsafe is False
    assert not (au / "ops.jsonl.bak").exists()


# ===== 并发安全 =====


def test_concurrent_append(tmp_path):
    """两个线程同时 append → 文件未损坏，两条都成功写入。"""
    au = _setup_au(tmp_path)
    repo = LocalFileOpsRepository()
    errors = []

    def worker(op_id):
        try:
            repo.append(str(au), _make_entry(op_id=op_id))
        except Exception as e:
            errors.append(e)

    t1 = threading.Thread(target=worker, args=("op_t1",))
    t2 = threading.Thread(target=worker, args=("op_t2",))
    t1.start()
    t2.start()
    t1.join()
    t2.join()

    assert not errors
    entries = repo.list_all(str(au))
    ids = {e.op_id for e in entries}
    assert "op_t1" in ids
    assert "op_t2" in ids
    assert len(entries) == 2

    # 验证文件是合法 JSONL
    lines = (au / "ops.jsonl").read_text(encoding="utf-8").strip().split("\n")
    for line in lines:
        json.loads(line)
