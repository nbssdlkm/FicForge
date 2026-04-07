# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""Drafts 相关 API 路由。"""

from __future__ import annotations

import logging
from dataclasses import asdict

from fastapi import APIRouter, Query
from pydantic import BaseModel
from typing import Any

from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse

from api import build_draft_filename, build_draft_repository, error_response, validate_path

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/drafts", tags=["drafts"])


class GeneratedWithPayload(BaseModel):
    mode: str = ""
    model: str = ""
    temperature: float = 0.0
    top_p: float = 0.0
    input_tokens: int = 0
    output_tokens: int = 0
    char_count: int = 0
    duration_ms: int = 0
    generated_at: str = ""


class DraftListItemResponse(BaseModel):
    draft_label: str
    filename: str


class DraftDetailResponse(BaseModel):
    au_id: str
    chapter_num: int
    variant: str
    content: str
    generated_with: GeneratedWithPayload | None = None


@router.get("", response_model=list[DraftListItemResponse])
async def list_drafts(au_path: str = Query(...), chapter_num: int = Query(...)) -> list[DraftListItemResponse] | JSONResponse:
    if not validate_path(au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    repo = build_draft_repository()
    drafts = await run_in_threadpool(repo.list_by_chapter, au_path, chapter_num)
    return [
        DraftListItemResponse(
            draft_label=draft.variant,
            filename=build_draft_filename(chapter_num, draft.variant),
        )
        for draft in drafts
    ]


@router.get("/{label}", response_model=DraftDetailResponse)
async def get_draft(label: str, au_path: str = Query(...), chapter_num: int = Query(...)) -> DraftDetailResponse | JSONResponse:
    if not validate_path(au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    repo = build_draft_repository()

    try:
        draft = await run_in_threadpool(repo.get, au_path, chapter_num, label)
    except FileNotFoundError:
        logger.exception("Draft not found: au=%s ch=%d label=%s", au_path, chapter_num, label)
        return error_response(
            404,
            "DRAFT_NOT_FOUND",
            "指定草稿不存在",
            ["检查草稿 label 和 chapter_num"],
        )

    return DraftDetailResponse(**asdict(draft))


@router.delete("")
async def delete_drafts(
    au_path: str = Query(...),
    chapter_num: int = Query(...),
    label: str | None = Query(None, description="指定草稿标签，不传则删除该章全部草稿"),
) -> Any:
    """丢弃草稿（D-0023 例外：草稿直接物理删除，不进垃圾箱）。"""
    if not validate_path(au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])

    repo = build_draft_repository()

    if label is not None:
        # 删除单个草稿
        deleted = await run_in_threadpool(repo.delete_single, au_path, chapter_num, label)
        if not deleted:
            return error_response(404, "DRAFT_NOT_FOUND", f"草稿不存在: ch{chapter_num:04d}_draft_{label}.md", [])
        return {"deleted_count": 1}
    else:
        # 删除该章全部草稿
        drafts = await run_in_threadpool(repo.list_by_chapter, au_path, chapter_num)
        if not drafts:
            return error_response(404, "DRAFT_NOT_FOUND", f"第 {chapter_num} 章无草稿", [])
        await run_in_threadpool(repo.delete_by_chapter, au_path, chapter_num)
        return {"deleted_count": len(drafts)}
