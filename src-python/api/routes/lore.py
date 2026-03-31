"""Lore 相关 API 路由。"""

from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from api import build_task_queue, error_response, validate_path

import logging

logger = logging.getLogger(__name__)


def _validate_filename(filename: str) -> str | None:
    """校验 lore 文件名。返回错误消息，合法时返回 None。"""
    if "\x00" in filename:
        return "文件名包含非法字符"
    stripped = filename.strip()
    if not stripped:
        return "文件名不能为空"
    # 去掉 .md 后缀后仍需有实际内容
    stem = stripped.removesuffix(".md").strip()
    if not stem:
        return "文件名不能为空"
    if len(filename) > 200:
        return "文件名过长（最多 200 字符）"
    return None


def _is_au_path(base_path: str) -> bool:
    """判断路径是否为 AU（存在 project.yaml）。Fandom 路径不含 project.yaml。"""
    return (Path(base_path) / "project.yaml").is_file()


def _enqueue_vectorize(au_path: str, category: str, filename: str) -> None:
    """入队 vectorize_settings_file（D-0028: 仅 AU 文件）。"""
    collection = "characters" if "character" in category else "worldbuilding"
    file_path = str(Path(au_path) / category / filename)
    build_task_queue().enqueue("vectorize_settings_file", au_path, {
        "file_path": file_path,
        "collection": collection,
    })


def _enqueue_delete_chunks(au_path: str, category: str, filename: str) -> None:
    """入队 delete_settings_chunks。"""
    collection = "characters" if "character" in category else "worldbuilding"
    file_path = str(Path(au_path) / category / filename)
    build_task_queue().enqueue("delete_settings_chunks", au_path, {
        "file_path": file_path,
        "collection": collection,
    })

router = APIRouter(prefix="/api/v1/lore", tags=["lore"])


# ---------------------------------------------------------------------------
# Request / Response 模型
# ---------------------------------------------------------------------------

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

class ImportFromFandomRequest(BaseModel):
    fandom_path: str
    au_path: str
    filenames: list[str]       # e.g. ["Connor.md", "Hank.md"]
    source_category: str = "core_characters"  # Fandom 层目录

@router.post("/read")
async def read_lore(req: LoreReadRequest):
    """读取 lore .md 文件内容。"""
    if ".." in req.category or "/" in req.category or "\\" in req.category:
        return error_response(400, "INVALID_CATEGORY", "分类名不合法", [])
    if ".." in req.filename or "/" in req.filename or "\\" in req.filename:
        return error_response(400, "INVALID_FILENAME", "文件名不合法", [])
    fn_err = _validate_filename(req.filename)
    if fn_err:
        return error_response(400, "INVALID_FILENAME", fn_err, [])
    base_path = req.au_path or req.fandom_path or ""
    if not validate_path(base_path):
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
    fn_err = _validate_filename(req.filename)
    if fn_err:
        return error_response(400, "INVALID_FILENAME", fn_err, [])

    base_path = req.au_path or req.fandom_path or ""
    if not validate_path(base_path):
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

    # 向量化入队（D-0028: 仅 AU 文件）
    if req.au_path and _is_au_path(req.au_path):
        try:
            fname = file_path.name
            _enqueue_vectorize(req.au_path, req.category, fname)
        except Exception:
            logger.warning("向量化入队失败（不影响保存）", exc_info=True)

    return {"status": "ok", "path": str(file_path)}


@router.delete("")
async def delete_lore(req: LoreReadRequest):
    """删除指定的 lore .md 文件 → 移入垃圾箱（D-0023）。"""
    if ".." in req.category or "/" in req.category or "\\" in req.category:
        return error_response(400, "INVALID_CATEGORY", "分类名不合法", [])
    if ".." in req.filename or "/" in req.filename or "\\" in req.filename:
        return error_response(400, "INVALID_FILENAME", "文件名不合法", [])
    fn_err = _validate_filename(req.filename)
    if fn_err:
        return error_response(400, "INVALID_FILENAME", fn_err, [])
    base_path = req.au_path or req.fandom_path or ""
    if not validate_path(base_path):
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

    # 删除 chunks 入队（D-0028: 仅 AU 文件）
    if req.au_path and _is_au_path(req.au_path):
        try:
            _enqueue_delete_chunks(req.au_path, req.category, filename)
        except Exception:
            logger.warning("删除 chunks 入队失败（不影响删除）", exc_info=True)

    return {"status": "ok", "trash_id": entry.trash_id, "deleted": str(file_path)}


# ---------------------------------------------------------------------------
# GET /lore/content — 读取内容（GET 版本，统一 B-008 的 POST /lore/read）
# ---------------------------------------------------------------------------

