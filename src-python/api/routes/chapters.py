# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""章节相关 API 路由。"""

from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse

from api import (
    build_chapter_repository,
    build_confirm_chapter_service,
    build_resolve_dirty_service,
    build_state_repository,
    build_undo_chapter_service,
    error_response,
    is_generating,
    validate_path,
)
from core.domain.fact_change import FactChange
from core.domain.generated_with import GeneratedWith
from core.services.confirm_chapter import ConfirmChapterError
from core.services.dirty_resolve import DirtyResolveError
from core.services.undo_chapter import UndoChapterError

import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/chapters", tags=["chapters"])


async def _generate_chapter_title(au_path: str, chapter_num: int) -> str:
    """AI 生成章节标题。失败时静默返回空字符串，不阻塞定稿流程。"""
    try:
        from api import build_settings_repository, build_project_repository
        from infra.llm.config_resolver import resolve_llm_config, create_provider
        from core.prompts import get_prompts

        settings = await run_in_threadpool(build_settings_repository().get)
        project = await run_in_threadpool(build_project_repository().get, au_path)
        language = getattr(getattr(settings, "app", None), "language", "zh") or "zh"
        P = get_prompts(language)

        # 读取章节正文（前 500 字）
        chapter_repo = build_chapter_repository()
        content = await run_in_threadpool(chapter_repo.get_content_only, au_path, chapter_num)
        snippet = content[:500] if content else ""
        if not snippet.strip():
            return ""

        llm_config = resolve_llm_config(None, project, settings)
        provider = create_provider(llm_config)
        prompt = P.CHAPTER_TITLE_PROMPT.format(content=snippet)

        response = await run_in_threadpool(
            provider.generate,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=30,
            temperature=0.5,
            top_p=0.9,
            stream=False,
        )
        title = response.content.strip().strip('"\'""''「」《》')[:20]
        return title
    except Exception:
        logger.warning("AI 章节标题生成失败（不影响定稿）", exc_info=True)
        return ""


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
    content: str | None = None  # 非 null 时用此内容替代草稿文件内容（编辑后定稿）
    title: str | None = None    # 章节标题（AI 生成或用户编辑）


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
    title: str = ""


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
async def confirm_chapter(request: ConfirmChapterRequest) -> ConfirmChapterResponse | JSONResponse:
    logger.info("Confirm chapter: au=%s ch=%d draft=%s", request.au_path, request.chapter_num, request.draft_id)
    if not validate_path(request.au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
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
            content_override=request.content,
        )
    except ConfirmChapterError as exc:
        logger.exception("Confirm chapter failed: au=%s ch=%d", request.au_path, request.chapter_num)
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

    # 保存章节标题到 state，在 AU 锁内执行防止并发覆盖
    # 如果用户手动填了 title 直接用；否则尝试 AI 生成
    final_title = request.title or ""
    if not final_title:
        final_title = await _generate_chapter_title(request.au_path, result["chapter_num"])
    if final_title:
        from api import build_au_mutex
        mutex = build_au_mutex()
        state_repo = build_state_repository()
        _ch_num = result["chapter_num"]
        def _save_title() -> None:
            with mutex.get_lock(request.au_path):
                state = state_repo.get(request.au_path)
                state.chapter_titles[_ch_num] = final_title
                state_repo.save(state)
        await run_in_threadpool(_save_title)

    return ConfirmChapterResponse(
        chapter_id=result["chapter_id"],
        chapter_num=result["chapter_num"],
        current_chapter=result["current_chapter"],
    )


