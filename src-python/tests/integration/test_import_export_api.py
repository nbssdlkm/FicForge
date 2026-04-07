# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""导入/导出 API 集成测试。"""

from __future__ import annotations

import io
from pathlib import Path

import frontmatter
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from main import create_app
    return TestClient(create_app())


@pytest.fixture
def au_env(tmp_path: Path) -> dict[str, Path]:
    au_dir = tmp_path / "TestAU"
    au_dir.mkdir()
    (au_dir / "project.yaml").write_text(
        "project_id: t\nau_id: t\nname: T\nfandom: T\ncast_registry:\n  characters: []\n",
        encoding="utf-8",
    )
    (au_dir / "state.yaml").write_text(
        "au_id: t\ncurrent_chapter: 1\nchapter_focus: []\nchapters_dirty: []\n"
        "last_scene_ending: ''\ncharacters_last_seen: {}\nindex_status: ready\n",
        encoding="utf-8",
    )
    main_dir = au_dir / "chapters" / "main"
    main_dir.mkdir(parents=True)
    return {"au_dir": au_dir}


class TestImportUpload:
    def test_upload_txt(self, client: TestClient):
        content = "第一章 开始\n\n正文内容在这里。\n\n第二章 继续\n\n第二章内容。"
        resp = client.post("/api/v1/import/upload", files={
            "file": ("test.txt", io.BytesIO(content.encode("utf-8")), "text/plain"),
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_chapters"] >= 1
        assert "chapters" in data

    def test_upload_empty(self, client: TestClient):
        resp = client.post("/api/v1/import/upload", files={
            "file": ("empty.txt", io.BytesIO(b""), "text/plain"),
        })
        # 空文件应返回 0 章或合理错误
        assert resp.status_code in (200, 400)

    def test_upload_unsupported(self, client: TestClient):
        resp = client.post("/api/v1/import/upload", files={
            "file": ("test.pdf", io.BytesIO(b"fake pdf"), "application/pdf"),
        })
        assert resp.status_code == 400
        assert resp.json()["error_code"] == "UNSUPPORTED_FORMAT"


class TestImportConfirm:
    def test_confirm_normal(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.post("/api/v1/import/confirm", json={
            "au_path": str(au_env["au_dir"]),
            "chapters": [
                {"chapter_num": 1, "title": "第一章", "content": "林深走进了咖啡馆。"},
                {"chapter_num": 2, "title": "第二章", "content": "陈明在擦杯子。"},
            ],
            "split_method": "manual",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_chapters"] == 2
        assert data["state_initialized"] is True

    def test_confirm_empty_chapters(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.post("/api/v1/import/confirm", json={
            "au_path": str(au_env["au_dir"]),
            "chapters": [],
        })
        assert resp.status_code == 400
        assert resp.json()["error_code"] == "EMPTY_CHAPTERS"

    def test_confirm_au_has_chapters(self, client: TestClient, au_env: dict[str, Path]):
        # 先导入一次
        client.post("/api/v1/import/confirm", json={
            "au_path": str(au_env["au_dir"]),
            "chapters": [{"chapter_num": 1, "title": "Ch1", "content": "text"}],
        })
        # 再导入 → 409
        resp = client.post("/api/v1/import/confirm", json={
            "au_path": str(au_env["au_dir"]),
            "chapters": [{"chapter_num": 1, "title": "Ch1", "content": "text2"}],
        })
        assert resp.status_code == 409
        assert resp.json()["error_code"] == "AU_HAS_CHAPTERS"


class TestExport:
    def test_export_normal(self, client: TestClient, au_env: dict[str, Path]):
        # 先导入章节
        client.post("/api/v1/import/confirm", json={
            "au_path": str(au_env["au_dir"]),
            "chapters": [{"chapter_num": 1, "title": "Ch1", "content": "内容"}],
        })
        resp = client.get("/api/v1/export", params={
            "au_path": str(au_env["au_dir"]),
            "start": 1,
            "format": "txt",
        })
        assert resp.status_code == 200
        assert "内容" in resp.text

    def test_export_nonexistent_au(self, client: TestClient):
        resp = client.get("/api/v1/export", params={
            "au_path": "/nonexistent/au",
            "start": 1,
        })
        # 不存在的 AU 应返回错误（500 EXPORT_FAILED 或空内容）
        assert resp.status_code in (200, 500)
