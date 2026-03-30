"""TrashService 单元测试。D-0023 垃圾箱系统。"""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from core.services.trash_service import TrashService


@pytest.fixture
def scope_root(tmp_path: Path) -> Path:
    """创建一个带角色文件的 AU 目录。"""
    chars = tmp_path / "characters"
    chars.mkdir()
    (chars / "Connor.md").write_text("# Connor\n\nDetective android.", encoding="utf-8")
    (chars / "Hank.md").write_text("# Hank\n\nVeteran lieutenant.", encoding="utf-8")
    wb = tmp_path / "worldbuilding"
    wb.mkdir()
    (wb / "Detroit2038.md").write_text("# Detroit 2038\n\nAndroids everywhere.", encoding="utf-8")
    return tmp_path


class TestMoveToTrash:
    def test_move_file(self, scope_root: Path):
        ts = TrashService(retention_days=30)
        entry = ts.move_to_trash(scope_root, "characters/Connor.md", "character_file", "Connor")

        # 原文件已不存在
        assert not (scope_root / "characters" / "Connor.md").exists()
        # .trash/ 中有文件
        trash_file = scope_root / ".trash" / entry.trash_path
        assert trash_file.is_file()
        assert "Connor" in trash_file.read_text(encoding="utf-8")
        # manifest 有记录
        manifest = scope_root / ".trash" / "manifest.jsonl"
        assert manifest.is_file()
        records = [json.loads(l) for l in manifest.read_text(encoding="utf-8").strip().splitlines()]
        assert len(records) == 1
        assert records[0]["trash_id"] == entry.trash_id
        assert records[0]["original_path"] == "characters/Connor.md"
        assert records[0]["entity_type"] == "character_file"
        # metadata
        assert "file_size_bytes" in entry.metadata
        assert "Detective" in entry.metadata["preview"]

    def test_move_directory(self, scope_root: Path):
        ts = TrashService()
        entry = ts.move_to_trash(scope_root, "worldbuilding", "worldbuilding_dir", "worldbuilding")

        assert not (scope_root / "worldbuilding").exists()
        trash_dir = scope_root / ".trash" / entry.trash_path
        assert trash_dir.is_dir()
        assert entry.metadata.get("is_directory") is True

    def test_move_nonexistent_raises(self, scope_root: Path):
        ts = TrashService()
        with pytest.raises(FileNotFoundError):
            ts.move_to_trash(scope_root, "characters/Ghost.md", "character_file", "Ghost")

    def test_multiple_moves(self, scope_root: Path):
        ts = TrashService()
        e1 = ts.move_to_trash(scope_root, "characters/Connor.md", "character_file", "Connor")
        e2 = ts.move_to_trash(scope_root, "characters/Hank.md", "character_file", "Hank")

        entries = ts.list_trash(scope_root)
        assert len(entries) == 2
        ids = {e.trash_id for e in entries}
        assert e1.trash_id in ids
        assert e2.trash_id in ids


class TestRestore:
    def test_restore_file(self, scope_root: Path):
        ts = TrashService()
        entry = ts.move_to_trash(scope_root, "characters/Connor.md", "character_file", "Connor")

        restored = ts.restore(scope_root, entry.trash_id)
        assert restored.trash_id == entry.trash_id
        # 原文件恢复
        assert (scope_root / "characters" / "Connor.md").is_file()
        content = (scope_root / "characters" / "Connor.md").read_text(encoding="utf-8")
        assert "Detective" in content
        # .trash/ 中已清除
        assert not (scope_root / ".trash" / entry.trash_path).exists()
        # manifest 已移除
        assert len(ts.list_trash(scope_root)) == 0

    def test_restore_conflict_409(self, scope_root: Path):
        ts = TrashService()
        entry = ts.move_to_trash(scope_root, "characters/Connor.md", "character_file", "Connor")
        # 在原路径创建新文件
        (scope_root / "characters" / "Connor.md").write_text("new content", encoding="utf-8")

        with pytest.raises(FileExistsError):
            ts.restore(scope_root, entry.trash_id)

    def test_restore_nonexistent_id_raises(self, scope_root: Path):
        ts = TrashService()
        with pytest.raises(FileNotFoundError):
            ts.restore(scope_root, "tr_0_nonexistent")


