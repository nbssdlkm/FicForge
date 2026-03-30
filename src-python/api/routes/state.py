"""State 相关 API 路由。"""

from __future__ import annotations

import logging
from dataclasses import asdict
from pathlib import Path

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from api import (
    build_chapter_repository,
    build_fact_repository,
    build_ops_repository,
    build_project_repository,
    build_state_repository,
    error_response,
    validate_path,
)
from core.domain.enums import IndexStatus
from core.services.facts_lifecycle import FactsLifecycleError, set_chapter_focus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/state", tags=["state"])


class EmbeddingFingerprintResponse(BaseModel):
    mode: str = ""
    model: str = ""
    api_base: str = ""


class StateResponse(BaseModel):
    au_id: str
    revision: int
    updated_at: str
    current_chapter: int
    last_scene_ending: str
    last_confirmed_chapter_focus: list[str]
    characters_last_seen: dict[str, int]
    chapter_focus: list[str]
    chapters_dirty: list[int]
    index_status: IndexStatus
    index_built_with: EmbeddingFingerprintResponse | None = None
    sync_unsafe: bool


class SetChapterFocusRequest(BaseModel):
    au_path: str
    focus_ids: list[str] = Field(default_factory=list)


class SetChapterFocusResponse(BaseModel):
    chapter_focus: list[str]


@router.get("", response_model=StateResponse)
async def get_state(au_path: str = Query(...)):
    repo = build_state_repository()
    state = await run_in_threadpool(repo.get, au_path)
    return StateResponse(**asdict(state))


@router.put("/chapter-focus", response_model=SetChapterFocusResponse)
async def update_chapter_focus(request: SetChapterFocusRequest):
    logger.info("Set chapter focus: au=%s focus=%s", request.au_path, request.focus_ids)
    if not validate_path(request.au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    fact_repo = build_fact_repository()
    ops_repo = build_ops_repository()
    state_repo = build_state_repository()

    try:
        result = await run_in_threadpool(
            set_chapter_focus,
            Path(request.au_path),
            request.focus_ids,
            fact_repo,
            ops_repo,
            state_repo,
        )
    except FactsLifecycleError as exc:
        logger.exception("Set chapter focus failed: au=%s", request.au_path)
        return error_response(
            400,
            "CHAPTER_FOCUS_INVALID",
            str(exc),
            ["确认 focus 均为 unresolved 且数量不超过 2"],
        )

    return SetChapterFocusResponse(chapter_focus=result["focus_ids"])


# ---------------------------------------------------------------------------
# recalc 重算全局状态
# ---------------------------------------------------------------------------

class RecalcRequest(BaseModel):
    au_path: str


class RecalcResponse(BaseModel):
    characters_last_seen: dict[str, int]
    last_scene_ending: str
    last_confirmed_chapter_focus: list[str]
    chapters_scanned: int


@router.post("/recalc", response_model=RecalcResponse)
async def recalc_state_endpoint(request: RecalcRequest):
    """重算全局状态（PRD §4.3）。"""
    logger.info("Recalc state: au=%s", request.au_path)
    if not validate_path(request.au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])

    from core.services.recalc_state import recalc_state

    try:
        result = await run_in_threadpool(
            recalc_state,
            Path(request.au_path),
            build_state_repository(),
            build_chapter_repository(),
            build_project_repository(),
        )
    except Exception as exc:
        logger.exception("Recalc state failed: au=%s", request.au_path)
        return error_response(500, "RECALC_FAILED", str(exc), [])

    return RecalcResponse(**result)
