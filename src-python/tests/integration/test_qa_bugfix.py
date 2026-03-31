"""QA Bugfix 验证测试：B-01 ~ B-12。"""

from __future__ import annotations

import json
import time
from pathlib import Path
from unittest.mock import patch

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
        "project_id: t\nau_id: t\nname: T\nfandom: T\n"
        "cast_registry:\n  characters: []\n"
        "pinned_context: []\n",
        encoding="utf-8",
    )
    (au_dir / "state.yaml").write_text(
        f"au_id: {au_dir}\ncurrent_chapter: 1\nchapter_focus: []\nchapters_dirty: []\n"
        "last_scene_ending: ''\ncharacters_last_seen: {}\nindex_status: ready\n"
        "sync_unsafe: false\n",
        encoding="utf-8",
    )
    chars = au_dir / "characters"
    chars.mkdir()
    (chars / "Alice.md").write_text("# Alice", encoding="utf-8")
    return {"au_dir": au_dir}


# =========================================================================
# B-01 / B-02: 空文件名 / 纯空白文件名
# =========================================================================


class TestLoreFilenameValidation:
    """B-01, B-02, B-08, B-10: lore filename 边界验证。"""

    def test_b01_empty_filename(self, client: TestClient, au_env: dict[str, Path]):
        """B-01: filename='' → 400 INVALID_FILENAME"""
        resp = client.put(
            "/api/v1/lore",
            json={
                "au_path": str(au_env["au_dir"]),
                "category": "characters",
                "filename": "",
                "content": "test",
            },
        )
        assert resp.status_code == 400
        assert resp.json()["error_code"] == "INVALID_FILENAME"

    def test_b02_whitespace_filename(self, client: TestClient, au_env: dict[str, Path]):
        """B-02: filename='   ' → 400 INVALID_FILENAME"""
        resp = client.put(
            "/api/v1/lore",
            json={
                "au_path": str(au_env["au_dir"]),
                "category": "characters",
                "filename": "   ",
                "content": "test",
            },
        )
        assert resp.status_code == 400
        assert resp.json()["error_code"] == "INVALID_FILENAME"

    def test_b02_whitespace_dot_md_filename(self, client: TestClient, au_env: dict[str, Path]):
        """B-02: filename='  .md' → 400 INVALID_FILENAME"""
        resp = client.put(
            "/api/v1/lore",
            json={
                "au_path": str(au_env["au_dir"]),
                "category": "characters",
                "filename": "  .md",
                "content": "test",
            },
        )
        assert resp.status_code == 400
        assert resp.json()["error_code"] == "INVALID_FILENAME"

    def test_b08_overlong_filename(self, client: TestClient, au_env: dict[str, Path]):
        """B-08: 200+ 字符文件名 → 400 INVALID_FILENAME"""
        long_name = "A" * 201 + ".md"
        resp = client.put(
            "/api/v1/lore",
            json={
                "au_path": str(au_env["au_dir"]),
                "category": "characters",
                "filename": long_name,
                "content": "test",
            },
        )
        assert resp.status_code == 400
        assert resp.json()["error_code"] == "INVALID_FILENAME"

    def test_b10_null_byte_in_filename(self, client: TestClient, au_env: dict[str, Path]):
        """B-10: filename 含 null byte → 400 INVALID_FILENAME"""
        resp = client.put(
            "/api/v1/lore",
            json={
                "au_path": str(au_env["au_dir"]),
                "category": "characters",
                "filename": "evil\x00.md",
                "content": "test",
            },
        )
        assert resp.status_code == 400
        assert resp.json()["error_code"] == "INVALID_FILENAME"

    def test_valid_filename_accepted(self, client: TestClient, au_env: dict[str, Path]):
        """正常文件名仍可保存。"""
        resp = client.put(
            "/api/v1/lore",
            json={
                "au_path": str(au_env["au_dir"]),
                "category": "characters",
                "filename": "Bob.md",
                "content": "# Bob",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_filename_validation_on_read(self, client: TestClient, au_env: dict[str, Path]):
        """read 端点同样校验空文件名。"""
        resp = client.post(
            "/api/v1/lore/read",
            json={
                "au_path": str(au_env["au_dir"]),
                "category": "characters",
                "filename": "",
            },
        )
        assert resp.status_code == 400

    def test_filename_validation_on_get_content(self, client: TestClient, au_env: dict[str, Path]):
        """GET /lore/content 同样校验空文件名。"""
        resp = client.get(
            "/api/v1/lore/content",
            params={
                "au_path": str(au_env["au_dir"]),
                "category": "characters",
                "filename": "",
            },
        )
        assert resp.status_code == 400

    def test_filename_validation_on_delete(self, client: TestClient, au_env: dict[str, Path]):
        """delete 端点同样校验空文件名。"""
        resp = client.request(
            "DELETE",
            "/api/v1/lore",
            json={
                "au_path": str(au_env["au_dir"]),
                "category": "characters",
                "filename": "",
            },
        )
        assert resp.status_code == 400


# =========================================================================
# B-03: pinned_context 空文本
# =========================================================================


class TestPinnedContextValidation:
    """B-03: 空字符串 / 纯空白文本不能添加到 pinned_context。"""

    def test_empty_text(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.post(
            "/api/v1/project/pinned",
            params={"au_path": str(au_env["au_dir"])},
            json={"text": ""},
        )
        assert resp.status_code == 400
        assert resp.json()["error_code"] == "INVALID_PARAMETER"

    def test_whitespace_text(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.post(
            "/api/v1/project/pinned",
            params={"au_path": str(au_env["au_dir"])},
            json={"text": "   \n\t  "},
        )
        assert resp.status_code == 400
        assert resp.json()["error_code"] == "INVALID_PARAMETER"

    def test_valid_text_accepted(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.post(
            "/api/v1/project/pinned",
            params={"au_path": str(au_env["au_dir"])},
            json={"text": "角色绝不能死"},
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"


# =========================================================================
# B-05 / B-06: 生成中 undo 阻止 + 超时清理
# =========================================================================


class TestGeneratingUndoBlock:
    """B-05: 生成进行中 undo → 409。B-06: 超时自动清理。"""

    def test_b05_undo_blocked_during_generation(self, client: TestClient, au_env: dict[str, Path]):
        from api import mark_generating

        au = str(au_env["au_dir"])
        mark_generating(au)
        try:
            resp = client.post(
                "/api/v1/chapters/undo",
                json={"au_path": au},
            )
            assert resp.status_code == 409
            assert resp.json()["error_code"] == "GENERATION_IN_PROGRESS"
        finally:
            from api import clear_generating

            clear_generating(au)

    def test_b06_timeout_clears_generating(self, client: TestClient, au_env: dict[str, Path]):
        from api import _au_generating, is_generating

        au = str(au_env["au_dir"])
        # 设置一个已过期的时间戳（6 分钟前）
        _au_generating[au] = time.time() - 360
        assert not is_generating(au)
        assert au not in _au_generating

    def test_undo_allowed_when_not_generating(self, client: TestClient, au_env: dict[str, Path]):
        """无生成时 undo 正常执行（即使因无章节而失败，也不是 409）。"""
        resp = client.post(
            "/api/v1/chapters/undo",
            json={"au_path": str(au_env["au_dir"])},
        )
        # 应该是 400 NO_CHAPTER_TO_UNDO，不是 409
        assert resp.status_code == 400
        assert resp.json()["error_code"] == "NO_CHAPTER_TO_UNDO"


# =========================================================================
# B-07 / B-10: validate_path 升级
# =========================================================================


class TestValidatePathUpgrade:
    """B-07: 超长路径 → 400。B-10: null byte → 400。"""

    def test_b07_overlong_path(self, client: TestClient):
        resp = client.get("/api/v1/project", params={"au_path": "A" * 600})
        assert resp.status_code == 400
        assert resp.json()["error_code"] == "INVALID_PATH"

    def test_b10_null_byte_in_path(self, client: TestClient):
        resp = client.get("/api/v1/project", params={"au_path": "test\x00evil"})
        assert resp.status_code == 400
        assert resp.json()["error_code"] == "INVALID_PATH"

    def test_b10_null_byte_in_state(self, client: TestClient):
        resp = client.get("/api/v1/state", params={"au_path": "test\x00evil"})
        assert resp.status_code == 400

    def test_b10_null_byte_in_facts(self, client: TestClient):
        resp = client.get("/api/v1/facts", params={"au_path": "test\x00evil"})
        assert resp.status_code == 400


# =========================================================================
# B-09: content_clean 非空验证
# =========================================================================


class TestFactContentCleanValidation:
    """B-09: 空 content_clean → 400。"""

    def test_empty_content_clean(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.post(
            "/api/v1/facts",
            json={
                "au_path": str(au_env["au_dir"]),
                "chapter_num": 1,
                "fact_data": {
                    "content_raw": "有 raw 无 clean",
                    "content_clean": "",
                    "characters": [],
                    "chapter": 1,
                    "type": "plot_event",
                    "narrative_weight": "low",
                },
            },
        )
        assert resp.status_code == 400
        assert resp.json()["error_code"] == "INVALID_PARAMETER"

    def test_whitespace_content_clean(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.post(
            "/api/v1/facts",
            json={
                "au_path": str(au_env["au_dir"]),
                "chapter_num": 1,
                "fact_data": {
                    "content_raw": "有 raw 无 clean",
                    "content_clean": "   ",
                    "characters": [],
                    "chapter": 1,
                    "type": "plot_event",
                    "narrative_weight": "low",
                },
            },
        )
        assert resp.status_code == 400
        assert resp.json()["error_code"] == "INVALID_PARAMETER"

    def test_valid_content_clean_accepted(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.post(
            "/api/v1/facts",
            json={
                "au_path": str(au_env["au_dir"]),
                "chapter_num": 1,
                "fact_data": {
                    "content_raw": "Alice 遇到了 Bob",
                    "content_clean": "Alice 遇到了 Bob",
                    "characters": ["Alice"],
                    "chapter": 1,
                    "type": "plot_event",
                    "narrative_weight": "medium",
                },
            },
        )
        assert resp.status_code == 201


# =========================================================================
# B-11: ops.jsonl 损坏后 sync_unsafe
# =========================================================================


class TestOpsCorruptionSyncUnsafe:
    """B-11: ops.jsonl 损坏行 → sync_unsafe=true。"""

    def test_corruption_sets_sync_unsafe(self, au_env: dict[str, Path]):
        from repositories.implementations.local_file_ops import LocalFileOpsRepository

        au = str(au_env["au_dir"])
        repo = LocalFileOpsRepository()

        # 写入一条合法 + 一条损坏行
        ops_path = au_env["au_dir"] / "ops.jsonl"
        ops_path.write_text(
            '{"op_id":"op_1","op_type":"add_fact","target_id":"f1","timestamp":"2024-01-01T00:00:00Z","payload":{}}\n'
            "THIS IS CORRUPT\n",
            encoding="utf-8",
        )

        entries = repo.list_all(au)
        assert len(entries) == 1  # 损坏行被跳过

        # 检查 sync_unsafe
        import yaml

        state_path = au_env["au_dir"] / "state.yaml"
        state_data = yaml.safe_load(state_path.read_text(encoding="utf-8"))
        assert state_data.get("sync_unsafe") is True


# =========================================================================
# B-12: 导入空文件
# =========================================================================


class TestImportEmptyFile:
    """B-12: 空文件上传 → 400 EMPTY_CONTENT。"""

    def test_empty_file(self, client: TestClient, tmp_path: Path):
        empty = tmp_path / "empty.txt"
        empty.write_text("", encoding="utf-8")
        with open(empty, "rb") as f:
            resp = client.post(
                "/api/v1/import/upload",
                files={"file": ("empty.txt", f, "text/plain")},
            )
        assert resp.status_code == 400
        assert resp.json()["error_code"] == "EMPTY_CONTENT"

    def test_non_empty_file_accepted(self, client: TestClient, tmp_path: Path):
        normal = tmp_path / "test.txt"
        normal.write_text("第一章\n\n这是内容", encoding="utf-8")
        with open(normal, "rb") as f:
            resp = client.post(
                "/api/v1/import/upload",
                files={"file": ("test.txt", f, "text/plain")},
            )
        assert resp.status_code == 200
        assert resp.json()["total_chapters"] > 0


# =========================================================================
# B-04: i18n key 完整性（单元级检查）
# =========================================================================


class TestI18nDirtyKeys:
    """B-04: zh.json dirty 命名空间包含 DirtyModal 所需的全部 key。"""

    def test_dirty_keys_complete(self):
        zh_path = Path(__file__).resolve().parents[3] / "src-ui" / "src" / "locales" / "zh.json"
        data = json.loads(zh_path.read_text(encoding="utf-8"))
        dirty = data.get("dirty", {})

        required_modal = [
            "title", "warningTitle", "warningDescription", "empty",
            "dirtyTag", "deprecateTag", "keep", "deprecate",
            "extractButton", "extractHint", "resolveButton", "resolveSubtitle",
        ]
        required_banner = ["banner", "goResolve", "dismissBanner"]

        for key in required_modal + required_banner:
            assert key in dirty, f"Missing dirty.{key} in zh.json"

    def test_no_duplicate_dirty_key(self):
        """确保 zh.json 中没有重复的 dirty key（JSON 重复 key 导致覆盖）。"""
        zh_path = Path(__file__).resolve().parents[3] / "src-ui" / "src" / "locales" / "zh.json"
        raw = zh_path.read_text(encoding="utf-8")
        # 简单检查：只出现一次 "dirty"
        count = raw.count('"dirty"')
        assert count == 1, f'"dirty" appears {count} times in zh.json (should be 1)'