class TestPermanentDelete:
    def test_permanent_delete(self, scope_root: Path):
        ts = TrashService()
        entry = ts.move_to_trash(scope_root, "characters/Connor.md", "character_file", "Connor")
        ts.permanent_delete(scope_root, entry.trash_id)

        # 完全删除
        assert not (scope_root / ".trash" / entry.trash_path).exists()
        assert len(ts.list_trash(scope_root)) == 0
        # 原路径也不存在
        assert not (scope_root / "characters" / "Connor.md").exists()

    def test_permanent_delete_nonexistent_raises(self, scope_root: Path):
        ts = TrashService()
        with pytest.raises(FileNotFoundError):
            ts.permanent_delete(scope_root, "tr_0_none")


class TestPurgeExpired:
    def test_purge_removes_expired(self, scope_root: Path):
        ts = TrashService(retention_days=0)  # 立即过期
        entry = ts.move_to_trash(scope_root, "characters/Connor.md", "character_file", "Connor")

        # 手动将 expires_at 设为过去
        manifest_path = scope_root / ".trash" / "manifest.jsonl"
        records = [json.loads(l) for l in manifest_path.read_text(encoding="utf-8").strip().splitlines()]
        past = (datetime.now(timezone.utc) - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        records[0]["expires_at"] = past
        manifest_path.write_text(json.dumps(records[0], ensure_ascii=False) + "\n", encoding="utf-8")

        purged = ts.purge_expired(scope_root)
        assert len(purged) == 1
        assert purged[0].trash_id == entry.trash_id
        assert not (scope_root / ".trash" / entry.trash_path).exists()
        assert len(ts.list_trash(scope_root)) == 0

    def test_purge_keeps_non_expired(self, scope_root: Path):
        ts = TrashService(retention_days=30)
        ts.move_to_trash(scope_root, "characters/Connor.md", "character_file", "Connor")

        purged = ts.purge_expired(scope_root)
        assert len(purged) == 0
        assert len(ts.list_trash(scope_root)) == 1


class TestListTrash:
    def test_empty_trash(self, tmp_path: Path):
        ts = TrashService()
        assert ts.list_trash(tmp_path) == []

    def test_corrupted_manifest_line_skipped(self, scope_root: Path):
        ts = TrashService()
        ts.move_to_trash(scope_root, "characters/Connor.md", "character_file", "Connor")
        # 注入损坏行
        manifest = scope_root / ".trash" / "manifest.jsonl"
        content = manifest.read_text(encoding="utf-8")
        manifest.write_text("CORRUPTED LINE\n" + content, encoding="utf-8")

        entries = ts.list_trash(scope_root)
        assert len(entries) == 1  # 损坏行被跳过


class TestPathTraversal:
    def test_dotdot_rejected(self, scope_root: Path):
        ts = TrashService()
        with pytest.raises(ValueError, match="非法路径"):
            ts.move_to_trash(scope_root, "../../../etc/passwd", "character_file", "bad")

    def test_absolute_path_rejected(self, scope_root: Path):
        ts = TrashService()
        with pytest.raises(ValueError, match="非法路径"):
            ts.move_to_trash(scope_root, "/etc/passwd", "character_file", "bad")

    def test_dotdot_in_middle_rejected(self, scope_root: Path):
        ts = TrashService()
        with pytest.raises(ValueError, match="非法路径"):
            ts.move_to_trash(scope_root, "characters/../../secret", "character_file", "bad")


class TestDoubleDelete:
    def test_delete_same_file_twice(self, scope_root: Path):
        ts = TrashService()
        ts.move_to_trash(scope_root, "characters/Connor.md", "character_file", "Connor")
        # 第二次删除：文件已不存在
        with pytest.raises(FileNotFoundError):
            ts.move_to_trash(scope_root, "characters/Connor.md", "character_file", "Connor")


class TestMixedOperations:
    def test_trash_restore_delete_manifest_consistency(self, scope_root: Path):
        ts = TrashService()
        e1 = ts.move_to_trash(scope_root, "characters/Connor.md", "character_file", "Connor")
        e2 = ts.move_to_trash(scope_root, "characters/Hank.md", "character_file", "Hank")
        e3 = ts.move_to_trash(scope_root, "worldbuilding/Detroit2038.md", "worldbuilding_file", "Detroit")

        assert len(ts.list_trash(scope_root)) == 3

        # 恢复一个
        ts.restore(scope_root, e1.trash_id)
        assert len(ts.list_trash(scope_root)) == 2
        assert (scope_root / "characters" / "Connor.md").is_file()

        # 永久删除一个
        ts.permanent_delete(scope_root, e2.trash_id)
        remaining = ts.list_trash(scope_root)
        assert len(remaining) == 1
        assert remaining[0].trash_id == e3.trash_id
