# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""Settings Repository 单元测试。"""

import os

import pytest
import yaml

from core.domain.settings import Settings
from repositories.implementations.local_file_settings import LocalFileSettingsRepository


def test_read_normal_file(tmp_path):
    """读取正常文件 → 所有字段正确映射。"""
    raw = {
        "updated_at": "2025-03-24T14:22:00Z",
        "default_llm": {
            "mode": "api",
            "model": "deepseek-chat",
            "api_base": "https://api.deepseek.com",
            "api_key": "sk-test",
        },
        "model_params": {
            "deepseek-chat": {"temperature": 1.0, "top_p": 0.95},
        },
        "embedding": {"mode": "api", "model": "text-embedding-v3"},
        "app": {"language": "zh", "data_dir": "./fandoms", "schema_version": "1.0.0"},
        "license": {"tier": "free", "feature_flags": [], "api_mode": "self_hosted"},
    }
    (tmp_path / "settings.yaml").write_text(
        yaml.dump(raw, allow_unicode=True), encoding="utf-8"
    )
    repo = LocalFileSettingsRepository(tmp_path)
    settings = repo.get()
    assert settings.default_llm.model == "deepseek-chat"
    assert settings.default_llm.api_key == "sk-test"
    assert settings.app.language == "zh"
    assert settings.app.schema_version == "1.0.0"
    assert "deepseek-chat" in settings.model_params
    assert settings.model_params["deepseek-chat"].temperature == 1.0


def test_file_not_exists_creates_default(tmp_path):
    """文件不存在 → 创建默认文件 → 再读取验证默认值。"""
    repo = LocalFileSettingsRepository(tmp_path)
    settings = repo.get()
    assert settings.default_llm.mode.value == "api"
    assert settings.app.language == "zh"
    assert settings.app.data_dir == "./fandoms"
    assert (tmp_path / "settings.yaml").exists()


def test_missing_fields_filled_with_defaults(tmp_path):
    """字段缺失 → 补默认值后正确读取。"""
    (tmp_path / "settings.yaml").write_text(
        yaml.dump({"updated_at": "2025-01-01T00:00:00Z"}), encoding="utf-8"
    )
    repo = LocalFileSettingsRepository(tmp_path)
    settings = repo.get()
    assert settings.app.language == "zh"
    assert settings.embedding.ollama_model == "nomic-embed-text"
    assert settings.license.tier.value == "free"


def test_save_updates_updated_at(tmp_path):
    """写入后 updated_at 已更新。"""
    repo = LocalFileSettingsRepository(tmp_path)
    settings = repo.get()
    old_time = settings.updated_at
    repo.save(settings)
    settings2 = repo.get()
    assert settings2.updated_at >= old_time
    assert settings2.updated_at != ""


def test_api_key_env_override(tmp_path, monkeypatch):
    """API Key 环境变量覆盖。"""
    (tmp_path / "settings.yaml").write_text(
        yaml.dump({"default_llm": {"api_key": "yaml-key"}}), encoding="utf-8"
    )
    monkeypatch.setenv("FANFIC_LLM_API_KEY", "env-key")
    repo = LocalFileSettingsRepository(tmp_path)
    settings = repo.get()
    assert settings.default_llm.api_key == "env-key"


def test_embedding_key_fallback(tmp_path):
    """embedding.api_key 为空时复用 default_llm.api_key。"""
    (tmp_path / "settings.yaml").write_text(
        yaml.dump({
            "default_llm": {"api_key": "shared-key"},
            "embedding": {"api_key": ""},
        }),
        encoding="utf-8",
    )
    repo = LocalFileSettingsRepository(tmp_path)
    settings = repo.get()
    assert settings.embedding.api_key == "shared-key"
