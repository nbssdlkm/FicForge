# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""Project 相关 API 路由。"""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse

from api import build_project_repository, build_state_repository, error_response, is_masked_key, validate_path
from core.domain.enums import EmotionStyle, LLMMode, Perspective
from repositories.implementations.local_file_project import ProjectInvalidError

import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/project", tags=["project"])


def _mask_api_key(key: str) -> str:
    """掩码 API Key：****{最后4位}。空值返回空，短 key 全掩码。"""
    if not key:
        return key
    if len(key) <= 8:
        return "****"
    return "****" + key[-4:]


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
    characters: list[str] = Field(default_factory=list)


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
async def get_project(au_path: str = Query(...)) -> ProjectResponse | JSONResponse:
    if not validate_path(au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    repo = build_project_repository()

    try:
        project = await run_in_threadpool(repo.get, au_path)
    except FileNotFoundError:
        logger.exception("Project not found: au=%s", au_path)
        return error_response(
            404,
            "PROJECT_NOT_FOUND",
            "指定 AU 的 project.yaml 不存在",
            ["检查 au_path 是否正确"],
        )
    except ProjectInvalidError as exc:
        logger.exception("Project invalid: au=%s", au_path)
        return error_response(
            400,
            "PROJECT_INVALID",
            str(exc),
            ["检查 project.yaml 内容是否合法"],
        )

    data = asdict(project)
    # 掩码 API Key（安全：前端不需要明文）
    if data.get("llm") and data["llm"].get("api_key"):
        data["llm"]["api_key"] = _mask_api_key(data["llm"]["api_key"])
    if data.get("embedding_lock") and data["embedding_lock"].get("api_key"):
        data["embedding_lock"]["api_key"] = _mask_api_key(data["embedding_lock"]["api_key"])
    return ProjectResponse(**data)


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
    embedding_lock: dict | None = None


class ProjectUpdateResponse(BaseModel):
    status: str
    revision: int


@router.put("", response_model=ProjectUpdateResponse)
async def update_project(payload: ProjectUpdatePayload, au_path: str = Query(...)) -> ProjectUpdateResponse | JSONResponse:
    logger.info("Update project: au=%s", au_path)
    if not validate_path(au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    repo = build_project_repository()

    try:
        project = await run_in_threadpool(repo.get, au_path)
    except FileNotFoundError:
        logger.exception("Update project - not found: au=%s", au_path)
        return error_response(404, "PROJECT_NOT_FOUND", "project.yaml 不存在", [])
    except ProjectInvalidError as exc:
        logger.exception("Update project - invalid: au=%s", au_path)
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
        project.cast_registry.characters = payload.cast_registry.characters
    if payload.core_always_include is not None:
        project.core_always_include = payload.core_always_include
    if payload.pinned_context is not None:
        project.pinned_context = payload.pinned_context
    if payload.rag_decay_coefficient is not None:
        project.rag_decay_coefficient = payload.rag_decay_coefficient
    if payload.core_guarantee_budget is not None:
        project.core_guarantee_budget = payload.core_guarantee_budget
    if payload.llm is not None:
        llm = project.llm
        for key in ("mode", "model", "api_base", "api_key", "local_model_path", "ollama_model", "context_window"):
            if key in payload.llm:
                val = payload.llm[key]
                # 掩码 api_key 不覆盖真实值
                if key == "api_key" and isinstance(val, str) and is_masked_key(val):
                    continue
                # mode 字段需要转为 LLMMode 枚举
                if key == "mode" and isinstance(val, str):
                    val = LLMMode(val)
                setattr(llm, key, val)
    if payload.model_params_override is not None:
        project.model_params_override = payload.model_params_override
    if payload.embedding_lock is not None:
        old_emb_model = project.embedding_lock.model
        lock = project.embedding_lock
        for key in ("mode", "model", "api_base", "api_key"):
            if key in payload.embedding_lock:
                val = payload.embedding_lock[key]
                if key == "api_key" and isinstance(val, str) and is_masked_key(val):
                    continue
                setattr(lock, key, val)
        # 如果 embedding 模型变了，标记索引需要重建
        if lock.model != old_emb_model:
            try:
                from core.domain.enums import IndexStatus as _IS
                state_repo = build_state_repository()
                state = await run_in_threadpool(state_repo.get, au_path)
                state.index_status = _IS.STALE
                await run_in_threadpool(state_repo.save, state)
            except Exception:
                logger.warning("embedding_lock 变更后标记 index stale 失败", exc_info=True)

    try:
        await run_in_threadpool(repo.save, project)
    except Exception as exc:
        logger.exception("Update project save failed: au=%s", au_path)
        return error_response(500, "PROJECT_SAVE_FAILED", str(exc), [])

    return ProjectUpdateResponse(status="ok", revision=project.revision)


# ---------------------------------------------------------------------------
# 铁律 (Pinned Context) CRUD
# ---------------------------------------------------------------------------

class PinnedAddRequest(BaseModel):
    text: str


@router.post("/pinned", response_model=ProjectUpdateResponse)
async def add_pinned(payload: PinnedAddRequest, au_path: str = Query(...)) -> ProjectUpdateResponse | JSONResponse:
    """添加铁律条目。"""
    if not validate_path(au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    repo = build_project_repository()
    try:
        project = await run_in_threadpool(repo.get, au_path)
    except FileNotFoundError:
        return error_response(404, "PROJECT_NOT_FOUND", "project.yaml 不存在", [])

    text = payload.text.strip()
    if not text:
        return error_response(400, "INVALID_PARAMETER", "底线内容不能为空", [])

    project.pinned_context.append(text)

    try:
        await run_in_threadpool(repo.save, project)
    except Exception as exc:
        logger.exception("Add pinned failed: au=%s", au_path)
        return error_response(500, "PROJECT_SAVE_FAILED", str(exc), [])

    return ProjectUpdateResponse(status="ok", revision=project.revision)


@router.delete("/pinned/{index}", response_model=ProjectUpdateResponse)
async def delete_pinned(index: int, au_path: str = Query(...)) -> ProjectUpdateResponse | JSONResponse:
    """删除铁律条目（按索引，直接删除不进垃圾箱 — D-0023 例外）。"""
    if not validate_path(au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    repo = build_project_repository()
    try:
        project = await run_in_threadpool(repo.get, au_path)
    except FileNotFoundError:
        return error_response(404, "PROJECT_NOT_FOUND", "project.yaml 不存在", [])

    if index < 0 or index >= len(project.pinned_context):
        return error_response(400, "INDEX_OUT_OF_RANGE", f"索引超出范围: {index}", [])

    project.pinned_context.pop(index)

    try:
        await run_in_threadpool(repo.save, project)
    except Exception as exc:
        logger.exception("Delete pinned failed: au=%s index=%d", au_path, index)
        return error_response(500, "PROJECT_SAVE_FAILED", str(exc), [])

    return ProjectUpdateResponse(status="ok", revision=project.revision)
