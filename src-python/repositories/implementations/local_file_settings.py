"""LocalFileSettingsRepository — settings.yaml 读写实现。参见 PRD §3.3。"""

from __future__ import annotations

import os
from typing import Any
from pathlib import Path

import yaml

from core.domain.enums import APIMode, LicenseTier, LLMMode
from core.domain.project import LLMConfig
from core.domain.settings import (
    AppConfig,
    ChapterMetadataDisplay,
    ChapterMetadataField,
    EmbeddingConfig,
    LicenseConfig,
    ModelParams,
    Settings,
)
from infra.storage_local.file_utils import atomic_write, dc_to_dict, now_utc
from repositories.interfaces.settings_repository import SettingsRepository


class LocalFileSettingsRepository(SettingsRepository):
    """基于本地文件的全局配置存储（settings.yaml）。"""

    def __init__(self, data_dir: Path) -> None:
        self._path = data_dir / "settings.yaml"

    async def get(self) -> Settings:
        if not self._path.exists():
            settings = Settings(updated_at=now_utc())
            await self.save(settings)
            return settings

        text = self._path.read_text(encoding="utf-8")
        raw = yaml.safe_load(text)
        if not isinstance(raw, dict):
            raw = {}

        settings = _dict_to_settings(raw)

        # API Key 加载优先级：环境变量 > settings.yaml > 空（PRD §3.3）
        env_llm_key = os.environ.get("FANFIC_LLM_API_KEY", "")
        if env_llm_key:
            settings.default_llm.api_key = env_llm_key

        env_embed_key = os.environ.get("FANFIC_EMBEDDING_API_KEY", "")
        if env_embed_key:
            settings.embedding.api_key = env_embed_key

        # embedding.api_key 为空时复用 default_llm.api_key（仅同厂商时适用）
        if not settings.embedding.api_key and settings.default_llm.api_key:
            settings.embedding.api_key = settings.default_llm.api_key

        return settings

    async def save(self, settings: Settings) -> None:
        settings.updated_at = now_utc()
        raw = dc_to_dict(settings)
        content = yaml.dump(raw, allow_unicode=True, sort_keys=False, default_flow_style=False)
        atomic_write(self._path, content)


# ---------------------------------------------------------------------------
# YAML dict → domain object 映射（字段缺失时自动补默认值）
# ---------------------------------------------------------------------------

def _dict_to_llm_config(d: dict[str, Any] | None) -> LLMConfig:
    if not d:
        return LLMConfig()
    return LLMConfig(
        mode=LLMMode(d.get("mode", "api")),
        model=d.get("model", ""),
        api_base=d.get("api_base", ""),
        api_key=d.get("api_key", ""),
        local_model_path=d.get("local_model_path", ""),
        ollama_model=d.get("ollama_model", ""),
        context_window=d.get("context_window", 0),
    )


def _dict_to_model_params(d: dict[str, Any] | None) -> dict[str, ModelParams]:
    if not d:
        return {}
    result: dict[str, ModelParams] = {}
    for name, params in d.items():
        if isinstance(params, dict):
            result[name] = ModelParams(
                temperature=params.get("temperature", 1.0),
                top_p=params.get("top_p", 0.95),
            )
    return result


def _dict_to_embedding_config(d: dict[str, Any] | None) -> EmbeddingConfig:
    if not d:
        return EmbeddingConfig()
    return EmbeddingConfig(
        mode=LLMMode(d.get("mode", "api")),
        model=d.get("model", ""),
        api_base=d.get("api_base", ""),
        api_key=d.get("api_key", ""),
        local_model_path=d.get("local_model_path", ""),
        ollama_model=d.get("ollama_model", "nomic-embed-text"),
    )


def _dict_to_chapter_metadata_field(d: dict[str, Any] | None) -> ChapterMetadataField:
    if not d:
        return ChapterMetadataField()
    return ChapterMetadataField(
        model=d.get("model", True),
        char_count=d.get("char_count", True),
        token_usage=d.get("token_usage", True),
        duration=d.get("duration", True),
        timestamp=d.get("timestamp", True),
        temperature=d.get("temperature", True),
        top_p=d.get("top_p", True),
    )


def _dict_to_chapter_metadata_display(d: dict[str, Any] | None) -> ChapterMetadataDisplay:
    if not d:
        return ChapterMetadataDisplay()
    return ChapterMetadataDisplay(
        enabled=d.get("enabled", True),
        fields=_dict_to_chapter_metadata_field(d.get("fields")),
    )


def _dict_to_app_config(d: dict[str, Any] | None) -> AppConfig:
    if not d:
        return AppConfig()
    return AppConfig(
        language=d.get("language", "zh"),
        data_dir=d.get("data_dir", "./fandoms"),
        token_count_fallback=d.get("token_count_fallback", "char_mul1.5"),
        token_warning_threshold=d.get("token_warning_threshold", 32000),
        chapter_metadata_display=_dict_to_chapter_metadata_display(
            d.get("chapter_metadata_display")
        ),
        schema_version=d.get("schema_version", "1.0.0"),
    )


def _dict_to_license_config(d: dict[str, Any] | None) -> LicenseConfig:
    if not d:
        return LicenseConfig()
    return LicenseConfig(
        tier=LicenseTier(d.get("tier", "free")),
        feature_flags=d.get("feature_flags") or [],
        api_mode=APIMode(d.get("api_mode", "self_hosted")),
    )


def _dict_to_settings(d: dict[str, Any]) -> Settings:
    return Settings(
        updated_at=d.get("updated_at", ""),
        default_llm=_dict_to_llm_config(d.get("default_llm")),
        model_params=_dict_to_model_params(d.get("model_params")),
        embedding=_dict_to_embedding_config(d.get("embedding")),
        app=_dict_to_app_config(d.get("app")),
        license=_dict_to_license_config(d.get("license")),
    )
