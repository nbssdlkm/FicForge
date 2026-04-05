"""批注 API 路由（FIX-005B）。

数据层预留，前端暂不消费。
批注不碰正文、不触发 dirty、不进 ChromaDB。
"""

from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from api import error_response, validate_path
from core.domain.annotation import ANNOTATION_SCHEMA_VERSION

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/annotations", tags=["annotations"])


class AnnotationItem(BaseModel):
    id: str = ""
    type: str = "highlight"  # highlight | comment | bookmark
    start_offset: int = 0
    end_offset: int = 0
    color: str = "yellow"
    comment: str = ""
    created_at: str = ""


class ChapterAnnotationsResponse(BaseModel):
    schema_version: str = ANNOTATION_SCHEMA_VERSION
    chapter_num: int = 0
    annotations: list[AnnotationItem] = Field(default_factory=list)


class SaveAnnotationsRequest(BaseModel):
    au_path: str
    annotations: list[AnnotationItem] = Field(default_factory=list)


def _annotations_path(au_path: str, chapter_num: int) -> Path:
    return Path(au_path) / "chapters" / "annotations" / f"ch{chapter_num:04d}_annotations.json"


def _read_annotations(au_path: str, chapter_num: int) -> dict[str, Any]:
    path = _annotations_path(au_path, chapter_num)
    if not path.exists():
        return {
            "schema_version": ANNOTATION_SCHEMA_VERSION,
            "chapter_num": chapter_num,
            "annotations": [],
        }
    return json.loads(path.read_text(encoding="utf-8"))


def _write_annotations(au_path: str, chapter_num: int, data: dict[str, Any]) -> None:
    path = _annotations_path(au_path, chapter_num)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


@router.get("/{chapter_num}", response_model=ChapterAnnotationsResponse)
async def get_annotations(
    chapter_num: int,
    au_path: str = Query(...),
) -> ChapterAnnotationsResponse:
    """获取一章的批注列表。"""
    if not validate_path(au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])  # type: ignore[return-value]
    data = await run_in_threadpool(_read_annotations, au_path, chapter_num)
    return ChapterAnnotationsResponse(**data)


@router.put("/{chapter_num}", response_model=ChapterAnnotationsResponse)
async def save_annotations(
    chapter_num: int,
    request: SaveAnnotationsRequest,
) -> ChapterAnnotationsResponse:
    """保存一章的批注列表（全量覆写）。"""
    if not validate_path(request.au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])  # type: ignore[return-value]

    # 为没有 id 的批注生成 id
    items: list[dict[str, Any]] = []
    for ann in request.annotations:
        d = ann.model_dump()
        if not d.get("id"):
            d["id"] = f"ann_{uuid.uuid4().hex[:6]}"
        items.append(d)

    data = {
        "schema_version": ANNOTATION_SCHEMA_VERSION,
        "chapter_num": chapter_num,
        "annotations": items,
    }
    await run_in_threadpool(_write_annotations, request.au_path, chapter_num, data)
    return ChapterAnnotationsResponse(**data)