@router.get("/content")
async def get_lore_content(
    category: str = Query(...),
    filename: str = Query(...),
    au_path: str | None = Query(None),
    fandom_path: str | None = Query(None),
) -> Any:
    """GET 方式读取 lore 文件内容。"""
    if ".." in category or "/" in category or "\\" in category:
        return error_response(400, "INVALID_CATEGORY", "分类名不合法", [])
    if ".." in filename or "/" in filename or "\\" in filename:
        return error_response(400, "INVALID_FILENAME", "文件名不合法", [])
    fn_err = _validate_filename(filename)
    if fn_err:
        return error_response(400, "INVALID_FILENAME", fn_err, [])
    base_path = au_path or fandom_path or ""
    if not validate_path(base_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    if au_path:
        base_dir = Path(au_path)
    elif fandom_path:
        base_dir = Path(fandom_path)
    else:
        return error_response(400, "INVALID_REQUEST", "Must provide au_path or fandom_path", [])

    file_path = base_dir / category / filename
    if not file_path.name.endswith(".md"):
        file_path = file_path.with_name(f"{file_path.name}.md")
    if not file_path.is_file():
        return {"content": ""}
    try:
        content = await run_in_threadpool(file_path.read_text, "utf-8")
        return {"content": content}
    except Exception as e:
        logger.exception("Read lore content failed: %s", file_path)
        return error_response(500, "LORE_READ_FAILED", str(e), [])


# ---------------------------------------------------------------------------
# GET /lore/list — 列出指定分类下的文件
# ---------------------------------------------------------------------------

@router.get("/list")
async def list_lore(
    category: str = Query(...),
    au_path: str | None = Query(None),
    fandom_path: str | None = Query(None),
) -> Any:
    """列出指定分类目录下的 .md 文件。"""
    if ".." in category or "/" in category or "\\" in category:
        return error_response(400, "INVALID_CATEGORY", "分类名不合法", [])
    base_path = au_path or fandom_path or ""
    if not validate_path(base_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    if au_path:
        base_dir = Path(au_path)
    elif fandom_path:
        base_dir = Path(fandom_path)
    else:
        return error_response(400, "INVALID_REQUEST", "Must provide au_path or fandom_path", [])

    target_dir = base_dir / category
    if not target_dir.is_dir():
        return {"files": []}

    def _scan() -> list[dict[str, str]]:
        results: list[dict[str, str]] = []
        for f in sorted(target_dir.iterdir()):
            if f.is_file() and f.suffix == ".md":
                results.append({"name": f.stem, "filename": f.name})
        return results

    try:
        files = await run_in_threadpool(_scan)
    except Exception as e:
        logger.exception("List lore failed: %s", target_dir)
        return error_response(500, "LIST_FAILED", str(e), [])

    return {"files": files}


# ---------------------------------------------------------------------------
# POST /lore/import-from-fandom — 从 Fandom 复制角色到 AU（D-0022）
# ---------------------------------------------------------------------------

@router.post("/import-from-fandom")
async def import_from_fandom(req: ImportFromFandomRequest) -> Any:
    """从 Fandom core_characters 复制角色文件到 AU characters/。

    行为：复制文件 + 在 frontmatter 设置 origin_ref。
    cast_registry 和向量化由调用方（前端）负责后续触发。
    """
    if not validate_path(req.fandom_path) or not validate_path(req.au_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    if ".." in req.source_category or "/" in req.source_category:
        return error_response(400, "INVALID_CATEGORY", "分类名不合法", [])

    fandom_dir = Path(req.fandom_path)
    au_dir = Path(req.au_path)
    source_dir = fandom_dir / req.source_category
    target_dir = au_dir / "characters"
    target_dir.mkdir(parents=True, exist_ok=True)

    if not source_dir.is_dir():
        return error_response(404, "SOURCE_NOT_FOUND", f"Fandom 目录不存在: {req.source_category}", [])

    imported: list[str] = []
    skipped: list[str] = []

    def _do_import() -> None:
        for fname in req.filenames:
            if ".." in fname or "/" in fname or "\\" in fname:
                skipped.append(fname)
                continue
            if _validate_filename(fname) is not None:
                skipped.append(fname)
                continue
            src = source_dir / fname
            if not src.is_file():
                skipped.append(fname)
                continue
            dst = target_dir / fname
            if dst.exists():
                skipped.append(fname)
                continue

            content = src.read_text(encoding="utf-8")
            # 在 frontmatter 中注入 origin_ref（D-0022）
            char_name = Path(fname).stem
            origin_ref_line = f"origin_ref: fandom/{char_name}"
            if content.startswith("---"):
                # 已有 frontmatter → 在第二个 --- 前插入
                parts = content.split("---", 2)
                if len(parts) >= 3:
                    fm = parts[1].strip()
                    if "origin_ref" not in fm:
                        fm += f"\n{origin_ref_line}"
                    content = f"---\n{fm}\n---{parts[2]}"
            else:
                # 无 frontmatter → 添加
                content = f"---\n{origin_ref_line}\n---\n\n{content}"

            dst.write_text(content, encoding="utf-8")
            imported.append(fname)

    try:
        await run_in_threadpool(_do_import)
    except Exception as e:
        logger.exception("Import from fandom failed")
        return error_response(500, "IMPORT_FAILED", str(e), [])

    # 导入到 AU → 对每个文件入队向量化
    for fname in imported:
        try:
            _enqueue_vectorize(req.au_path, "characters", fname)
        except Exception:
            logger.warning("导入向量化入队失败: %s", fname, exc_info=True)

    return {
        "status": "ok",
        "imported": imported,
        "skipped": skipped,
    }
