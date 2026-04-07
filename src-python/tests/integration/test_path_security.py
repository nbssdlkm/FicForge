# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""路径安全 + trash 参数兼容 + project/state 校验测试。"""

from __future__ import annotations

from pathlib import Path

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
    chars = au_dir / "characters"
    chars.mkdir()
    (chars / "Connor.md").write_text("# Connor", encoding="utf-8")
    return {"au_dir": au_dir}


# ===== 路径遍历拒绝测试（6+ 端点）=====

class TestPathTraversal:
    def test_project_traversal(self, client: TestClient):
        resp = client.get("/api/v1/project", params={"au_path": "../../../etc/passwd"})
        assert resp.status_code == 400
        assert resp.json()["error_code"] == "INVALID_PATH"

    def test_state_traversal(self, client: TestClient):
        resp = client.get("/api/v1/state", params={"au_path": "../../etc"})
        assert resp.status_code == 400

    def test_chapters_traversal(self, client: TestClient):
        resp = client.get("/api/v1/chapters", params={"au_path": "../secret"})
        assert resp.status_code == 400

    def test_drafts_traversal(self, client: TestClient):
        resp = client.get("/api/v1/drafts", params={"au_path": "../x", "chapter_num": 1})
        assert resp.status_code == 400

    def test_facts_traversal(self, client: TestClient):
        resp = client.get("/api/v1/facts", params={"au_path": "../../etc"})
        assert resp.status_code == 400

    def test_trash_traversal(self, client: TestClient):
        resp = client.get("/api/v1/trash", params={"au_path": "../../../x"})
        assert resp.status_code == 400

    def test_valid_absolute_path_accepted(self, client: TestClient, au_env: dict[str, Path]):
        # 绝对路径在桌面应用中是正常的（au_path 通常是绝对路径）
        resp = client.get("/api/v1/project", params={"au_path": str(au_env["au_dir"])})
        assert resp.status_code == 200


# ===== Trash 新旧参数兼容 =====

class TestTrashParamCompat:
    def test_au_path_only(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.get("/api/v1/trash", params={"au_path": str(au_env["au_dir"])})
        assert resp.status_code == 200
        assert resp.json() == []

    def test_old_scope_path(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.get("/api/v1/trash", params={
            "scope": "au", "path": str(au_env["au_dir"]),
        })
        assert resp.status_code == 200

    def test_au_path_overrides_path(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.get("/api/v1/trash", params={
            "au_path": str(au_env["au_dir"]),
            "path": "/nonexistent",
        })
        assert resp.status_code == 200  # au_path 优先

    def test_neither_param_returns_400(self, client: TestClient):
        resp = client.get("/api/v1/trash")
        assert resp.status_code == 400


# ===== Project/State GET 校验 =====

class TestGetValidation:
    def test_project_valid(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.get("/api/v1/project", params={"au_path": str(au_env["au_dir"])})
        assert resp.status_code == 200

    def test_state_valid(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.get("/api/v1/state", params={"au_path": str(au_env["au_dir"])})
        assert resp.status_code == 200
