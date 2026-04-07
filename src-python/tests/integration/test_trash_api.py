# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""垃圾箱 API 集成测试。D-0023。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from main import create_app
    app = create_app()
    return TestClient(app)


@pytest.fixture
def au_setup(tmp_path: Path) -> dict[str, Path]:
    """搭建一个包含角色文件的 AU 目录。"""
    fandom_dir = tmp_path / "fandoms" / "TestFandom"
    au_dir = fandom_dir / "aus" / "TestAU"
    chars_dir = au_dir / "characters"
    chars_dir.mkdir(parents=True)
    (chars_dir / "Connor.md").write_text(
        "---\nname: Connor\n---\n\n# Connor\nDetective.",
        encoding="utf-8",
    )
    (chars_dir / "Hank.md").write_text(
        "---\nname: Hank\n---\n\n# Hank\nLieutenant.",
        encoding="utf-8",
    )
    # project.yaml (最小化)
    (au_dir / "project.yaml").write_text(
        "project_id: test\nau_id: test\nname: TestAU\nfandom: TestFandom\n"
        "cast_registry:\n  characters:\n    - Connor\n    - Hank\n",
        encoding="utf-8",
    )
    return {"fandom_dir": fandom_dir, "au_dir": au_dir}


class TestTrashListEndpoint:
    def test_list_empty(self, client: TestClient, au_setup: dict[str, Path]):
        resp = client.get("/api/v1/trash", params={"scope": "au", "path": str(au_setup["au_dir"])})
        assert resp.status_code == 200
        assert resp.json() == []

    def test_list_after_delete(self, client: TestClient, au_setup: dict[str, Path]):
        au_dir = au_setup["au_dir"]
        # 先删除一个 lore 文件
        client.request(
            "DELETE", "/api/v1/lore",
            json={"au_path": str(au_dir), "category": "characters", "filename": "Connor.md"},
        )
        resp = client.get("/api/v1/trash", params={"scope": "au", "path": str(au_dir)})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == 1
        assert data[0]["entity_name"] == "Connor"
        assert data[0]["original_path"] == "characters/Connor.md"


class TestTrashRestoreEndpoint:
    def test_restore_success(self, client: TestClient, au_setup: dict[str, Path]):
        au_dir = au_setup["au_dir"]
        # 删除
        del_resp = client.request(
            "DELETE", "/api/v1/lore",
            json={"au_path": str(au_dir), "category": "characters", "filename": "Connor.md"},
        )
        trash_id = del_resp.json()["trash_id"]
        assert not (au_dir / "characters" / "Connor.md").exists()

        # 恢复
        restore_resp = client.post(
            "/api/v1/trash/restore",
            json={"trash_id": trash_id, "scope": "au", "path": str(au_dir)},
        )
        assert restore_resp.status_code == 200
        assert (au_dir / "characters" / "Connor.md").is_file()

    def test_restore_updates_cast_registry(self, client: TestClient, au_setup: dict[str, Path]):
        au_dir = au_setup["au_dir"]

        del_resp = client.request(
            "DELETE", "/api/v1/lore",
            json={"au_path": str(au_dir), "category": "characters", "filename": "Connor.md"},
        )
        assert del_resp.status_code == 200

        raw_after_delete = yaml.safe_load((au_dir / "project.yaml").read_text(encoding="utf-8"))
        assert raw_after_delete["cast_registry"]["characters"] == ["Hank"]

        restore_resp = client.post(
            "/api/v1/trash/restore",
            json={"trash_id": del_resp.json()["trash_id"], "scope": "au", "path": str(au_dir)},
        )
        assert restore_resp.status_code == 200

        raw_after_restore = yaml.safe_load((au_dir / "project.yaml").read_text(encoding="utf-8"))
        assert raw_after_restore["cast_registry"]["characters"] == ["Hank", "Connor"]

    def test_restore_conflict_409(self, client: TestClient, au_setup: dict[str, Path]):
        au_dir = au_setup["au_dir"]
        # 删除
        del_resp = client.request(
            "DELETE", "/api/v1/lore",
            json={"au_path": str(au_dir), "category": "characters", "filename": "Connor.md"},
        )
        trash_id = del_resp.json()["trash_id"]
        # 在原路径创建新文件
        (au_dir / "characters" / "Connor.md").write_text("new", encoding="utf-8")

        restore_resp = client.post(
            "/api/v1/trash/restore",
            json={"trash_id": trash_id, "scope": "au", "path": str(au_dir)},
        )
        assert restore_resp.status_code == 409


