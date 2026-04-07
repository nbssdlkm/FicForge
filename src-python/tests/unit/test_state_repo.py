# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""State Repository 单元测试。"""

import pytest
import yaml

from repositories.implementations.local_file_state import LocalFileStateRepository


def test_read_normal_file(tmp_path):
    """读取正常文件 → 所有字段正确映射。"""
    au = tmp_path / "test_au"
    au.mkdir()
    raw = {
        "au_id": "au_1",
        "revision": 5,
        "current_chapter": 38,
        "last_scene_ending": "林深关上了咖啡馆的灯",
        "characters_last_seen": {"林深": 37, "陈明": 35},
        "chapter_focus": ["f033"],
        "chapters_dirty": [22, 35],
        "index_status": "ready",
        "sync_unsafe": False,
    }
    (au / "state.yaml").write_text(
        yaml.dump(raw, allow_unicode=True), encoding="utf-8"
    )
    repo = LocalFileStateRepository()
    state = repo.get(str(au))
    assert state.current_chapter == 38
    assert state.last_scene_ending == "林深关上了咖啡馆的灯"
    assert state.characters_last_seen["林深"] == 37
    assert state.chapters_dirty == [22, 35]
    assert state.index_status.value == "ready"


def test_defaults_current_chapter_1(tmp_path):
    """current_chapter 默认值为 1（D-0001）。"""
    au = tmp_path / "test_au"
    au.mkdir()
    repo = LocalFileStateRepository()
    state = repo.get(str(au))
    assert state.current_chapter == 1


def test_defaults_chapters_dirty_empty(tmp_path):
    """chapters_dirty 默认为空列表。"""
    au = tmp_path / "test_au"
    au.mkdir()
    repo = LocalFileStateRepository()
    state = repo.get(str(au))
    assert state.chapters_dirty == []


def test_defaults_sync_unsafe_false(tmp_path):
    """sync_unsafe 默认为 false。"""
    au = tmp_path / "test_au"
    au.mkdir()
    repo = LocalFileStateRepository()
    state = repo.get(str(au))
    assert state.sync_unsafe is False


def test_defaults_index_status_stale(tmp_path):
    """新 AU 的 index_status 默认为 stale。"""
    au = tmp_path / "test_au"
    au.mkdir()
    repo = LocalFileStateRepository()
    state = repo.get(str(au))
    assert state.index_status.value == "stale"


def test_save_updates_revision_and_timestamp(tmp_path):
    """写入后 revision 和 updated_at 已更新。"""
    au = tmp_path / "test_au"
    au.mkdir()
    repo = LocalFileStateRepository()
    state = repo.get(str(au))
    assert state.revision == 0
    repo.save(state)
    state2 = repo.get(str(au))
    assert state2.revision == 1
    assert state2.updated_at != ""
