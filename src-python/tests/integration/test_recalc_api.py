# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""重算全局状态 API 集成测试。"""

from __future__ import annotations

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
    main_dir = au_dir / "chapters" / "main"
    main_dir.mkdir(parents=True)

    # project.yaml
    (au_dir / "project.yaml").write_text(
        "project_id: test\nau_id: test\nname: TestAU\nfandom: Test\n"
        "cast_registry:\n  characters:\n    - Connor\n    - Hank\n",
        encoding="utf-8",
    )
    # state.yaml
    (au_dir / "state.yaml").write_text(
        "au_id: test\ncurrent_chapter: 4\nchapter_focus: []\nchapters_dirty: []\n"
        "last_scene_ending: 旧的结尾\ncharacters_last_seen: {}\nindex_status: ready\n",
        encoding="utf-8",
    )

    # 3 chapters
    for i in range(1, 4):
        content = f"Connor 在第{i}章出现了。" if i <= 2 else "Hank 在第3章出现了。最终场景结尾文字。"
        post = frontmatter.Post(content, confirmed_focus=["f1"] if i == 3 else [])
        (main_dir / f"ch{i:04d}.md").write_text(frontmatter.dumps(post), encoding="utf-8")

    return {"au_dir": au_dir}


class TestRecalcApi:
    def test_recalc_success(self, client: TestClient, au_env: dict[str, Path]):
        resp = client.post("/api/v1/state/recalc", json={
            "au_path": str(au_env["au_dir"]),
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["chapters_scanned"] == 3
        assert data["characters_last_seen"]["Connor"] == 2
        assert data["characters_last_seen"]["Hank"] == 3
        assert "最终场景结尾" in data["last_scene_ending"]
        assert data["last_confirmed_chapter_focus"] == ["f1"]

    def test_recalc_no_chapters(self, client: TestClient, tmp_path: Path):
        au_dir = tmp_path / "EmptyAU"
        au_dir.mkdir()
        (au_dir / "project.yaml").write_text("name: Empty\ncast_registry:\n  characters: []\n", encoding="utf-8")
        (au_dir / "state.yaml").write_text("au_id: test\ncurrent_chapter: 1\n", encoding="utf-8")

        resp = client.post("/api/v1/state/recalc", json={"au_path": str(au_dir)})
        assert resp.status_code == 200
        data = resp.json()
        assert data["chapters_scanned"] == 0
        assert data["characters_last_seen"] == {}

    def test_recalc_invalid_path(self, client: TestClient):
        resp = client.post("/api/v1/state/recalc", json={"au_path": "../../../etc"})
        assert resp.status_code == 400
