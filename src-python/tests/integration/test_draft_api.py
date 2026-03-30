"""草稿 API 集成测试。DELETE + 编辑后定稿。"""

from __future__ import annotations

from pathlib import Path

import frontmatter
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
    drafts_dir = au_dir / "chapters" / ".drafts"
    main_dir = au_dir / "chapters" / "main"
    drafts_dir.mkdir(parents=True)
    main_dir.mkdir(parents=True)

    # project.yaml
    (au_dir / "project.yaml").write_text(
        "project_id: test\nau_id: test\nname: TestAU\nfandom: Test\n",
        encoding="utf-8",
    )
    # state.yaml
    (au_dir / "state.yaml").write_text(
        "au_id: test\ncurrent_chapter: 1\nchapter_focus: []\nchapters_dirty: []\n"
        "last_scene_ending: ''\ncharacters_last_seen: {}\nindex_status: ready\n",
        encoding="utf-8",
    )

    # 创建草稿
    post_a = frontmatter.Post("AI生成的第一章内容。", generated_with={
        "mode": "api", "model": "test", "temperature": 1.0, "top_p": 0.95,
        "input_tokens": 100, "output_tokens": 50, "char_count": 20,
        "duration_ms": 1000, "generated_at": "2026-03-30T00:00:00Z",
    })
    (drafts_dir / "ch0001_draft_A.md").write_text(frontmatter.dumps(post_a), encoding="utf-8")

    post_b = frontmatter.Post("AI生成的第二个草稿。")
    (drafts_dir / "ch0001_draft_B.md").write_text(frontmatter.dumps(post_b), encoding="utf-8")

    return {"au_dir": au_dir, "drafts_dir": drafts_dir}


# ===== DELETE /api/v1/drafts =====

class TestDeleteDrafts:
    def test_delete_single_draft(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.delete("/api/v1/drafts", params={
            "au_path": str(au_env["au_dir"]),
            "chapter_num": 1,
            "label": "B",
        })
        assert resp.status_code == 200
        assert resp.json()["deleted_count"] == 1
        assert not (au_env["drafts_dir"] / "ch0001_draft_B.md").exists()
        assert (au_env["drafts_dir"] / "ch0001_draft_A.md").exists()

    def test_delete_all_drafts(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.delete("/api/v1/drafts", params={
            "au_path": str(au_env["au_dir"]),
            "chapter_num": 1,
        })
        assert resp.status_code == 200
        assert resp.json()["deleted_count"] == 2
        assert not (au_env["drafts_dir"] / "ch0001_draft_A.md").exists()
        assert not (au_env["drafts_dir"] / "ch0001_draft_B.md").exists()

    def test_delete_nonexistent_single_404(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.delete("/api/v1/drafts", params={
            "au_path": str(au_env["au_dir"]),
            "chapter_num": 1,
            "label": "Z",
        })
        assert resp.status_code == 404

    def test_delete_no_drafts_404(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.delete("/api/v1/drafts", params={
            "au_path": str(au_env["au_dir"]),
            "chapter_num": 99,
        })
        assert resp.status_code == 404


# ===== 编辑后定稿（方案 A）=====

class TestConfirmWithContentOverride:
    def test_confirm_with_content(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.post("/api/v1/chapters/confirm", json={
            "au_path": str(au_env["au_dir"]),
            "chapter_num": 1,
            "draft_id": "ch0001_draft_A.md",
            "content": "用户编辑后的内容。这是修改版。",
        })
        assert resp.status_code == 200

        # 验证写入的是编辑后内容
        ch_file = au_env["au_dir"] / "chapters" / "main" / "ch0001.md"
        assert ch_file.is_file()
        post = frontmatter.load(str(ch_file))
        assert "用户编辑后的内容" in post.content
        assert "AI生成" not in post.content
        # provenance 应为 mixed
        assert post.metadata.get("provenance") == "mixed"

    def test_confirm_without_content_uses_draft(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.post("/api/v1/chapters/confirm", json={
            "au_path": str(au_env["au_dir"]),
            "chapter_num": 1,
            "draft_id": "ch0001_draft_A.md",
        })
        assert resp.status_code == 200

        ch_file = au_env["au_dir"] / "chapters" / "main" / "ch0001.md"
        post = frontmatter.load(str(ch_file))
        assert "AI生成的第一章内容" in post.content
        assert post.metadata.get("provenance") == "ai"
