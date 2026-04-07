# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""设定文件 CRUD API 集成测试。任务 3。"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from main import create_app
    app = create_app()
    return TestClient(app)


@pytest.fixture
def au_env(tmp_path: Path) -> dict[str, Path]:
    """搭建完整的 Fandom + AU 环境。"""
    fandom_dir = tmp_path / "fandoms" / "TestFandom"
    au_dir = fandom_dir / "aus" / "TestAU"

    # Fandom 层
    core_chars = fandom_dir / "core_characters"
    core_chars.mkdir(parents=True)
    (core_chars / "Connor.md").write_text("---\nname: Connor\n---\n\n# Connor\nDetective.", encoding="utf-8")
    (core_chars / "Hank.md").write_text("# Hank\nLieutenant.", encoding="utf-8")
    core_wb = fandom_dir / "core_worldbuilding"
    core_wb.mkdir()
    (core_wb / "Detroit.md").write_text("# Detroit 2038", encoding="utf-8")
    (fandom_dir / "fandom.yaml").write_text("name: TestFandom\n", encoding="utf-8")

    # AU 层
    chars = au_dir / "characters"
    chars.mkdir(parents=True)
    (chars / "existing.md").write_text("# Existing\nAlready here.", encoding="utf-8")
    wb = au_dir / "worldbuilding"
    wb.mkdir()
    (au_dir / "project.yaml").write_text(
        "project_id: test\nau_id: test\nname: TestAU\nfandom: TestFandom\n"
        "cast_registry:\n  characters:\n    - existing\n"
        "pinned_context:\n  - '永远不要杀死主角'\n  - '保持第三人称'\n",
        encoding="utf-8",
    )

    return {
        "fandom_dir": fandom_dir,
        "au_dir": au_dir,
        "fandoms_root": tmp_path,
    }


# =========================================================================
# Lore CRUD
# =========================================================================

