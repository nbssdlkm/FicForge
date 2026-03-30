"""Facts 相关 API 路由。"""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from api import (
    build_chapter_repository,
    build_fact_repository,
    build_ops_repository,
    build_project_repository,
    build_settings_repository,
    build_state_repository,
    error_response,
    validate_path,
)
from core.domain.enums import FactSource, FactStatus, FactType, NarrativeWeight
from core.services.facts_extraction import extract_facts_from_chapter
from core.services.facts_lifecycle import FactsLifecycleError, add_fact, edit_fact, update_fact_status
from infra.llm.config_resolver import create_provider, resolve_llm_config

import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/facts", tags=["facts"])


class FactDataPayload(BaseModel):
    content_raw: str = ""
    content_clean: str = ""
    characters: list[str] = Field(default_factory=list)
    timeline: str = ""
    story_time: str = ""
    chapter: int | None = None
    status: FactStatus = FactStatus.ACTIVE
    type: FactType = FactType.PLOT_EVENT
    resolves: str | None = None
    narrative_weight: NarrativeWeight = NarrativeWeight.MEDIUM


class FactResponse(BaseModel):
    id: str
    content_raw: str
    content_clean: str
    characters: list[str]
    timeline: str
    story_time: str
    chapter: int
    status: FactStatus
    type: FactType
    resolves: str | None = None
    narrative_weight: NarrativeWeight
    source: FactSource
    revision: int
    created_at: str
    updated_at: str


class AddFactRequest(BaseModel):
    au_path: str
    chapter_num: int
    fact_data: FactDataPayload


class AddFactResponse(BaseModel):
    fact_id: str


class EditFactRequest(BaseModel):
    au_path: str
    updated_fields: dict[str, Any]


class EditFactResponse(BaseModel):
    fact_id: str
    revision: int


class UpdateFactStatusRequest(BaseModel):
    au_path: str
    new_status: FactStatus
    chapter_num: int


class UpdateFactStatusResponse(BaseModel):
    fact_id: str
    status: FactStatus


class ExtractFactsRequest(BaseModel):
    au_path: str
    chapter_num: int
    session_llm: Optional[dict[str, Any]] = None
    session_params: Optional[dict[str, Any]] = None