@router.post("/undo", response_model=UndoChapterResponse)
async def undo_latest_chapter(request: UndoChapterRequest) -> UndoChapterResponse | JSONResponse:
    logger.info("Undo chapter: au=%s", request.au_path)
    if not validate_path(request.au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    if is_generating(request.au_path):
        return error_response(
            409,
            "GENERATION_IN_PROGRESS",
            "生成进行中，请等待完成或取消后再撤销",
            ["等待当前生成完成"],
        )
    service = build_undo_chapter_service()

    try:
        result = await run_in_threadpool(
            service.undo_latest_chapter,
            Path(request.au_path),
        )
    except UndoChapterError as exc:
        logger.exception("Undo chapter failed: au=%s", request.au_path)
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
async def resolve_dirty_chapter(request: ResolveDirtyChapterRequest) -> ResolveDirtyChapterResponse | JSONResponse:
    logger.info("Resolve dirty chapter: au=%s ch=%d", request.au_path, request.chapter_num)
    if not validate_path(request.au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
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
        logger.exception("Resolve dirty chapter failed: au=%s ch=%d", request.au_path, request.chapter_num)
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


class UpdateChapterContentRequest(BaseModel):
    au_path: str
    content: str


class UpdateChapterContentResponse(BaseModel):
    chapter_num: int
    content_hash: str
    provenance: str
    revision: int


@router.put("/{chapter_num}/content", response_model=UpdateChapterContentResponse)
async def update_chapter_content(
    chapter_num: int, request: UpdateChapterContentRequest
) -> UpdateChapterContentResponse | JSONResponse:
    """编辑已确认章节的正文（FIX-006）。

    1. 备份旧章节
    2. 用新内容覆写，重算 content_hash，provenance → mixed
    3. 将 chapter_num 加入 state.chapters_dirty
    """
    logger.info("Update chapter content: au=%s ch=%d", request.au_path, chapter_num)
    if not validate_path(request.au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])

    from infra.storage_local.file_utils import compute_content_hash, now_utc

    chapter_repo = build_chapter_repository()
    state_repo = build_state_repository()
    au_id = str(Path(request.au_path))

    try:
        chapter = await run_in_threadpool(chapter_repo.get, au_id, chapter_num)
    except FileNotFoundError:
        return error_response(404, "CHAPTER_NOT_FOUND", "指定章节不存在", ["检查章节号"])

    # 备份
    await run_in_threadpool(chapter_repo.backup_chapter, au_id, chapter_num)

    # 更新内容
    new_hash = compute_content_hash(request.content)
    chapter.content = request.content
    chapter.content_hash = new_hash
    chapter.provenance = "mixed"
    chapter.revision += 1
    chapter.confirmed_at = now_utc()
    await run_in_threadpool(chapter_repo.save, chapter)

    # 标记 dirty
    state = await run_in_threadpool(state_repo.get, au_id)
    if chapter_num not in state.chapters_dirty:
        state.chapters_dirty.append(chapter_num)
        await run_in_threadpool(state_repo.save, state)

    return UpdateChapterContentResponse(
        chapter_num=chapter_num,
        content_hash=new_hash,
        provenance="mixed",
        revision=chapter.revision,
    )


class UpdateChapterTitleRequest(BaseModel):
    au_path: str
    title: str


class UpdateChapterTitleResponse(BaseModel):
    chapter_num: int
    title: str


@router.put("/{chapter_num}/title", response_model=UpdateChapterTitleResponse)
async def update_chapter_title(
    chapter_num: int, request: UpdateChapterTitleRequest
) -> UpdateChapterTitleResponse | JSONResponse:
    """修改章节标题。"""
    logger.info("Update chapter title: au=%s ch=%d title=%s", request.au_path, chapter_num, request.title)
    if not validate_path(request.au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])

    from api import build_au_mutex
    mutex = build_au_mutex()
    state_repo = build_state_repository()

    def _update() -> str | None:
        with mutex.get_lock(request.au_path):
            state = state_repo.get(request.au_path)
            if chapter_num < 1 or chapter_num >= state.current_chapter:
                return "章节号无效"
            state.chapter_titles[chapter_num] = request.title
            state_repo.save(state)
            return None

    err = await run_in_threadpool(_update)
    if err:
        return error_response(400, "INVALID_CHAPTER", err, ["检查章节号"])
    return UpdateChapterTitleResponse(chapter_num=chapter_num, title=request.title)


@router.get("", response_model=list[ChapterListItemResponse])
async def list_chapters(au_path: str = Query(...)) -> list[ChapterListItemResponse] | JSONResponse:
    if not validate_path(au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    repo = build_chapter_repository()
    state_repo = build_state_repository()
    chapters = await run_in_threadpool(repo.list_main, au_path)
    state = await run_in_threadpool(state_repo.get, au_path)
    titles = state.chapter_titles
    return [
        ChapterListItemResponse(
            chapter_num=chapter.chapter_num,
            chapter_id=chapter.chapter_id,
            confirmed_at=chapter.confirmed_at,
            content_hash=chapter.content_hash,
            title=titles.get(chapter.chapter_num, ""),
        )
        for chapter in chapters
    ]


@router.get("/{chapter_num}", response_model=ChapterDetailResponse)
async def get_chapter(chapter_num: int, au_path: str = Query(...)) -> ChapterDetailResponse | JSONResponse:
    if not validate_path(au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    repo = build_chapter_repository()

    try:
        chapter = await run_in_threadpool(repo.get, au_path, chapter_num)
    except FileNotFoundError:
        logger.exception("Chapter not found: au=%s ch=%d", au_path, chapter_num)
        return error_response(
            404,
            "CHAPTER_NOT_FOUND",
            "指定章节不存在",
            ["检查章节号"],
        )

    return ChapterDetailResponse(**asdict(chapter))


@router.get("/{chapter_num}/content", response_model=ChapterContentResponse)
async def get_chapter_content(chapter_num: int, au_path: str = Query(...)) -> ChapterContentResponse | JSONResponse:
    if not validate_path(au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    repo = build_chapter_repository()

    try:
        content = await run_in_threadpool(repo.get_content_only, au_path, chapter_num)
    except FileNotFoundError:
        logger.exception("Chapter content not found: au=%s ch=%d", au_path, chapter_num)
        return error_response(
            404,
            "CHAPTER_NOT_FOUND",
            "指定章节不存在",
            ["检查章节号"],
        )

    return ChapterContentResponse(content=content)
