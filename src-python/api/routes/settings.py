"""Settings 相关 API 路由。"""

from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from api import build_settings_repository, error_response
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

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


class LLMConfigPayload(BaseModel):
    mode: LLMMode = LLMMode.API
    model: str = ""
    api_base: str = ""
    api_key: str = ""
    local_model_path: str = ""
    ollama_model: str = ""
    context_window: int = 0

    def to_domain(self) -> LLMConfig:
        return LLMConfig(**self.model_dump())


class ModelParamsPayload(BaseModel):
    temperature: float = 1.0
    top_p: float = 0.95

    def to_domain(self) -> ModelParams:
        return ModelParams(**self.model_dump())


class EmbeddingConfigPayload(BaseModel):
    mode: LLMMode = LLMMode.API
    model: str = ""
    api_base: str = ""
    api_key: str = ""
    local_model_path: str = ""
    ollama_model: str = "nomic-embed-text"

    def to_domain(self) -> EmbeddingConfig:
        return EmbeddingConfig(**self.model_dump())


class ChapterMetadataFieldPayload(BaseModel):
    model: bool = True
    char_count: bool = True
    token_usage: bool = True
    duration: bool = True
    timestamp: bool = True
    temperature: bool = True
    top_p: bool = True

    def to_domain(self) -> ChapterMetadataField:
        return ChapterMetadataField(**self.model_dump())


class ChapterMetadataDisplayPayload(BaseModel):
    enabled: bool = True
    fields: ChapterMetadataFieldPayload = Field(default_factory=ChapterMetadataFieldPayload)

    def to_domain(self) -> ChapterMetadataDisplay:
        return ChapterMetadataDisplay(
            enabled=self.enabled,
            fields=self.fields.to_domain(),
        )


class AppConfigPayload(BaseModel):
    language: str = "zh"
    data_dir: str = "./fandoms"
    token_count_fallback: str = "char_mul1.5"
    token_warning_threshold: int = 32000
    chapter_metadata_display: ChapterMetadataDisplayPayload = Field(
        default_factory=ChapterMetadataDisplayPayload
    )
    schema_version: str = "1.0.0"

    def to_domain(self) -> AppConfig:
        return AppConfig(
            language=self.language,
            data_dir=self.data_dir,
            token_count_fallback=self.token_count_fallback,
            token_warning_threshold=self.token_warning_threshold,
            chapter_metadata_display=self.chapter_metadata_display.to_domain(),
            schema_version=self.schema_version,
        )


class LicenseConfigPayload(BaseModel):
    tier: LicenseTier = LicenseTier.FREE
    feature_flags: list[str] = Field(default_factory=list)
    api_mode: APIMode = APIMode.SELF_HOSTED

    def to_domain(self) -> LicenseConfig:
        return LicenseConfig(**self.model_dump())


class SettingsPayload(BaseModel):
    updated_at: str = ""
    default_llm: LLMConfigPayload = Field(default_factory=LLMConfigPayload)
    model_params: dict[str, ModelParamsPayload] = Field(default_factory=dict)
    embedding: EmbeddingConfigPayload = Field(default_factory=EmbeddingConfigPayload)
    app: AppConfigPayload = Field(default_factory=AppConfigPayload)
    license: LicenseConfigPayload = Field(default_factory=LicenseConfigPayload)

    def to_domain(self) -> Settings:
        return Settings(
            updated_at=self.updated_at,
            default_llm=self.default_llm.to_domain(),
            model_params={
                name: params.to_domain() for name, params in self.model_params.items()
            },
            embedding=self.embedding.to_domain(),
            app=self.app.to_domain(),
            license=self.license.to_domain(),
        )


class SettingsUpdateResponse(BaseModel):
    status: str


@router.get("", response_model=SettingsPayload)
async def get_settings():
    repo = build_settings_repository()
    settings = await run_in_threadpool(repo.get)
    return SettingsPayload(**asdict(settings))


@router.put("", response_model=SettingsUpdateResponse)
async def update_settings(request: SettingsPayload):
    repo = build_settings_repository()
    settings = request.to_domain()

    try:
        await run_in_threadpool(repo.save, settings)
    except Exception as exc:
        return error_response(
            500,
            "SETTINGS_SAVE_FAILED",
            str(exc),
            ["检查 settings.yaml 是否可写"],
        )

    return SettingsUpdateResponse(status="ok")
