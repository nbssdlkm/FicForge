"""章节相关 API 路由。"""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from api import (
    build_chapter_repository,
    build_confirm_chapter_service,
    build_resolve_dirty_service,
    build_undo_chapter_service,
    error_response,
)
from core.domain.fact_change import FactChange
from core.domain.generated_with import GeneratedWith
from core.services.confirm_chapter import ConfirmChapterError
from core.services.dirty_resolve import DirtyResolveError
from core.services.undo_chapter import UndoChapterError

router = APIRouter(prefix="/api/v1/chapters", tags=["chapters"])


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

    def to_domain(self) -> GeneratedWith:
        return GeneratedWith(**self.model_dump())


class ConfirmChapterRequest(BaseModel):
    au_path: str
    chapter_num: int
    draft_id: str
    generated_with: GeneratedWithPayload | None = None


class ConfirmChapterResponse(BaseModel):
    chapter_id: str
    chapter_num: int
    current_chapter: int


class UndoChapterRequest(BaseModel):
    au_path: str


class UndoChapterResponse(BaseModel):
    undone_chapter_num: int
    current_chapter: int


class DirtyFactChangePayload(BaseModel):
    fact_id: str
    action: str
    updated_fields: dict[str, Any] | None = None

    def to_domain(self) -> FactChange:
        return FactChange(**self.model_dump())


class ResolveDirtyChapterRequest(BaseModel):
    au_path: str
    chapter_num: int
    confirmed_fact_changes: list[DirtyFactChangePayload] = Field(default_factory=list)


class ResolveDirtyChapterResponse(BaseModel):
    chapter_num: int
    is_latest: bool


class ChapterListItemResponse(BaseModel):
    chapter_num: int
    chapter_id: str
    confirmed_at: str
    content_hash: str


class ChapterDetailResponse(BaseModel):
    au_id: str
    chapter_num: int
    content: str
    chapter_id: str
    revision: int
    confirmed_focus: list[str]
    confirmed_at: str
    content_hash: str
    provenance: str
    generated_with: GeneratedWithPayload | None = None


class ChapterContentResponse(BaseModel):
    content: str


@router.post("/confirm", response_model=ConfirmChapterResponse)
async def confirm_chapter(request: ConfirmChapterRequest):
    service = build_confirm_chapter_service()
    generated_with = (
        request.generated_with.to_domain() if request.generated_with is not None else None
    )

    try:
        result = await run_in_threadpool(
            service.confirm_chapter,
            Path(request.au_path),
            request.chapter_num,
            request.draft_id,
            generated_with,
        )
    except ConfirmChapterError as exc:
        message = str(exc)
        if "草稿文件不存在" in message:
            return error_response(
                400,
                "DRAFT_NOT_FOUND",
                "指定的草稿文件不存在",
                ["检查草稿文件名"],
            )
        if "正在生成" in message or "幂等" in message:
            return error_response(
                409,
                "GENERATION_IN_PROGRESS",
                "当前章节正在生成中，已拒绝重复确认请求",
                ["等待当前生成完成", "稍后重试"],
            )
        return error_response(
            400,
            "CONFIRM_CHAPTER_INVALID",
            message,
            ["检查章节号和 draft_id"],
        )

    return ConfirmChapterResponse(
        chapter_id=result["chapter_id"],
        chapter_num=result["chapter_num"],
        current_chapter=result["current_chapter"],
    )


@router.post("/undo", response_model=UndoChapterResponse)
async def undo_latest_chapter(request: UndoChapterRequest):
    service = build_undo_chapter_service()

    try:
        result = await run_in_threadpool(
            service.undo_latest_chapter,
            Path(request.au_path),
        )
    except UndoChapterError as exc:
        return error_response(
            400,
            "NO_CHAPTER_TO_UNDO",
            str(exc),
            ["确认当前至少已有一章已确认内容"],
        )

    return UndoChapterResponse(
        undone_chapter_num=result["chapter_num"],
        current_chapter=result["new_current_chapter"],
    )


@router.post("/dirty/resolve", response_model=ResolveDirtyChapterResponse)
async def resolve_dirty_chapter(request: ResolveDirtyChapterRequest):
    service = build_resolve_dirty_service()
    changes = [item.to_domain() for item in request.confirmed_fact_changes]

    try:
        result = await run_in_threadpool(
            service.resolve_dirty_chapter,
            Path(request.au_path),
            request.chapter_num,
            changes,
        )
    except DirtyResolveError as exc:
        return error_response(
            400,
            "DIRTY_CHAPTER_INVALID",
            str(exc),
            ["检查章节是否处于 dirty 状态"],
        )

    return ResolveDirtyChapterResponse(
        chapter_num=result["chapter_num"],
        is_latest=result["is_latest"],
    )


@router.get("", response_model=list[ChapterListItemResponse])
async def list_chapters(au_path: str = Query(...)):
    repo = build_chapter_repository()
    chapters = await run_in_threadpool(repo.list_main, au_path)
    return [
        ChapterListItemResponse(
            chapter_num=chapter.chapter_num,
            chapter_id=chapter.chapter_id,
            confirmed_at=chapter.confirmed_at,
            content_hash=chapter.content_hash,
        )
        for chapter in chapters
    ]


@router.get("/{chapter_num}", response_model=ChapterDetailResponse)
async def get_chapter(chapter_num: int, au_path: str = Query(...)):
    repo = build_chapter_repository()

    try:
        chapter = await run_in_threadpool(repo.get, au_path, chapter_num)
    except FileNotFoundError:
        return error_response(
            404,
            "CHAPTER_NOT_FOUND",
            "指定章节不存在",
            ["检查章节号"],
        )

    return ChapterDetailResponse(**asdict(chapter))


@router.get("/{chapter_num}/content", response_model=ChapterContentResponse)
async def get_chapter_content(chapter_num: int, au_path: str = Query(...)):
    repo = build_chapter_repository()

    try:
        content = await run_in_threadpool(repo.get_content_only, au_path, chapter_num)
    except FileNotFoundError:
        return error_response(
            404,
            "CHAPTER_NOT_FOUND",
            "指定章节不存在",
            ["检查章节号"],
        )

    return ChapterContentResponse(content=content)
