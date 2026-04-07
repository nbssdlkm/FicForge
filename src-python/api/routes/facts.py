# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""Facts 相关 API 路由。"""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse

from api import (
    build_au_mutex,
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
from core.services.facts_extraction import extract_facts_from_chapter, extract_facts_batch, load_character_aliases
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
) -> list[FactResponse] | JSONResponse:
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
async def create_fact(request: AddFactRequest) -> AddFactResponse | JSONResponse:
    logger.info("Add fact: au=%s ch=%d", request.au_path, request.chapter_num)
    if not validate_path(request.au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    if not (request.fact_data.content_clean or "").strip():
        return error_response(400, "INVALID_PARAMETER", "剧情笔记内容不能为空", [])
    repo = build_fact_repository()
    ops_repo = build_ops_repository()

    mutex = build_au_mutex()

    def _locked_add() -> Any:
        with mutex.get_lock(request.au_path):
            return add_fact(
                Path(request.au_path),
                request.chapter_num,
                request.fact_data.model_dump(exclude_none=True),
                repo,
                ops_repo,
            )

    try:
        fact = await run_in_threadpool(_locked_add)
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
async def update_fact(fact_id: str, request: EditFactRequest) -> EditFactResponse | JSONResponse:
    logger.info("Edit fact: au=%s fact_id=%s", request.au_path, fact_id)
    if not validate_path(request.au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    repo = build_fact_repository()
    ops_repo = build_ops_repository()
    state_repo = build_state_repository()

    mutex = build_au_mutex()

    def _locked_edit() -> Any:
        with mutex.get_lock(request.au_path):
            return edit_fact(
                Path(request.au_path),
                fact_id,
                request.updated_fields,
                repo,
                ops_repo,
                state_repo,
            )

    try:
        fact = await run_in_threadpool(_locked_edit)
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
async def patch_fact_status(fact_id: str, request: UpdateFactStatusRequest) -> UpdateFactStatusResponse | JSONResponse:
    logger.info("Update fact status: au=%s fact_id=%s status=%s", request.au_path, fact_id, request.new_status.value)
    if not validate_path(request.au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    repo = build_fact_repository()
    ops_repo = build_ops_repository()
    state_repo = build_state_repository()

    mutex = build_au_mutex()

    def _locked_status() -> Any:
        with mutex.get_lock(request.au_path):
            return update_fact_status(
                Path(request.au_path),
                fact_id,
                request.new_status.value,
                request.chapter_num,
                repo,
                ops_repo,
                state_repo,
            )

    try:
        result = await run_in_threadpool(_locked_status)
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


class BatchStatusRequest(BaseModel):
    au_path: str
    fact_ids: list[str]
    new_status: FactStatus
    chapter_num: int = 0


class BatchStatusResponse(BaseModel):
    updated: int
    failed: int


@router.patch("/batch-status", response_model=BatchStatusResponse)
async def batch_update_status(request: BatchStatusRequest) -> BatchStatusResponse | JSONResponse:
    """批量更新 facts 状态。"""
    logger.info("Batch status: au=%s count=%d → %s", request.au_path, len(request.fact_ids), request.new_status.value)
    if not validate_path(request.au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])

    repo = build_fact_repository()
    ops_repo = build_ops_repository()
    state_repo = build_state_repository()
    mutex = build_au_mutex()

    updated = 0
    failed = 0
    for fact_id in request.fact_ids:
        try:
            def _locked(fid: str = fact_id) -> Any:
                with mutex.get_lock(request.au_path):
                    return update_fact_status(
                        Path(request.au_path), fid, request.new_status.value,
                        request.chapter_num, repo, ops_repo, state_repo,
                    )
            await run_in_threadpool(_locked)
            updated += 1
        except Exception:
            failed += 1

    return BatchStatusResponse(updated=updated, failed=failed)


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

    # 从 project 中获取 cast_registry，从角色文件 frontmatter 读取别名
    cast_registry_obj = getattr(project, "cast_registry", None)
    cast_registry: dict[str, Any] = asdict(cast_registry_obj) if cast_registry_obj else {"characters": []}
    character_aliases = load_character_aliases(au_path)

    # 读取语言偏好
    _language = getattr(getattr(settings, "app", None), "language", "zh") or "zh"

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
            language=_language,
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


# ---------------------------------------------------------------------------
# 批量提取（多章合并）
# ---------------------------------------------------------------------------

class ExtractFactsBatchRequest(BaseModel):
    au_path: str
    chapter_nums: list[int]
    session_llm: Optional[dict[str, Any]] = None


@router.post("/extract-batch")
async def extract_facts_batch_endpoint(request: ExtractFactsBatchRequest) -> Any:
    """批量提取多章 facts（合并为一个 LLM 调用）。"""
    logger.info("Extract facts batch: au=%s chapters=%s", request.au_path, request.chapter_nums)
    if not validate_path(request.au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    au_path = Path(request.au_path)
    chapter_repo = build_chapter_repository()
    fact_repo = build_fact_repository()
    project_repo = build_project_repository()
    settings_repo = build_settings_repository()

    # 读取各章内容
    chapters_data: list[dict[str, Any]] = []
    for ch_num in request.chapter_nums:
        try:
            content = await run_in_threadpool(
                chapter_repo.get_content_only, str(au_path), ch_num,
            )
            chapters_data.append({"chapter_num": ch_num, "content": content})
        except Exception:
            logger.warning("Extract batch: chapter %d not found, skipping", ch_num)

    if not chapters_data:
        return error_response(404, "NO_CHAPTERS", "没有找到可提取的章节", [])

    existing_facts = await run_in_threadpool(fact_repo.list_all, str(au_path))
    project = await run_in_threadpool(project_repo.get, str(au_path))
    settings = await run_in_threadpool(settings_repo.get)

    llm_config = resolve_llm_config(request.session_llm, project, settings)
    provider = create_provider(llm_config)

    cast_registry_obj = getattr(project, "cast_registry", None)
    cast_registry: dict[str, Any] = asdict(cast_registry_obj) if cast_registry_obj else {"characters": []}
    character_aliases = load_character_aliases(au_path)

    # 读取语言偏好
    try:
        _language = getattr(getattr(settings, "app", None), "language", "zh") or "zh"
    except Exception:
        _language = "zh"

    try:
        result = await run_in_threadpool(
            extract_facts_batch,
            chapters_data,
            existing_facts,
            cast_registry,
            character_aliases,
            provider,
            llm_config,
            language=_language,
        )
    except Exception as exc:
        logger.exception("Extract facts batch failed: au=%s", request.au_path)
        return error_response(500, "EXTRACT_FACTS_FAILED", f"批量提取失败: {exc}", [])

    return {"facts": [asdict(f) for f in result]}
