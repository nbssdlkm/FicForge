"""test-connection + test-embedding 集成测试。"""

from __future__ import annotations

from unittest.mock import patch, MagicMock

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client():
    from main import create_app
    return TestClient(create_app())


class TestConnectionApi:
    def test_api_success(self, client: TestClient):
        from infra.llm.provider import LLMResponse
        mock_resp = LLMResponse(content="hi", model="test-model")

        with patch("api.routes.settings.OpenAICompatibleProvider") as MockP:
            MockP.return_value.generate.return_value = mock_resp
            resp = client.post("/api/v1/settings/test-connection", json={
                "mode": "api", "model": "test-model",
                "api_base": "https://test.com", "api_key": "sk-test",
            })

        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert data["model"] == "test-model"

    def test_api_failure(self, client: TestClient):
        from infra.llm.provider import LLMError

        with patch("api.routes.settings.OpenAICompatibleProvider") as MockP:
            MockP.return_value.generate.side_effect = LLMError(
                error_code="invalid_api_key", message="密钥无效", status_code=401,
            )
            resp = client.post("/api/v1/settings/test-connection", json={
                "mode": "api", "model": "test", "api_base": "https://x.com", "api_key": "bad",
            })

        assert resp.status_code == 200  # 失败也返回 200
        data = resp.json()
        assert data["success"] is False
        assert data["error_code"] == "invalid_api_key"

    def test_api_missing_config(self, client: TestClient):
        resp = client.post("/api/v1/settings/test-connection", json={
            "mode": "api", "model": "", "api_base": "", "api_key": "",
        })
        assert resp.status_code == 200
        assert resp.json()["success"] is False
        assert resp.json()["error_code"] == "missing_config"

    def test_local_path_exists(self, client: TestClient, tmp_path):
        resp = client.post("/api/v1/settings/test-connection", json={
            "mode": "local", "local_model_path": str(tmp_path),
        })
        assert resp.status_code == 200
        assert resp.json()["success"] is True

    def test_local_path_not_exists(self, client: TestClient):
        resp = client.post("/api/v1/settings/test-connection", json={
            "mode": "local", "local_model_path": "/nonexistent/path",
        })
        assert resp.status_code == 200
        assert resp.json()["success"] is False
        assert resp.json()["error_code"] == "path_not_found"

    def test_ollama_connection_refused(self, client: TestClient):
        """Ollama 不可达时返回 connection_failed。"""
        resp = client.post("/api/v1/settings/test-connection", json={
            "mode": "ollama", "api_base": "http://localhost:99999",
            "ollama_model": "llama3",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is False
        assert data["error_code"] == "connection_failed"

    def test_unsupported_mode(self, client: TestClient):
        resp = client.post("/api/v1/settings/test-connection", json={
            "mode": "quantum",
        })
        assert resp.status_code == 200
        assert resp.json()["success"] is False
        assert resp.json()["error_code"] == "unsupported_mode"


class TestEmbeddingApi:
    def test_embedding_success(self, client: TestClient):
        with patch("api.routes.settings.OpenAICompatibleEmbeddingProvider") as MockP:
            MockP.return_value.embed.return_value = [[0.1, 0.2, 0.3]]
            resp = client.post("/api/v1/settings/test-embedding", json={
                "mode": "api", "model": "text-embedding-3",
                "api_base": "https://test.com", "api_key": "sk-test",
            })

        assert resp.status_code == 200
        data = resp.json()
        assert data["success"] is True
        assert "维度: 3" in data["message"]

    def test_embedding_failure(self, client: TestClient):
        with patch("api.routes.settings.OpenAICompatibleEmbeddingProvider") as MockP:
            MockP.return_value.embed.side_effect = Exception("Connection refused")
            resp = client.post("/api/v1/settings/test-embedding", json={
                "mode": "api", "model": "test", "api_base": "https://x.com", "api_key": "bad",
            })

        assert resp.status_code == 200
        assert resp.json()["success"] is False

    def test_embedding_non_api_mode(self, client: TestClient):
        resp = client.post("/api/v1/settings/test-embedding", json={
            "mode": "ollama",
        })
        assert resp.status_code == 200
        assert resp.json()["success"] is False
        assert resp.json()["error_code"] == "unsupported_mode"
