"""垃圾箱 API 路由。参见 D-0023。"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from api import build_task_queue, build_trash_service, error_response, validate_path

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/trash", tags=["trash"])

_trash_service = build_trash_service()


# ---------------------------------------------------------------------------
# Request / Response 模型
# ---------------------------------------------------------------------------

class RestoreRequest(BaseModel):
    trash_id: str
    scope: str = ""           # "fandom" | "au"（兼容旧参数）
    path: str = ""            # scope 根目录路径（兼容旧参数）
    au_path: str | None = None  # 新统一参数，优先于 scope+path


class TrashEntryResponse(BaseModel):
    trash_id: str
    original_path: str
    trash_path: str
    entity_type: str
    entity_name: str
    deleted_at: str
    expires_at: str
    metadata: dict[str, Any]


def _resolve_trash_path(
    au_path: str | None = None,
    path: str | None = None,
) -> str | None:
    """优先 au_path，兼容旧 scope+path 参数。"""
    return au_path or path or None


# ---------------------------------------------------------------------------
# 端点
# ---------------------------------------------------------------------------

@router.get("")
async def list_trash(
    scope: str = Query("", description="fandom 或 au（兼容旧参数）"),
    path: str = Query("", description="scope 根目录路径（兼容旧参数）"),
    au_path: str = Query("", description="目录路径（优先）"),
) -> Any:
    """列出垃圾箱中的所有条目。"""
    resolved = _resolve_trash_path(au_path or None, path or None)
    if not resolved or not validate_path(resolved):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    scope_root = Path(resolved)
    if not scope_root.is_dir():
        return error_response(404, "NOT_FOUND", f"目录不存在: {resolved}", [])

    try:
        entries = await run_in_threadpool(_trash_service.list_trash, scope_root)
    except Exception as exc:
        logger.exception("List trash failed: path=%s", resolved)
        return error_response(500, "TRASH_LIST_FAILED", str(exc), [])

    return [e.to_dict() for e in entries]


@router.post("/restore")
async def restore_from_trash(req: RestoreRequest) -> Any:
    """从垃圾箱恢复文件到原路径。"""
    resolved = _resolve_trash_path(req.au_path, req.path or None)
    if not resolved or not validate_path(resolved):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    scope_root = Path(resolved)
    if not scope_root.is_dir():
        return error_response(404, "NOT_FOUND", f"目录不存在: {resolved}", [])

    try:
        entry = await run_in_threadpool(
            _trash_service.restore, scope_root, req.trash_id
        )
    except FileNotFoundError as exc:
        return error_response(404, "TRASH_NOT_FOUND", str(exc), [])
    except FileExistsError as exc:
        return error_response(409, "RESTORE_CONFLICT", str(exc), [])
    except Exception as exc:
        logger.exception("Restore failed: path=%s id=%s", resolved, req.trash_id)
        return error_response(500, "RESTORE_FAILED", str(exc), [])

    # 恢复后入队向量化（仅 AU 文件，D-0028）
    try:
        original_path = entry.original_path  # e.g. "characters/Connor.md"
        # 判断是否 AU：scope_root 下有 project.yaml
        if (scope_root / "project.yaml").is_file():
            parts = original_path.split("/", 1)
            if len(parts) == 2 and parts[0] in ("characters", "worldbuilding"):
                category, filename = parts
                collection = "characters" if "character" in category else "worldbuilding"
                file_path = str(scope_root / original_path)
                build_task_queue().enqueue("vectorize_settings_file", str(scope_root), {
                    "file_path": file_path,
                    "collection": collection,
                })
    except Exception:
        logger.warning("恢复后向量化入队失败（不影响恢复）", exc_info=True)

    return {"status": "ok", "restored": entry.to_dict()}


@router.delete("/purge")
async def purge_expired(
    scope: str = Query(""),
    path: str = Query(""),
    au_path: str = Query(""),
    max_age_days: int | None = Query(None, description="为 0 时强制清理所有条目"),
) -> Any:
    """清理垃圾箱条目。max_age_days=0 时强制全清，不传时只清已过期。

    注意：此路由必须在 /{trash_id} 之前定义，否则 "purge" 会被匹配为 trash_id。
    """
    resolved = _resolve_trash_path(au_path or None, path or None)
    if not resolved or not validate_path(resolved):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    if max_age_days is not None and max_age_days < 0:
        return error_response(400, "INVALID_PARAMETER", "max_age_days 不能为负数", [])
    scope_root = Path(resolved)

    try:
        purged = await run_in_threadpool(
            _trash_service.purge_expired, scope_root, max_age_days
        )
    except Exception as exc:
        logger.exception("Purge expired failed: path=%s", resolved)
        return error_response(500, "PURGE_FAILED", str(exc), [])

    return {"status": "ok", "purged_count": len(purged), "purged": [e.to_dict() for e in purged]}


@router.delete("/{trash_id}")
async def permanent_delete(
    trash_id: str,
    scope: str = Query(""),
    path: str = Query(""),
    au_path: str = Query(""),
) -> Any:
    """从垃圾箱永久删除单条。"""
    resolved = _resolve_trash_path(au_path or None, path or None)
    if not resolved or not validate_path(resolved):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    scope_root = Path(resolved)

    try:
        entry = await run_in_threadpool(
            _trash_service.permanent_delete, scope_root, trash_id
        )
    except FileNotFoundError as exc:
        return error_response(404, "TRASH_NOT_FOUND", str(exc), [])
    except Exception as exc:
        logger.exception("Permanent delete failed: path=%s id=%s", resolved, trash_id)
        return error_response(500, "DELETE_FAILED", str(exc), [])

    return {"status": "ok", "deleted": entry.to_dict()}
