"""向量化联动入队逻辑测试。"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from main import create_app
    app = create_app()
    return TestClient(app)


@pytest.fixture
def au_env(tmp_path: Path) -> dict[str, Path]:
    au_dir = tmp_path / "TestAU"
    au_dir.mkdir()
    (au_dir / "project.yaml").write_text(
        "name: TestAU\nfandom: Test\ncast_registry:\n  characters: []\n",
        encoding="utf-8",
    )
    chars = au_dir / "characters"
    chars.mkdir()
    (chars / "Connor.md").write_text("# Connor", encoding="utf-8")
    wb = au_dir / "worldbuilding"
    wb.mkdir()
    return {"au_dir": au_dir}


@pytest.fixture
def fandom_env(tmp_path: Path) -> dict[str, Path]:
    fandom_dir = tmp_path / "TestFandom"
    core = fandom_dir / "core_characters"
    core.mkdir(parents=True)
    (core / "Hank.md").write_text("# Hank", encoding="utf-8")
    return {"fandom_dir": fandom_dir}


class TestLoreSaveEnqueue:
    def test_au_save_enqueues_vectorize(self, client: TestClient, au_env: dict[str, Path]):
        with patch("api.routes.lore.build_task_queue") as mock_q:
            mock_q.return_value = MagicMock()
            resp = client.put("/api/v1/lore", json={
                "au_path": str(au_env["au_dir"]),
                "category": "characters",
                "filename": "new.md",
                "content": "# New",
            })
        assert resp.status_code == 200
        mock_q.return_value.enqueue.assert_called_once()
        args = mock_q.return_value.enqueue.call_args
        assert args[0][0] == "vectorize_settings_file"
        assert "new.md" in args[0][2]["file_path"]

    def test_fandom_save_no_enqueue(self, client: TestClient, fandom_env: dict[str, Path]):
        with patch("api.routes.lore.build_task_queue") as mock_q:
            mock_q.return_value = MagicMock()
            resp = client.put("/api/v1/lore", json={
                "fandom_path": str(fandom_env["fandom_dir"]),
                "category": "core_characters",
                "filename": "test.md",
                "content": "# Test",
            })
        assert resp.status_code == 200
        mock_q.return_value.enqueue.assert_not_called()


class TestLoreDeleteEnqueue:
    def test_au_delete_enqueues_delete_chunks(self, client: TestClient, au_env: dict[str, Path]):
        with patch("api.routes.lore.build_task_queue") as mock_q:
            mock_q.return_value = MagicMock()
            resp = client.request("DELETE", "/api/v1/lore", json={
                "au_path": str(au_env["au_dir"]),
                "category": "characters",
                "filename": "Connor.md",
            })
        assert resp.status_code == 200
        mock_q.return_value.enqueue.assert_called_once()
        args = mock_q.return_value.enqueue.call_args
        assert args[0][0] == "delete_settings_chunks"

    def test_fandom_delete_no_enqueue(self, client: TestClient, fandom_env: dict[str, Path]):
        with patch("api.routes.lore.build_task_queue") as mock_q:
            mock_q.return_value = MagicMock()
            resp = client.request("DELETE", "/api/v1/lore", json={
                "fandom_path": str(fandom_env["fandom_dir"]),
                "category": "core_characters",
                "filename": "Hank.md",
            })
        assert resp.status_code == 200
        mock_q.return_value.enqueue.assert_not_called()


class TestImportEnqueue:
    def test_import_enqueues_for_each_file(self, client: TestClient, au_env: dict[str, Path], fandom_env: dict[str, Path]):
        with patch("api.routes.lore.build_task_queue") as mock_q:
            mock_q.return_value = MagicMock()
            resp = client.post("/api/v1/lore/import-from-fandom", json={
                "fandom_path": str(fandom_env["fandom_dir"]),
                "au_path": str(au_env["au_dir"]),
                "filenames": ["Hank.md"],
            })
        assert resp.status_code == 200
        assert "Hank.md" in resp.json()["imported"]
        mock_q.return_value.enqueue.assert_called_once()
        args = mock_q.return_value.enqueue.call_args
        assert args[0][0] == "vectorize_settings_file"
        assert "Hank.md" in args[0][2]["file_path"]


class TestTrashRestoreEnqueue:
    def test_restore_au_file_enqueues_vectorize(self, client: TestClient, au_env: dict[str, Path]):
        au_dir = au_env["au_dir"]
        # 先删除
        del_resp = client.request("DELETE", "/api/v1/lore", json={
            "au_path": str(au_dir),
            "category": "characters",
            "filename": "Connor.md",
        })
        trash_id = del_resp.json()["trash_id"]

        with patch("api.routes.trash.build_task_queue") as mock_q:
            mock_q.return_value = MagicMock()
            resp = client.post("/api/v1/trash/restore", json={
                "trash_id": trash_id,
                "scope": "au",
                "path": str(au_dir),
            })
        assert resp.status_code == 200
        mock_q.return_value.enqueue.assert_called_once()
        args = mock_q.return_value.enqueue.call_args
        assert args[0][0] == "vectorize_settings_file"


class TestDedupKey:
    def test_settings_file_dedup(self):
        from infra.vector_index.task_queue import _dedup_key
        key1 = _dedup_key("vectorize_settings_file", "au1", {"file_path": "characters/Connor.md"})
        key2 = _dedup_key("vectorize_settings_file", "au1", {"file_path": "characters/Connor.md"})
        assert key1 == key2

    def test_different_files_different_keys(self):
        from infra.vector_index.task_queue import _dedup_key
        key1 = _dedup_key("vectorize_settings_file", "au1", {"file_path": "characters/Connor.md"})
        key2 = _dedup_key("vectorize_settings_file", "au1", {"file_path": "characters/Hank.md"})
        assert key1 != key2

    def test_chapter_dedup_unchanged(self):
        from infra.vector_index.task_queue import _dedup_key
        key = _dedup_key("vectorize_chapter", "au1", {"chapter_num": 5})
        assert "5" in key
