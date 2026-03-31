"""Project API 集成测试 — 掩码 Key 回写防御。"""

from __future__ import annotations

from dataclasses import asdict
from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient

from core.domain.project import Project, LLMConfig


@pytest.fixture
def client():
    from main import create_app
    return TestClient(create_app())


def _make_project(**overrides) -> Project:
    """构造测试用 Project 对象。"""
    defaults = dict(project_id="test", au_id="test-au", name="Test AU", fandom="test-fandom")
    defaults.update(overrides)
    return Project(**defaults)


class TestProjectMaskedKeyWriteback:
    """P0: project PUT 掩码 api_key 不被回写。"""

    def test_masked_llm_key_preserves_original(self, client: TestClient):
        """PUT llm.api_key 为掩码值 → 原值保留。"""
        real_key = "sk-project-real-key-abcd1234"
        project = _make_project(
            llm=LLMConfig(mode="api", model="deepseek-chat",
                          api_base="https://api.deepseek.com",
                          api_key=real_key, context_window=128000),
        )
        saved_project = None

        def mock_get(au_path):
            return project

        def mock_save(p):
            nonlocal saved_project
            saved_project = p

        with patch("api.routes.project.build_project_repository") as mock_repo:
            repo = MagicMock()
            repo.get.side_effect = mock_get
            repo.save.side_effect = mock_save
            mock_repo.return_value = repo

            # PUT 掩码值回去
            resp = client.put("/api/v1/project?au_path=/test/au", json={
                "llm": {
                    "mode": "api",
                    "model": "deepseek-chat",
                    "api_base": "https://api.deepseek.com",
                    "api_key": "****1234",
                    "context_window": 128000,
                },
            })

        assert resp.status_code == 200
        assert saved_project is not None
        # 原始 Key 应被保留，掩码值不应写入
        assert saved_project.llm.api_key == real_key

    def test_new_plaintext_key_updates(self, client: TestClient):
        """PUT llm.api_key 明文新 Key → 正常更新。"""
        project = _make_project(
            llm=LLMConfig(mode="api", model="deepseek-chat",
                          api_base="https://api.deepseek.com",
                          api_key="sk-old-key", context_window=128000),
        )
        saved_project = None

        def mock_save(p):
            nonlocal saved_project
            saved_project = p

        with patch("api.routes.project.build_project_repository") as mock_repo:
            repo = MagicMock()
            repo.get.return_value = project
            repo.save.side_effect = mock_save
            mock_repo.return_value = repo

            resp = client.put("/api/v1/project?au_path=/test/au", json={
                "llm": {
                    "api_key": "sk-brand-new-key",
                },
            })

        assert resp.status_code == 200
        assert saved_project.llm.api_key == "sk-brand-new-key"

    def test_empty_string_clears_key(self, client: TestClient):
        """PUT llm.api_key 空字符串 → 正常清空。"""
        project = _make_project(
            llm=LLMConfig(mode="api", model="deepseek-chat",
                          api_base="https://api.deepseek.com",
                          api_key="sk-will-be-cleared", context_window=128000),
        )
        saved_project = None

        def mock_save(p):
            nonlocal saved_project
            saved_project = p

        with patch("api.routes.project.build_project_repository") as mock_repo:
            repo = MagicMock()
            repo.get.return_value = project
            repo.save.side_effect = mock_save
            mock_repo.return_value = repo

            resp = client.put("/api/v1/project?au_path=/test/au", json={
                "llm": {
                    "api_key": "",
                },
            })

        assert resp.status_code == 200
        assert saved_project.llm.api_key == ""

    def test_get_returns_masked_key(self, client: TestClient):
        """GET /project 返回掩码 key。"""
        project = _make_project(
            llm=LLMConfig(mode="api", model="m", api_base="https://x.com",
                          api_key="sk-secret-key-abcdefgh", context_window=0),
        )

        with patch("api.routes.project.build_project_repository") as mock_repo:
            repo = MagicMock()
            repo.get.return_value = project
            mock_repo.return_value = repo

            resp = client.get("/api/v1/project?au_path=/test/au")

        assert resp.status_code == 200
        data = resp.json()
        assert data["llm"]["api_key"] == "****efgh"
