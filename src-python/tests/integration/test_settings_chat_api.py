# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""设定模式 API 集成测试。"""

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
def env(tmp_path: Path) -> dict[str, Path]:
    """搭建 Fandom + AU 环境。"""
    fandom_dir = tmp_path / "TestFandom"
    au_dir = tmp_path / "TestAU"

    chars = fandom_dir / "core_characters"
    chars.mkdir(parents=True)
    (chars / "Connor.md").write_text("# Connor\n## 核心本质\n温柔坚定", encoding="utf-8")

    au_dir.mkdir(parents=True)
    (au_dir / "project.yaml").write_text(
        "name: TestAU\nfandom: TestFandom\n"
        "cast_registry:\n  characters:\n    - Connor\n"
        "pinned_context:\n  - '不能飞'\n"
        "llm:\n  mode: api\n  model: test-model\n  api_base: https://test.com\n  api_key: sk-test\n",
        encoding="utf-8",
    )

    return {"fandom_dir": fandom_dir, "au_dir": au_dir}


def _mock_llm_response(content: str = "好的", tool_calls: list | None = None):
    """构造 mock LLM 响应。"""
    msg: dict = {"content": content}
    if tool_calls:
        msg["tool_calls"] = tool_calls
    return {
        "choices": [{"message": msg, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 100, "completion_tokens": 50},
    }


class TestSettingsChatAuMode:
    def test_au_mode_returns_content(self, client: TestClient, env: dict[str, Path]):
        with patch("core.services.settings_chat.OpenAICompatibleProvider") as MockProvider:
            instance = MockProvider.return_value
            instance._model = "test-model"
            instance._request_with_retry.return_value = _mock_llm_response(
                content="我建议创建一个角色设定文件。",
                tool_calls=[{
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "create_character_file",
                        "arguments": '{"name": "Connor Ellis", "content": "# Connor Ellis"}',
                    },
                }],
            )

            resp = client.post("/api/v1/settings-chat", json={
                "base_path": str(env["au_dir"]),
                "mode": "au",
                "messages": [{"role": "user", "content": "帮我创建 Connor 的设定"}],
                "fandom_path": str(env["fandom_dir"]),
                "session_llm": {
                    "mode": "api", "model": "test-model",
                    "api_base": "https://test.com", "api_key": "sk-test",
                },
            })

        assert resp.status_code == 200
        data = resp.json()
        assert "建议" in data["content"]
        assert len(data["tool_calls"]) == 1
        assert data["tool_calls"][0]["function"]["name"] == "create_character_file"

    def test_au_mode_no_tool_calls(self, client: TestClient, env: dict[str, Path]):
        with patch("core.services.settings_chat.OpenAICompatibleProvider") as MockProvider:
            instance = MockProvider.return_value
            instance._model = "test-model"
            instance._request_with_retry.return_value = _mock_llm_response(
                content="我理解你的需求，请告诉我更多细节。",
            )

            resp = client.post("/api/v1/settings-chat", json={
                "base_path": str(env["au_dir"]),
                "mode": "au",
                "messages": [{"role": "user", "content": "你好"}],
                "session_llm": {
                    "mode": "api", "model": "test-model",
                    "api_base": "https://test.com", "api_key": "sk-test",
                },
            })

        assert resp.status_code == 200
        data = resp.json()
        assert data["content"] != ""
        assert data["tool_calls"] == []


class TestSettingsChatFandomMode:
    def test_fandom_mode(self, client: TestClient, env: dict[str, Path]):
        with patch("core.services.settings_chat.OpenAICompatibleProvider") as MockProvider:
            instance = MockProvider.return_value
            instance._model = "test-model"
            instance._request_with_retry.return_value = _mock_llm_response(
                content="我帮你创建角色档案。",
                tool_calls=[{
                    "id": "call_1",
                    "type": "function",
                    "function": {
                        "name": "create_core_character_file",
                        "arguments": '{"name": "Hank", "content": "# Hank"}',
                    },
                }],
            )

            resp = client.post("/api/v1/settings-chat", json={
                "base_path": str(env["fandom_dir"]),
                "mode": "fandom",
                "messages": [{"role": "user", "content": "帮我创建 Hank 的档案"}],
                "session_llm": {
                    "mode": "api", "model": "test-model",
                    "api_base": "https://test.com", "api_key": "sk-test",
                },
            })

        assert resp.status_code == 200
        data = resp.json()
        assert data["tool_calls"][0]["function"]["name"] == "create_core_character_file"


class TestSettingsChatErrors:
    def test_no_model_configured(self, client: TestClient, env: dict[str, Path]):
        # 覆写 project.yaml 为无模型 + mock settings 也无模型
        (env["au_dir"] / "project.yaml").write_text(
            "name: TestAU\nfandom: TestFandom\nllm:\n  mode: api\n  model: ''\n",
            encoding="utf-8",
        )
        with patch("api.build_settings_repository") as mock_repo:
            mock_settings = MagicMock()
            mock_settings.default_llm = None
            mock_repo.return_value.get.return_value = mock_settings

            resp = client.post("/api/v1/settings-chat", json={
                "base_path": str(env["au_dir"]),
                "mode": "au",
                "messages": [{"role": "user", "content": "test"}],
            })
        assert resp.status_code == 400
        assert resp.json()["error_code"] == "NO_MODEL_CONFIGURED"

    def test_llm_error(self, client: TestClient, env: dict[str, Path]):
        from infra.llm.provider import LLMError

        with patch("core.services.settings_chat.OpenAICompatibleProvider") as MockProvider:
            instance = MockProvider.return_value
            instance._model = "test-model"
            instance._request_with_retry.side_effect = LLMError(
                error_code="rate_limited", message="请求过于频繁",
                actions=["retry"], status_code=429,
            )

            resp = client.post("/api/v1/settings-chat", json={
                "base_path": str(env["au_dir"]),
                "mode": "au",
                "messages": [{"role": "user", "content": "test"}],
                "session_llm": {
                    "mode": "api", "model": "test-model",
                    "api_base": "https://test.com", "api_key": "sk-test",
                },
            })

        assert resp.status_code == 429
        assert resp.json()["error_code"] == "rate_limited"

    def test_invalid_path(self, client: TestClient):
        resp = client.post("/api/v1/settings-chat", json={
            "base_path": "../../../etc",
            "mode": "au",
            "messages": [],
        })
        assert resp.status_code == 400
