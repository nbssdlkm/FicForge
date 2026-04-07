# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""Settings API 集成测试 — 掩码回写防御 + merge 语义。"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path):
    """使用临时目录作为 data_dir，避免污染真实配置。"""
    import api as api_mod

    original = api_mod.build_settings_repository

    def _build(data_dir=tmp_path):
        from repositories.implementations.local_file_settings import LocalFileSettingsRepository
        return LocalFileSettingsRepository(data_dir)

    api_mod.build_settings_repository = _build
    try:
        from main import create_app
        yield TestClient(create_app())
    finally:
        api_mod.build_settings_repository = original


def _seed_settings(client: TestClient, api_key: str = "sk-real-secret-key-12345678") -> None:
    """写入一个带真实 Key 的初始配置。"""
    client.put("/api/v1/settings", json={
        "default_llm": {
            "mode": "api",
            "model": "deepseek-chat",
            "api_base": "https://api.deepseek.com",
            "api_key": api_key,
            "context_window": 128000,
        },
        "embedding": {
            "mode": "api",
            "model": "nomic-embed-text",
            "api_base": "https://api.deepseek.com",
            "api_key": api_key,
        },
    })


class TestMaskedKeyWriteback:
    """P0: 掩码 api_key 不被回写。"""

    def test_masked_key_preserves_original(self, client: TestClient):
        """PUT 传入掩码 api_key → 原值保留。"""
        _seed_settings(client, "sk-real-secret-key-12345678")

        # 模拟前端：GET 拿到掩码值后整体 PUT 回去
        get_resp = client.get("/api/v1/settings")
        settings = get_resp.json()
        assert settings["default_llm"]["api_key"] == "****5678"

        # 把掩码值原样 PUT 回去
        client.put("/api/v1/settings", json=settings)

        # 验证：再次 GET，Key 仍然被正确掩码（说明底层真实值未被破坏）
        check = client.get("/api/v1/settings").json()
        assert check["default_llm"]["api_key"] == "****5678"

    def test_new_plaintext_key_updates(self, client: TestClient):
        """PUT 传入明文新 Key → 正常更新。"""
        _seed_settings(client, "sk-old-key-00000000")

        client.put("/api/v1/settings", json={
            "default_llm": {
                "mode": "api",
                "model": "deepseek-chat",
                "api_base": "https://api.deepseek.com",
                "api_key": "sk-brand-new-key-99999999",
                "context_window": 128000,
            },
        })

        check = client.get("/api/v1/settings").json()
        assert check["default_llm"]["api_key"] == "****9999"

    def test_empty_string_clears_key(self, client: TestClient):
        """PUT 传入空字符串 api_key → 正常清空。"""
        _seed_settings(client, "sk-real-key-12345678")

        client.put("/api/v1/settings", json={
            "default_llm": {
                "mode": "api",
                "model": "deepseek-chat",
                "api_base": "https://api.deepseek.com",
                "api_key": "",
                "context_window": 128000,
            },
        })

        check = client.get("/api/v1/settings").json()
        assert check["default_llm"]["api_key"] == ""

    def test_embedding_masked_key_preserves(self, client: TestClient):
        """embedding.api_key 掩码值同样不被覆盖。"""
        _seed_settings(client, "sk-embed-key-abcdefgh")

        get_resp = client.get("/api/v1/settings").json()
        # 整体 PUT 回去（含掩码 embedding key）
        client.put("/api/v1/settings", json=get_resp)

        check = client.get("/api/v1/settings").json()
        # embedding key 未被破坏
        assert check["embedding"]["api_key"] == "****efgh"


class TestMergeSemantic:
    """P1: PUT /settings merge 语义。"""

    def test_partial_update_preserves_other_fields(self, client: TestClient):
        """只传 default_llm → embedding/app 等字段保留原值。"""
        _seed_settings(client, "sk-real-key-12345678")

        # 先设置 embedding 为特定值
        client.put("/api/v1/settings", json={
            "embedding": {
                "mode": "api",
                "model": "custom-embed-model",
                "api_base": "https://embed.example.com",
                "api_key": "sk-embed-specific-key",
            },
        })

        # 只更新 default_llm
        client.put("/api/v1/settings", json={
            "default_llm": {
                "mode": "api",
                "model": "gpt-4",
                "api_base": "https://api.openai.com",
                "api_key": "sk-openai-key-zzzz",
                "context_window": 8192,
            },
        })

        check = client.get("/api/v1/settings").json()
        # default_llm 已更新
        assert check["default_llm"]["model"] == "gpt-4"
        assert check["default_llm"]["api_key"] == "****zzzz"
        # embedding 保持不变
        assert check["embedding"]["model"] == "custom-embed-model"
        assert check["embedding"]["api_base"] == "https://embed.example.com"

    def test_full_payload_updates_everything(self, client: TestClient):
        """传完整 payload → 正常全量更新。"""
        _seed_settings(client, "sk-old-key-00000000")

        full = {
            "default_llm": {
                "mode": "api",
                "model": "new-model",
                "api_base": "https://new.api.com",
                "api_key": "sk-full-update-newkey",
                "context_window": 4096,
            },
            "embedding": {
                "mode": "api",
                "model": "new-embed",
                "api_base": "https://new-embed.com",
                "api_key": "sk-embed-new-key-xyz",
            },
            "app": {
                "language": "en",
                "data_dir": "./fandoms",
                "token_count_fallback": "char_mul1.5",
                "token_warning_threshold": 16000,
            },
        }

        client.put("/api/v1/settings", json=full)

        check = client.get("/api/v1/settings").json()
        assert check["default_llm"]["model"] == "new-model"
        assert check["embedding"]["model"] == "new-embed"
        assert check["app"]["language"] == "en"
        assert check["app"]["token_warning_threshold"] == 16000
