"""导入/导出 API 路由。参见 PRD §4.8、§6.8。"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Query, UploadFile
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse, Response

from api import (
    build_chapter_repository,
    build_fact_repository,
    build_ops_repository,
    build_project_repository,
    build_state_repository,
    error_response,
    validate_path,
)
from core.services.import_pipeline import (
    ImportResult,
    get_split_method,
    import_chapters,
    parse_import_file,
    split_into_chapters,
)
from core.services.export_service import export_chapters

import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["import_export"])


# ---------------------------------------------------------------------------
# 请求/响应模型
# ---------------------------------------------------------------------------

class ChapterPreview(BaseModel):
    chapter_num: int
    title: str
    preview: str


class ImportUploadResponse(BaseModel):
    chapters: list[ChapterPreview]
    split_method: str
    total_chapters: int


class ImportChapterItem(BaseModel):
    chapter_num: int
    title: str
    content: str


class ImportConfirmRequest(BaseModel):
    au_path: str
    chapters: list[ImportChapterItem]
    split_method: str = "auto_3000"
    cast_registry: dict[str, list[str]] | None = None
    character_aliases: dict[str, list[str]] | None = None


class ImportConfirmResponse(BaseModel):
    total_chapters: int
    split_method: str
    characters_found: list[str]
    state_initialized: bool


# ---------------------------------------------------------------------------
# 导入端点
# ---------------------------------------------------------------------------

@router.post("/import/upload", response_model=ImportUploadResponse)
async def import_upload(file: UploadFile) -> ImportUploadResponse | JSONResponse:
    """接收上传文件，返回解析结果预览（不写入）。"""
    logger.info("Import upload: filename=%s", file.filename)
    # 验证文件扩展名
    filename = file.filename or "upload.txt"
    suffix = Path(filename).suffix.lower()
    if suffix not in (".txt", ".md", ".docx"):
        return error_response(
            400,
            "UNSUPPORTED_FORMAT",
            f"不支持的文件格式: {suffix}",
            ["支持 .txt / .md / .docx"],
        )

    # 保存临时文件
    with tempfile.NamedTemporaryFile(
        delete=False, suffix=suffix, prefix="import_"
    ) as tmp:
        content_bytes = await file.read()
        tmp.write(content_bytes)
        tmp_path = Path(tmp.name)

    try:
        # 解析
        raw_text = await run_in_threadpool(parse_import_file, tmp_path)

        # 切分
        chapters = await run_in_threadpool(split_into_chapters, raw_text, suffix.lstrip("."))
        split_method = get_split_method(raw_text)

        # 空文件检测（B-12）
        if not chapters:
            return error_response(
                400,
                "EMPTY_CONTENT",
                "文件内容为空，无法导入",
                ["请检查文件是否有实际内容"],
            )

        # 构建预览
        previews: list[ChapterPreview] = []
        for ch in chapters:
            preview_text = ch["content"][:100] if ch["content"] else ""
            previews.append(ChapterPreview(
                chapter_num=ch["chapter_num"],
                title=ch["title"],
                preview=preview_text,
            ))

        return ImportUploadResponse(
            chapters=previews,
            split_method=split_method,
            total_chapters=len(chapters),
        )
    finally:
        tmp_path.unlink(missing_ok=True)


@router.post("/import/confirm", response_model=ImportConfirmResponse)
async def import_confirm(request: ImportConfirmRequest) -> ImportConfirmResponse | JSONResponse:
    """确认导入（写入文件 + 初始化状态）。"""
    logger.info("Import confirm: au=%s chapters=%d", request.au_path, len(request.chapters))
    if not validate_path(request.au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    au_path = Path(request.au_path)

    # 转换章节数据
    chapters_data = [
        {
            "chapter_num": ch.chapter_num,
            "title": ch.title,
            "content": ch.content,
        }
        for ch in request.chapters
    ]

    if not chapters_data:
        return error_response(
            400,
            "EMPTY_CHAPTERS",
            "导入章节列表不能为空",
            ["至少提供一个章节"],
        )

    # 检查目标 AU 是否已有章节（防止静默覆盖导致数据丢失）
    existing = build_chapter_repository().list_main(str(au_path))
    if existing:
        return error_response(
            409,
            "AU_HAS_CHAPTERS",
            f"目标 AU 已有 {len(existing)} 个章节，导入会覆盖现有状态",
            ["请先备份或使用空的 AU 路径"],
        )

    # 构建 cast_registry
    cast_registry = None
    if request.cast_registry is not None:
        cast_registry = dict(request.cast_registry)

    try:
        result: ImportResult = await run_in_threadpool(
            import_chapters,
            au_path,
            chapters_data,
            build_chapter_repository(),
            build_state_repository(),
            build_ops_repository(),
            build_fact_repository(),
            build_project_repository(),
            None,  # task_queue — 导入时同步处理，Phase 1 可选
            cast_registry,
            request.character_aliases,
            request.split_method,
        )
    except Exception as exc:
        logger.exception("Import confirm failed: au=%s", request.au_path)
        return error_response(
            500,
            "IMPORT_FAILED",
            f"导入失败: {exc}",
            ["检查文件格式和目标路径"],
        )

    return ImportConfirmResponse(
        total_chapters=result.total_chapters,
        split_method=result.split_method,
        characters_found=result.characters_found,
        state_initialized=result.state_initialized,
    )


# ---------------------------------------------------------------------------
# 导出端点
# ---------------------------------------------------------------------------

@router.get("/export")
async def export_chapters_endpoint(
    au_path: str = Query(...),
    start: int = Query(1),
    end: Optional[int] = Query(None),
    format: str = Query("txt"),
    include_title: bool = Query(True),
    include_chapter_num: bool = Query(True),
) -> Response:
    """导出章节为文本文件。"""
    logger.info("Export chapters: au=%s start=%d end=%s fmt=%s", au_path, start, end, format)
    if not validate_path(au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    if format not in ("txt", "md"):
        return error_response(
            400,
            "UNSUPPORTED_FORMAT",
            f"不支持的导出格式: {format}",
            ["支持 txt / md"],
        )

    try:
        content = await run_in_threadpool(
            export_chapters,
            Path(au_path),
            build_chapter_repository(),
            start,
            end,
            format,
            include_title,
            include_chapter_num,
        )
    except Exception as exc:
        logger.exception("Export chapters failed: au=%s", au_path)
        return error_response(
            500,
            "EXPORT_FAILED",
            f"导出失败: {exc}",
            ["检查 AU 路径和章节范围"],
        )

    end_label = str(end) if end is not None else "all"
    filename = f"export_ch{start}-{end_label}.{format}"
    media_type = "text/plain" if format == "txt" else "text/markdown"

    return Response(
        content=content,
        media_type=media_type,
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
