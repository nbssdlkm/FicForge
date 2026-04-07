# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""全局配置领域对象。参见 PRD §3.3 settings.yaml。"""

from __future__ import annotations

from dataclasses import dataclass, field

from core.domain.enums import APIMode, LicenseTier, LLMMode
from core.domain.project import LLMConfig


@dataclass
class ModelParams:
    """单个模型的参数配置。参见 PRD §3.3。"""

    temperature: float = 1.0
    top_p: float = 0.95


@dataclass
class EmbeddingConfig:
    """Embedding 配置。参见 PRD §3.3。"""

    mode: LLMMode = LLMMode.API
    model: str = ""
    api_base: str = ""
    api_key: str = ""
    local_model_path: str = ""
    ollama_model: str = "nomic-embed-text"


@dataclass
class ChapterMetadataField:
    """章节元数据显示字段开关。"""

    model: bool = True
    char_count: bool = True
    token_usage: bool = True
    duration: bool = True
    timestamp: bool = True
    temperature: bool = True
    top_p: bool = True


@dataclass
class ChapterMetadataDisplay:
    """章节元数据信息栏配置。参见 PRD §3.3。"""

    enabled: bool = True
    fields: ChapterMetadataField = field(default_factory=ChapterMetadataField)


@dataclass
class AppConfig:
    """应用配置。参见 PRD §3.3。"""

    language: str = "zh"
    data_dir: str = "./fandoms"
    token_count_fallback: str = "char_mul1.5"
    token_warning_threshold: int = 32000
    chapter_metadata_display: ChapterMetadataDisplay = field(
        default_factory=ChapterMetadataDisplay
    )
    schema_version: str = "1.0.0"


@dataclass
class LicenseConfig:
    """商业化预留配置。参见 PRD §3.3。"""

    tier: LicenseTier = LicenseTier.FREE
    feature_flags: list[str] = field(default_factory=list)
    api_mode: APIMode = APIMode.SELF_HOSTED


@dataclass
class Settings:
    """全局配置。

    字段名与 PRD §3.3 settings.yaml 一致。
    所有 AU 共用。
    """

    updated_at: str = ""                           # ISO 8601
    default_llm: LLMConfig = field(default_factory=LLMConfig)
    model_params: dict[str, ModelParams] = field(default_factory=dict)
    embedding: EmbeddingConfig = field(default_factory=EmbeddingConfig)
    app: AppConfig = field(default_factory=AppConfig)
    license: LicenseConfig = field(default_factory=LicenseConfig)
