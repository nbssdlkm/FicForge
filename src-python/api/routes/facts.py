"""Facts 相关 API 路由。"""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from api import build_fact_repository, build_ops_repository, build_state_repository, error_response
from core.domain.enums import FactSource, FactStatus, FactType, NarrativeWeight
from core.services.facts_lifecycle import FactsLifecycleError, add_fact, edit_fact, update_fact_status

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


@router.get("", response_model=list[FactResponse])
async def list_facts(
    au_path: str = Query(...),
    status: FactStatus | None = Query(None),
    chapter: int | None = Query(None),
    characters: list[str] | None = Query(None),
):
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
        return error_response(
            400,
            "ADD_FACT_INVALID",
            str(exc),
            ["检查 fact_data 字段是否合法"],
        )

    return AddFactResponse(fact_id=fact.id)


@router.put("/{fact_id}", response_model=EditFactResponse)
async def update_fact(fact_id: str, request: EditFactRequest):
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
        return error_response(
            400,
            "EDIT_FACT_INVALID",
            str(exc),
            ["检查 fact_id 和 updated_fields"],
        )

    return EditFactResponse(fact_id=fact.id, revision=fact.revision)


@router.patch("/{fact_id}/status", response_model=UpdateFactStatusResponse)
async def patch_fact_status(fact_id: str, request: UpdateFactStatusRequest):
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