class TestLoreList:
    def test_list_characters(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.get("/api/v1/lore/list", params={
            "category": "characters",
            "au_path": str(au_env["au_dir"]),
        })
        assert resp.status_code == 200
        files = resp.json()["files"]
        assert len(files) == 1
        assert files[0]["name"] == "existing"

    def test_list_empty_dir(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.get("/api/v1/lore/list", params={
            "category": "worldbuilding",
            "au_path": str(au_env["au_dir"]),
        })
        assert resp.status_code == 200
        assert resp.json()["files"] == []

    def test_list_nonexistent_category(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.get("/api/v1/lore/list", params={
            "category": "nonexistent",
            "au_path": str(au_env["au_dir"]),
        })
        assert resp.status_code == 200
        assert resp.json()["files"] == []


class TestLoreGetContent:
    def test_get_existing(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.get("/api/v1/lore/content", params={
            "category": "characters",
            "filename": "existing.md",
            "au_path": str(au_env["au_dir"]),
        })
        assert resp.status_code == 200
        assert "Already here" in resp.json()["content"]

    def test_get_nonexistent_returns_empty(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.get("/api/v1/lore/content", params={
            "category": "characters",
            "filename": "ghost.md",
            "au_path": str(au_env["au_dir"]),
        })
        assert resp.status_code == 200
        assert resp.json()["content"] == ""


class TestLoreCreate:
    def test_create_via_put(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.put("/api/v1/lore", json={
            "au_path": str(au_env["au_dir"]),
            "category": "characters",
            "filename": "new_char.md",
            "content": "# New Char\nFresh.",
        })
        assert resp.status_code == 200
        assert (au_env["au_dir"] / "characters" / "new_char.md").is_file()

    def test_create_worldbuilding(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.put("/api/v1/lore", json={
            "au_path": str(au_env["au_dir"]),
            "category": "worldbuilding",
            "filename": "magic.md",
            "content": "# Magic System",
        })
        assert resp.status_code == 200
        assert (au_env["au_dir"] / "worldbuilding" / "magic.md").is_file()


# =========================================================================
# Import from Fandom
# =========================================================================

class TestImportFromFandom:
    def test_import_with_frontmatter(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.post("/api/v1/lore/import-from-fandom", json={
            "fandom_path": str(au_env["fandom_dir"]),
            "au_path": str(au_env["au_dir"]),
            "filenames": ["Connor.md"],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "Connor.md" in data["imported"]

        # 验证文件已复制且有 origin_ref
        content = (au_env["au_dir"] / "characters" / "Connor.md").read_text(encoding="utf-8")
        assert "origin_ref: fandom/Connor" in content

    def test_import_without_frontmatter(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.post("/api/v1/lore/import-from-fandom", json={
            "fandom_path": str(au_env["fandom_dir"]),
            "au_path": str(au_env["au_dir"]),
            "filenames": ["Hank.md"],
        })
        assert resp.status_code == 200
        content = (au_env["au_dir"] / "characters" / "Hank.md").read_text(encoding="utf-8")
        assert "origin_ref: fandom/Hank" in content
        assert content.startswith("---")

    def test_import_skip_existing(self, client: TestClient, au_env: dict[str, Path]):
        # existing.md 已在 AU 中
        (au_env["au_dir"] / "characters" / "Connor.md").write_text("already", encoding="utf-8")
        resp = client.post("/api/v1/lore/import-from-fandom", json={
            "fandom_path": str(au_env["fandom_dir"]),
            "au_path": str(au_env["au_dir"]),
            "filenames": ["Connor.md", "Hank.md"],
        })
        data = resp.json()
        assert "Connor.md" in data["skipped"]
        assert "Hank.md" in data["imported"]

    def test_import_skip_nonexistent_source(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.post("/api/v1/lore/import-from-fandom", json={
            "fandom_path": str(au_env["fandom_dir"]),
            "au_path": str(au_env["au_dir"]),
            "filenames": ["Ghost.md"],
        })
        data = resp.json()
        assert "Ghost.md" in data["skipped"]
        assert data["imported"] == []


# =========================================================================
# Pinned Context (铁律)
# =========================================================================

class TestPinnedContext:
    def test_add_pinned(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.post("/api/v1/project/pinned", params={
            "au_path": str(au_env["au_dir"]),
        }, json={"text": "新增铁律：角色不能飞"})
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

        # 验证
        proj = client.get("/api/v1/project", params={"au_path": str(au_env["au_dir"])}).json()
        assert "新增铁律：角色不能飞" in proj["pinned_context"]
        assert len(proj["pinned_context"]) == 3  # 原有2条 + 新增1条

    def test_delete_pinned(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.delete("/api/v1/project/pinned/0", params={
            "au_path": str(au_env["au_dir"]),
        })
        assert resp.status_code == 200

        proj = client.get("/api/v1/project", params={"au_path": str(au_env["au_dir"])}).json()
        assert len(proj["pinned_context"]) == 1
        assert "保持第三人称" in proj["pinned_context"][0]

    def test_delete_pinned_out_of_range(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.delete("/api/v1/project/pinned/99", params={
            "au_path": str(au_env["au_dir"]),
        })
        assert resp.status_code == 400


# =========================================================================
# Rename
# =========================================================================

class TestRenameFandom:
    def test_rename_fandom(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.put(
            "/api/v1/fandoms/TestFandom/rename",
            params={"data_dir": str(au_env["fandoms_root"])},
            json={"new_name": "RenamedFandom"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["new_name"] == "RenamedFandom"
        # 旧目录不存在
        assert not au_env["fandom_dir"].is_dir()
        # 新目录存在
        new_dir = au_env["fandoms_root"] / "fandoms" / "RenamedFandom"
        assert new_dir.is_dir()

    def test_rename_fandom_conflict(self, client: TestClient, au_env: dict[str, Path]):
        # 创建目标同名目录
        (au_env["fandoms_root"] / "fandoms" / "Conflict").mkdir(parents=True)
        resp = client.put(
            "/api/v1/fandoms/TestFandom/rename",
            params={"data_dir": str(au_env["fandoms_root"])},
            json={"new_name": "Conflict"},
        )
        assert resp.status_code == 409


class TestRenameAU:
    def test_rename_au(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.put(
            "/api/v1/fandoms/TestFandom/aus/TestAU/rename",
            params={"data_dir": str(au_env["fandoms_root"])},
            json={"new_name": "RenamedAU"},
        )
        assert resp.status_code == 200
        assert not au_env["au_dir"].is_dir()
        new_au = au_env["fandom_dir"] / "aus" / "RenamedAU"
        assert new_au.is_dir()

    def test_rename_au_not_found(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.put(
            "/api/v1/fandoms/TestFandom/aus/NonExistent/rename",
            params={"data_dir": str(au_env["fandoms_root"])},
            json={"new_name": "X"},
        )
        assert resp.status_code == 404
