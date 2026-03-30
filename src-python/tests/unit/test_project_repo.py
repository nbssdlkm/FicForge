"""Project Repository 单元测试。"""

import pytest
import yaml

from repositories.implementations.local_file_project import (
    LocalFileProjectRepository,
    ProjectInvalidError,
)


def test_read_normal_file(tmp_path):
    """读取正常文件 → 所有字段正确映射。"""
    au = tmp_path / "test_au"
    au.mkdir()
    raw = {
        "project_id": "proj_123",
        "au_id": "au_456",
        "name": "测试AU",
        "fandom": "原神",
        "schema_version": "1.0.0",
        "revision": 3,
        "chapter_length": 2000,
        "writing_style": {"perspective": "first_person", "pov_character": "林深"},
        "cast_registry": {"characters": ["林深"]},
        "core_guarantee_budget": 400,
    }
    (au / "project.yaml").write_text(
        yaml.dump(raw, allow_unicode=True), encoding="utf-8"
    )
    repo = LocalFileProjectRepository()
    project = repo.get(str(au))
    assert project.project_id == "proj_123"
    assert project.name == "测试AU"
    assert project.chapter_length == 2000
    assert project.writing_style.pov_character == "林深"
    assert project.cast_registry.characters == ["林深"]


def test_missing_fields_filled(tmp_path):
    """字段缺失 → 补默认值。"""
    au = tmp_path / "test_au"
    au.mkdir()
    (au / "project.yaml").write_text(
        yaml.dump({"project_id": "p1", "au_id": "a1"}), encoding="utf-8"
    )
    repo = LocalFileProjectRepository()
    project = repo.get(str(au))
    assert project.chapter_length == 1500
    assert project.core_guarantee_budget == 400
    assert project.current_branch == "main"


def test_save_updates_revision_and_timestamp(tmp_path):
    """写入后 updated_at + revision 已更新。"""
    au = tmp_path / "test_au"
    au.mkdir()
    (au / "project.yaml").write_text(
        yaml.dump({"project_id": "p1", "au_id": str(au), "revision": 1}),
        encoding="utf-8",
    )
    repo = LocalFileProjectRepository()
    project = repo.get(str(au))
    assert project.revision == 1
    repo.save(project)
    project2 = repo.get(str(au))
    assert project2.revision == 2
    assert project2.updated_at != ""


def test_corrupted_file_raises_error(tmp_path):
    """完全损坏文件 → 返回 ProjectInvalidError。"""
    au = tmp_path / "test_au"
    au.mkdir()
    (au / "project.yaml").write_text("{{{{invalid yaml", encoding="utf-8")
    repo = LocalFileProjectRepository()
    with pytest.raises(ProjectInvalidError):
        repo.get(str(au))


def test_non_dict_content_raises_error(tmp_path):
    """YAML 内容不是 dict → ProjectInvalidError。"""
    au = tmp_path / "test_au"
    au.mkdir()
    (au / "project.yaml").write_text("just a string", encoding="utf-8")
    repo = LocalFileProjectRepository()
    with pytest.raises(ProjectInvalidError):
        repo.get(str(au))


def test_project_id_preserved(tmp_path):
    """project_id 创建后不可变。"""
    au = tmp_path / "test_au"
    au.mkdir()
    (au / "project.yaml").write_text(
        yaml.dump({"project_id": "fixed_id", "au_id": str(au)}), encoding="utf-8"
    )
    repo = LocalFileProjectRepository()
    p = repo.get(str(au))
    assert p.project_id == "fixed_id"
    repo.save(p)
    p2 = repo.get(str(au))
    assert p2.project_id == "fixed_id"
