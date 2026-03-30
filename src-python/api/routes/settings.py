"""Settings 相关 API 路由。"""

from __future__ import annotations

from dataclasses import asdict

from fastapi import APIRouter
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from api import build_settings_repository, error_response
from core.domain.enums import APIMode, LicenseTier, LLMMode
from core.domain.project import LLMConfig
from infra.embeddings.provider import OpenAICompatibleEmbeddingProvider
from infra.llm.openai_compatible import OpenAICompatibleProvider
import logging

logger = logging.getLogger(__name__)

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
    logger.info("Update settings")
    repo = build_settings_repository()
    settings = request.to_domain()

    try:
        await run_in_threadpool(repo.save, settings)
    except Exception as exc:
        logger.exception("Update settings failed")
        return error_response(
            500,
            "SETTINGS_SAVE_FAILED",
            str(exc),
            ["检查 settings.yaml 是否可写"],
        )

    return SettingsUpdateResponse(status="ok")


# ---------------------------------------------------------------------------
# test-connection
# ---------------------------------------------------------------------------

class TestConnectionRequest(BaseModel):
    mode: str = "api"
    model: str = ""
    api_base: str | None = None
    api_key: str | None = None
    local_model_path: str | None = None
    ollama_model: str | None = None


class TestConnectionResponse(BaseModel):
    success: bool
    model: str = ""
    message: str = ""
    error_code: str = ""


@router.post("/test-connection", response_model=TestConnectionResponse)
async def test_connection(request: TestConnectionRequest):
    """测试 LLM 连接（PRD §1.5）。失败时也返回 200。"""
    import httpx

    mode = request.mode

    if mode == "api":
        if not request.model or not request.api_base or not request.api_key:
            return TestConnectionResponse(
                success=False, model=request.model or "",
                error_code="missing_config", message="请填写模型名、API 地址和密钥",
            )
        try:
            provider = OpenAICompatibleProvider(
                api_base=request.api_base, api_key=request.api_key, model=request.model,
            )

            def _test():
                return provider.generate(
                    messages=[{"role": "user", "content": "hi"}],
                    max_tokens=1, temperature=0.0, top_p=1.0, stream=False,
                )

            resp = await run_in_threadpool(_test)
            return TestConnectionResponse(
                success=True, model=resp.model or request.model, message="连接成功",
            )
        except Exception as e:
            code = getattr(e, "error_code", "connection_failed")
            msg = getattr(e, "message", str(e))
            return TestConnectionResponse(
                success=False, model=request.model, error_code=code, message=msg,
            )

    elif mode == "ollama":
        base = (request.api_base or "http://localhost:11434").rstrip("/")
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(f"{base}/api/tags")
            if resp.status_code == 200:
                models = [m.get("name", "") for m in resp.json().get("models", [])]
                target = request.ollama_model or request.model
                if target and target not in models:
                    return TestConnectionResponse(
                        success=False, model=target,
                        error_code="model_not_found",
                        message=f"Ollama 已连接但未找到模型 {target}，可用: {', '.join(models[:5])}",
                    )
                return TestConnectionResponse(
                    success=True, model=target, message="Ollama 连接成功",
                )
            return TestConnectionResponse(
                success=False, model=request.model or "",
                error_code="connection_failed", message=f"Ollama 返回 HTTP {resp.status_code}",
            )
        except Exception as e:
            return TestConnectionResponse(
                success=False, model=request.model or "",
                error_code="connection_failed", message=f"无法连接 Ollama: {e}",
            )

    elif mode == "local":
        from pathlib import Path as _Path
        path = request.local_model_path or ""
        if not path:
            return TestConnectionResponse(
                success=False, model="",
                error_code="missing_config", message="请填写本地模型路径",
            )
        if not _Path(path).is_dir():
            return TestConnectionResponse(
                success=False, model=path,
                error_code="path_not_found", message=f"路径不存在或不是目录: {path}",
            )
        return TestConnectionResponse(
            success=True, model=path, message="本地模型路径有效",
        )

    else:
        return TestConnectionResponse(
            success=False, model="",
            error_code="unsupported_mode", message=f"不支持的模式: {mode}",
        )


# ---------------------------------------------------------------------------
# test-embedding（可选）
# ---------------------------------------------------------------------------

@router.post("/test-embedding", response_model=TestConnectionResponse)
async def test_embedding(request: TestConnectionRequest):
    """测试 Embedding 模型连接。"""
    if request.mode != "api":
        return TestConnectionResponse(
            success=False, model=request.model or "",
            error_code="unsupported_mode", message="Embedding 测试仅支持 API 模式",
        )

    if not request.model or not request.api_base or not request.api_key:
        return TestConnectionResponse(
            success=False, model=request.model or "",
            error_code="missing_config", message="请填写模型名、API 地址和密钥",
        )

    try:
        provider = OpenAICompatibleEmbeddingProvider(
            api_base=request.api_base, api_key=request.api_key, model=request.model,
        )
        result = await run_in_threadpool(provider.embed, ["test"])
        if result and len(result) > 0 and len(result[0]) > 0:
            return TestConnectionResponse(
                success=True, model=request.model,
                message=f"Embedding 连接成功（维度: {len(result[0])}）",
            )
        return TestConnectionResponse(
            success=False, model=request.model,
            error_code="empty_response", message="Embedding 返回为空",
        )
    except Exception as e:
        return TestConnectionResponse(
            success=False, model=request.model,
            error_code="connection_failed", message=str(e),
        )
