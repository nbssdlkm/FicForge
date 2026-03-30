"""Lore 相关 API 路由。"""

from pathlib import Path
from fastapi import APIRouter
from pydantic import BaseModel
from api import error_response

import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/lore", tags=["lore"])

class LoreSaveRequest(BaseModel):
    au_path: str | None = None
    fandom_path: str | None = None
    category: str
    filename: str
    content: str

class LoreReadRequest(BaseModel):
    au_path: str | None = None
    fandom_path: str | None = None
    category: str
    filename: str

@router.post("/read")
async def read_lore(req: LoreReadRequest):
    """读取 lore .md 文件内容。"""
    if ".." in req.category or "/" in req.category or "\\" in req.category:
        return error_response(400, "INVALID_CATEGORY", "分类名不合法", [])
    if ".." in req.filename or "/" in req.filename or "\\" in req.filename:
        return error_response(400, "INVALID_FILENAME", "文件名不合法", [])
    base_path = req.au_path or req.fandom_path or ""
    if ".." in base_path:
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    if req.au_path:
        base_dir = Path(req.au_path)
    elif req.fandom_path:
        base_dir = Path(req.fandom_path)
    else:
        return error_response(400, "INVALID_REQUEST", "Must provide au_path or fandom_path", [])
    file_path = base_dir / req.category / req.filename
    if not file_path.name.endswith(".md"):
        file_path = file_path.with_name(f"{file_path.name}.md")
    if not file_path.is_file():
        return {"content": ""}
    try:
        content = file_path.read_text(encoding="utf-8")
        return {"content": content}
    except Exception as e:
        logger.exception("Read lore failed: %s", file_path)
        return error_response(500, "LORE_READ_FAILED", str(e), [])

@router.put("")
async def save_lore(req: LoreSaveRequest):
    logger.info("Save lore: au=%s fandom=%s category=%s file=%s", req.au_path, req.fandom_path, req.category, req.filename)
    # 路径遍历防护
    if ".." in req.category or "/" in req.category or "\\" in req.category:
        return error_response(400, "INVALID_CATEGORY", "分类名不合法", [])
    if ".." in req.filename or "/" in req.filename or "\\" in req.filename:
        return error_response(400, "INVALID_FILENAME", "文件名不合法", [])

    base_path = req.au_path or req.fandom_path or ""
    if ".." in base_path:
        return error_response(400, "INVALID_PATH", "路径不合法", [])

    if req.au_path:
        base_dir = Path(req.au_path)
    elif req.fandom_path:
        base_dir = Path(req.fandom_path)
    else:
        return error_response(400, "INVALID_REQUEST", "Must provide au_path or fandom_path", [])
        
    target_dir = base_dir / req.category
    target_dir.mkdir(parents=True, exist_ok=True)
    
    file_path = target_dir / req.filename
    if not file_path.name.endswith(".md"):
        file_path = file_path.with_name(f"{file_path.name}.md")
        
    try:
        file_path.write_text(req.content, encoding="utf-8")
    except Exception as e:
        logger.exception("Save lore failed: category=%s file=%s", req.category, req.filename)
        return error_response(500, "LORE_SAVE_FAILED", str(e), [])
        
    return {"status": "ok", "path": str(file_path)}


@router.delete("")
async def delete_lore(req: LoreReadRequest):
    """删除指定的 lore .md 文件 → 移入垃圾箱（D-0023）。"""
    if ".." in req.category or "/" in req.category or "\\" in req.category:
        return error_response(400, "INVALID_CATEGORY", "分类名不合法", [])
    if ".." in req.filename or "/" in req.filename or "\\" in req.filename:
        return error_response(400, "INVALID_FILENAME", "文件名不合法", [])
    base_path = req.au_path or req.fandom_path or ""
    if ".." in base_path:
        return error_response(400, "INVALID_PATH", "路径不合法", [])

    if req.au_path:
        base_dir = Path(req.au_path)
    elif req.fandom_path:
        base_dir = Path(req.fandom_path)
    else:
        return error_response(400, "INVALID_REQUEST", "Must provide au_path or fandom_path", [])

    filename = req.filename
    if not filename.endswith(".md"):
        filename = f"{filename}.md"

    file_path = base_dir / req.category / filename
    if not file_path.is_file():
        return error_response(404, "NOT_FOUND", f"文件不存在: {req.filename}", [])

    # 确定实体类型
    entity_type = "character_file" if "character" in req.category else "worldbuilding_file"
    entity_name = Path(filename).stem

    from starlette.concurrency import run_in_threadpool
    from api import build_trash_service
    trash = build_trash_service()
    try:
        relative_path = f"{req.category}/{filename}"
        entry = await run_in_threadpool(
            trash.move_to_trash, base_dir, relative_path, entity_type, entity_name
        )
    except Exception as e:
        logger.exception("Delete lore failed: %s", file_path)
        return error_response(500, "DELETE_FAILED", str(e), [])

    return {"status": "ok", "trash_id": entry.trash_id, "deleted": str(file_path)}