@router.get("", response_model=list[FactResponse])
async def list_facts(
    au_path: str = Query(...),
    status: FactStatus | None = Query(None),
    chapter: int | None = Query(None),
    characters: list[str] | None = Query(None),
):
    if not validate_path(au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    repo = build_fact_repository()

    if characters:
        facts = await run_in_threadpool(repo.list_by_characters, au_path, characters)
    elif chapter is not None:
        facts = await run_in_threadpool(repo.list_by_chapter, au_path, chapter)
    elif status is not None:
        facts = await run_in_threadpool(repo.list_by_status, au_path, status)
    else:
        facts = await run_in_threadpool(repo.list_all, au_path)

    filtered = facts
    if status is not None and characters:
        filtered = [fact for fact in filtered if fact.status == status]
    if chapter is not None and characters:
        filtered = [fact for fact in filtered if fact.chapter == chapter]
    if status is not None and chapter is not None and not characters:
        filtered = [fact for fact in filtered if fact.status == status]

    return [FactResponse(**asdict(fact)) for fact in filtered]


@router.post("", response_model=AddFactResponse, status_code=201)
async def create_fact(request: AddFactRequest):
    logger.info("Add fact: au=%s ch=%d", request.au_path, request.chapter_num)
    if not validate_path(request.au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    repo = build_fact_repository()
    ops_repo = build_ops_repository()

    try:
        fact = await run_in_threadpool(
            add_fact,
            Path(request.au_path),
            request.chapter_num,
            request.fact_data.model_dump(exclude_none=True),
            repo,
            ops_repo,
        )
    except FactsLifecycleError as exc:
        logger.exception("Add fact failed: au=%s ch=%d", request.au_path, request.chapter_num)
        return error_response(
            400,
            "ADD_FACT_INVALID",
            str(exc),
            ["检查 fact_data 字段是否合法"],
        )

    return AddFactResponse(fact_id=fact.id)


@router.put("/{fact_id}", response_model=EditFactResponse)
async def update_fact(fact_id: str, request: EditFactRequest):
    logger.info("Edit fact: au=%s fact_id=%s", request.au_path, fact_id)
    if not validate_path(request.au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    repo = build_fact_repository()
    ops_repo = build_ops_repository()
    state_repo = build_state_repository()

    try:
        fact = await run_in_threadpool(
            edit_fact,
            Path(request.au_path),
            fact_id,
            request.updated_fields,
            repo,
            ops_repo,
            state_repo,
        )
    except FactsLifecycleError as exc:
        logger.exception("Edit fact failed: au=%s fact_id=%s", request.au_path, fact_id)
        return error_response(
            400,
            "EDIT_FACT_INVALID",
            str(exc),
            ["检查 fact_id 和 updated_fields"],
        )

    return EditFactResponse(fact_id=fact.id, revision=fact.revision)


@router.patch("/{fact_id}/status", response_model=UpdateFactStatusResponse)
async def patch_fact_status(fact_id: str, request: UpdateFactStatusRequest):
    logger.info("Update fact status: au=%s fact_id=%s status=%s", request.au_path, fact_id, request.new_status.value)
    if not validate_path(request.au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    repo = build_fact_repository()
    ops_repo = build_ops_repository()
    state_repo = build_state_repository()

    try:
        result = await run_in_threadpool(
            update_fact_status,
            Path(request.au_path),
            fact_id,
            request.new_status.value,
            request.chapter_num,
            repo,
            ops_repo,
            state_repo,
        )
    except FactsLifecycleError as exc:
        logger.exception("Update fact status failed: au=%s fact_id=%s", request.au_path, fact_id)
        return error_response(
            400,
            "UPDATE_FACT_STATUS_INVALID",
            str(exc),
            ["检查 fact_id、status 和 chapter_num"],
        )

    return UpdateFactStatusResponse(
        fact_id=result["fact_id"],
        status=FactStatus(result["new_status"]),
    )


@router.post("/extract")
async def extract_facts_endpoint(request: ExtractFactsRequest) -> Any:
    """提取章节中的 facts 候选列表（PRD §6.7）。"""
    logger.info("Extract facts: au=%s ch=%d", request.au_path, request.chapter_num)
    if not validate_path(request.au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    au_path = Path(request.au_path)
    chapter_repo = build_chapter_repository()
    fact_repo = build_fact_repository()
    project_repo = build_project_repository()
    settings_repo = build_settings_repository()

    try:
        content = await run_in_threadpool(
            chapter_repo.get_content_only, str(au_path), request.chapter_num,
        )
    except Exception:
        logger.exception("Extract facts chapter not found: au=%s ch=%d", request.au_path, request.chapter_num)
        return error_response(
            404,
            "CHAPTER_NOT_FOUND",
            f"章节 {request.chapter_num} 不存在",
            ["确认章节号是否正确"],
        )

    existing_facts = await run_in_threadpool(fact_repo.list_all, str(au_path))
    project = await run_in_threadpool(project_repo.get, str(au_path))
    settings = await run_in_threadpool(settings_repo.get)

    llm_config = resolve_llm_config(request.session_llm, project, settings)
    provider = create_provider(llm_config)

    # 从 project 中获取 cast_registry 和角色别名（D-0022: 统一 characters 列表）
    cast_registry_obj = getattr(project, "cast_registry", None)
    cast_registry: dict[str, Any] = asdict(cast_registry_obj) if cast_registry_obj else {"characters": []}
    character_aliases: dict[str, list[str]] = {}
    all_chars = list(cast_registry.get("characters") or [])
    for char_entry in all_chars:
        if isinstance(char_entry, dict):
            name = char_entry.get("name", "")
            aliases = char_entry.get("aliases", [])
            if name and aliases:
                character_aliases[name] = aliases

    try:
        result = await run_in_threadpool(
            extract_facts_from_chapter,
            content,
            request.chapter_num,
            existing_facts,
            cast_registry,
            character_aliases,
            provider,
            llm_config,
        )
    except Exception as exc:
        logger.exception("Extract facts failed: au=%s ch=%d", request.au_path, request.chapter_num)
        return error_response(
            500,
            "EXTRACT_FACTS_FAILED",
            f"提取失败: {exc}",
            ["检查 LLM 配置是否正确"],
        )

    return {"facts": [asdict(f) for f in result]}