class TestTrashPermanentDelete:
    def test_permanent_delete(self, client: TestClient, au_setup: dict[str, Path]):
        au_dir = au_setup["au_dir"]
        del_resp = client.request(
            "DELETE", "/api/v1/lore",
            json={"au_path": str(au_dir), "category": "characters", "filename": "Connor.md"},
        )
        trash_id = del_resp.json()["trash_id"]

        perm_resp = client.delete(
            f"/api/v1/trash/{trash_id}",
            params={"scope": "au", "path": str(au_dir)},
        )
        assert perm_resp.status_code == 200
        # manifest 清空
        list_resp = client.get("/api/v1/trash", params={"scope": "au", "path": str(au_dir)})
        assert list_resp.json() == []


class TestTrashPurgeEndpoint:
    def test_purge_via_api(self, client: TestClient, au_setup: dict[str, Path]):
        au_dir = au_setup["au_dir"]
        # 删除文件
        del_resp = client.request(
            "DELETE", "/api/v1/lore",
            json={"au_path": str(au_dir), "category": "characters", "filename": "Connor.md"},
        )
        assert del_resp.status_code == 200

        # 手动将 manifest 中的 expires_at 设为过去
        import json
        from datetime import datetime, timedelta, timezone
        manifest = au_dir / ".trash" / "manifest.jsonl"
        records = [json.loads(l) for l in manifest.read_text(encoding="utf-8").strip().splitlines()]
        past = (datetime.now(timezone.utc) - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
        records[0]["expires_at"] = past
        manifest.write_text(json.dumps(records[0], ensure_ascii=False) + "\n", encoding="utf-8")

        # 调用 purge
        purge_resp = client.delete(
            "/api/v1/trash/purge",
            params={"scope": "au", "path": str(au_dir)},
        )
        assert purge_resp.status_code == 200
        data = purge_resp.json()
        assert data["purged_count"] == 1

        # 垃圾箱为空
        list_resp = client.get("/api/v1/trash", params={"scope": "au", "path": str(au_dir)})
        assert list_resp.json() == []


class TestDoubleDeleteApi:
    def test_delete_same_file_twice_returns_404(self, client: TestClient, au_setup: dict[str, Path]):
        au_dir = au_setup["au_dir"]
        resp1 = client.request(
            "DELETE", "/api/v1/lore",
            json={"au_path": str(au_dir), "category": "characters", "filename": "Connor.md"},
        )
        assert resp1.status_code == 200

        resp2 = client.request(
            "DELETE", "/api/v1/lore",
            json={"au_path": str(au_dir), "category": "characters", "filename": "Connor.md"},
        )
        assert resp2.status_code == 404


class TestFandomDeleteTrash:
    def test_fandom_delete_uses_trash(self, client: TestClient, au_setup: dict[str, Path]):
        fandom_dir = au_setup["fandom_dir"]
        fandoms_root = fandom_dir.parent  # tmp_path/fandoms

        resp = client.delete(
            "/api/v1/fandoms/TestFandom",
            params={"data_dir": str(fandoms_root.parent)},
        )
        assert resp.status_code == 200
        assert "trash_id" in resp.json()
        # Fandom 目录已不在原位
        assert not fandom_dir.is_dir()
        # 但在 .trash/ 中
        trash_dir = fandoms_root / ".trash"
        assert trash_dir.is_dir()

    def test_au_delete_uses_trash(self, client: TestClient, au_setup: dict[str, Path]):
        fandom_dir = au_setup["fandom_dir"]
        au_dir = au_setup["au_dir"]

        resp = client.delete(
            "/api/v1/fandoms/TestFandom/aus/TestAU",
            params={"data_dir": str(fandom_dir.parent.parent)},
        )
        assert resp.status_code == 200
        assert "trash_id" in resp.json()
        assert not au_dir.is_dir()
