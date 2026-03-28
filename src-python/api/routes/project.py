"""Project 相关 API 路由。"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from api import build_project_repository, error_response
from core.domain.enums import EmotionStyle, LLMMode, Perspective
from repositories.implementations.local_file_project import ProjectInvalidError

router = APIRouter(prefix="/api/v1/project", tags=["project"])


class LLMConfigResponse(BaseModel):
    mode: LLMMode
    model: str
    api_base: str
    api_key: str
    local_model_path: str
    ollama_model: str
    context_window: int


class WritingStyleResponse(BaseModel):
    perspective: Perspective
    pov_character: str
    emotion_style: EmotionStyle
    custom_instructions: str


class CastRegistryResponse(BaseModel):
    from_core: list[str] = Field(default_factory=list)
    au_specific: list[str] = Field(default_factory=list)
    oc: list[str] = Field(default_factory=list)


class EmbeddingLockResponse(BaseModel):
    mode: str
    model: str
    api_base: str
    api_key: str


class ProjectResponse(BaseModel):
    project_id: str
    au_id: str
    name: str
    fandom: str
    schema_version: str
    revision: int
    created_at: str
    updated_at: str
    llm: LLMConfigResponse
    model_params_override: dict[str, dict[str, Any]] = Field(default_factory=dict)
    chapter_length: int
    writing_style: WritingStyleResponse
    ignore_core_worldbuilding: bool
    agent_pipeline_enabled: bool
    cast_registry: CastRegistryResponse
    core_always_include: list[str] = Field(default_factory=list)
    pinned_context: list[str] = Field(default_factory=list)
    rag_decay_coefficient: float
    embedding_lock: EmbeddingLockResponse
    core_guarantee_budget: int
    current_branch: str


@router.get("", response_model=ProjectResponse)
async def get_project(au_path: str = Query(...)):
    repo = build_project_repository()

    try:
        project = await run_in_threadpool(repo.get, au_path)
    except FileNotFoundError:
        return error_response(
            404,
            "PROJECT_NOT_FOUND",
            "指定 AU 的 project.yaml 不存在",
            ["检查 au_path 是否正确"],
        )
    except ProjectInvalidError as exc:
        return error_response(
            400,
            "PROJECT_INVALID",
            str(exc),
            ["检查 project.yaml 内容是否合法"],
        )

    return ProjectResponse(**asdict(project))


class ProjectUpdatePayload(BaseModel):
    chapter_length: int | None = None
    writing_style: WritingStyleResponse | None = None
    ignore_core_worldbuilding: bool | None = None
    agent_pipeline_enabled: bool | None = None
    cast_registry: CastRegistryResponse | None = None
    core_always_include: list[str] | None = None
    pinned_context: list[str] | None = None
    rag_decay_coefficient: float | None = None
    core_guarantee_budget: int | None = None
    llm: dict | None = None
    model_params_override: dict | None = None


class ProjectUpdateResponse(BaseModel):
    status: str
    revision: int


@router.put("", response_model=ProjectUpdateResponse)
async def update_project(payload: ProjectUpdatePayload, au_path: str = Query(...)):
    repo = build_project_repository()

    try:
        project = await run_in_threadpool(repo.get, au_path)
    except FileNotFoundError:
        return error_response(404, "PROJECT_NOT_FOUND", "project.yaml 不存在", [])
    except ProjectInvalidError as exc:
        return error_response(400, "PROJECT_INVALID", str(exc), [])

    if payload.chapter_length is not None:
        project.chapter_length = payload.chapter_length
    if payload.writing_style is not None:
        project.writing_style.perspective = payload.writing_style.perspective
        project.writing_style.pov_character = payload.writing_style.pov_character
        project.writing_style.emotion_style = payload.writing_style.emotion_style
        project.writing_style.custom_instructions = payload.writing_style.custom_instructions
    if payload.ignore_core_worldbuilding is not None:
        project.ignore_core_worldbuilding = payload.ignore_core_worldbuilding
    if payload.agent_pipeline_enabled is not None:
        project.agent_pipeline_enabled = payload.agent_pipeline_enabled
    if payload.cast_registry is not None:
        project.cast_registry.from_core = payload.cast_registry.from_core
        project.cast_registry.au_specific = payload.cast_registry.au_specific
        project.cast_registry.oc = payload.cast_registry.oc
    if payload.core_always_include is not None:
        project.core_always_include = payload.core_always_include
    if payload.pinned_context is not None:
        project.pinned_context = payload.pinned_context
    if payload.rag_decay_coefficient is not None:
        project.rag_decay_coefficient = payload.rag_decay_coefficient
    if payload.core_guarantee_budget is not None:
        project.core_guarantee_budget = payload.core_guarantee_budget

    try:
        await run_in_threadpool(repo.save, project)
    except Exception as exc:
        return error_response(500, "PROJECT_SAVE_FAILED", str(exc), [])

    return ProjectUpdateResponse(status="ok", revision=project.revision)
