# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""Fandom / AU 管理路由。"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from api import build_fandom_repository, error_response, validate_path
from infra.storage_local.directory import ensure_au_directories
from infra.storage_local.file_utils import now_utc

import logging

logger = logging.getLogger(__name__)

# Windows 非法文件名字符（\ / : * ? " < > |）
_WIN_UNSAFE_RE = re.compile(r'[\\/:*?"<>|：＊？＜＞｜＂\u200b-\u200f\u2028-\u202f]')


def _safe_dirname(name: str) -> str:
    """将用户可读名称转换为 Windows 安全的目录名。

    替换半角和全角文件系统不安全字符（含中文冒号 ： 等）。
    """
    safe = _WIN_UNSAFE_RE.sub("_", name).strip().rstrip(".")
    return safe

router = APIRouter(prefix="/api/v1", tags=["fandoms"])


class FandomResponse(BaseModel):
    name: str
    aus: list[str]


class CreateFandomRequest(BaseModel):
    name: str
    data_dir: str = "./fandoms"


class CreateAURequest(BaseModel):
    name: str
    fandom_path: str


@router.get("/fandoms")
async def list_fandoms(data_dir: str = "./fandoms") -> Any:
    if not validate_path(data_dir):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    repo = build_fandom_repository()
    try:
        dir_names = await run_in_threadpool(repo.list_fandoms, data_dir)
        result = []
        for dir_name in dir_names:
            fandom_path = f"{data_dir}/fandoms/{dir_name}"
            # 从 fandom.yaml 读取显示名；fallback 到目录名
            display_name = dir_name
            try:
                fandom_obj = await run_in_threadpool(repo.get, fandom_path)
                if fandom_obj.name:
                    display_name = fandom_obj.name
            except FileNotFoundError:
                pass
            aus = await run_in_threadpool(repo.list_aus, fandom_path)
            result.append({"name": display_name, "dir_name": dir_name, "aus": aus})
        return result
    except Exception as e:
        logger.exception("List fandoms failed: data_dir=%s", data_dir)
        return error_response(500, "INTERNAL_ERROR", str(e), [])


@router.post("/fandoms")
async def create_fandom(request: CreateFandomRequest) -> Any:
    logger.info("Create fandom: name=%s", request.name)
    if not validate_path(request.name) or not validate_path(request.data_dir):
        return error_response(400, "INVALID_NAME", "名称不合法", [])
    from core.domain.fandom import Fandom
    dir_name = _safe_dirname(request.name)
    if not dir_name:
        return error_response(400, "INVALID_NAME", "名称不合法（安全化后为空）", [])
    fandom_path = Path(request.data_dir) / "fandoms" / dir_name
    # 只有目录存在且含 fandom.yaml 才算真正"已存在"
    # 空目录/残留目录允许覆盖创建
    if fandom_path.exists() and (fandom_path / "fandom.yaml").exists():
        return error_response(409, "FANDOM_ALREADY_EXISTS", f"同名 Fandom 已存在: {request.name}", [])
    fandom_path.mkdir(parents=True, exist_ok=True)
    repo = build_fandom_repository()
    fandom = Fandom(name=request.name, created_at=now_utc())
    await run_in_threadpool(repo.save, str(fandom_path), fandom)
    return {"name": request.name, "dir_name": dir_name, "path": str(fandom_path)}


@router.get("/fandoms/{fandom_name}/aus")
async def list_aus(fandom_name: str, data_dir: str = "./fandoms") -> Any:
    if not validate_path(fandom_name) or not validate_path(data_dir):
        return error_response(400, "INVALID_NAME", "名称不合法", [])
    repo = build_fandom_repository()
    fandom_path = f"{data_dir}/fandoms/{fandom_name}"
    try:
        aus = await run_in_threadpool(repo.list_aus, fandom_path)
        return aus
    except Exception as e:
        logger.exception("List AUs failed: fandom=%s", fandom_name)
        return error_response(500, "INTERNAL_ERROR", str(e), [])


@router.post("/fandoms/{fandom_name}/aus")
async def create_au(fandom_name: str, request: CreateAURequest) -> Any:
    logger.info("Create AU: fandom=%s name=%s", fandom_name, request.name)
    if not validate_path(request.name) or not validate_path(request.fandom_path):
        return error_response(400, "INVALID_NAME", "名称不合法", [])
    au_dir_name = _safe_dirname(request.name)
    if not au_dir_name:
        return error_response(400, "INVALID_NAME", "名称不合法（安全化后为空）", [])
    au_path = Path(request.fandom_path) / "aus" / au_dir_name
    if au_path.exists():
        return error_response(409, "AU_ALREADY_EXISTS", f"同名 AU 已存在: {request.name}", [])
    ensure_au_directories(au_path)

    # 初始化 project.yaml 和 state.yaml
    from core.domain.project import Project
    from core.domain.state import State
    import uuid

    project_repo = (await run_in_threadpool(lambda: __import__("api", fromlist=["build_project_repository"]).build_project_repository))()
    state_repo = (await run_in_threadpool(lambda: __import__("api", fromlist=["build_state_repository"]).build_state_repository))()

    project = Project(
        project_id=str(uuid.uuid4()),
        au_id=str(au_path),
        name=request.name,
        fandom=fandom_name,
    )
    await run_in_threadpool(project_repo.save, project)

    state = State(au_id=str(au_path))
    await run_in_threadpool(state_repo.save, state)

    return {"name": request.name, "path": str(au_path)}


def _scan_md_files(directory: Path) -> list[dict[str, str]]:
    """扫描目录下的 .md 文件，返回 [{name, filename}]。"""
    if not directory.is_dir():
        return []
    results: list[dict[str, str]] = []
    for f in sorted(directory.iterdir()):
        if f.is_file() and f.suffix == ".md":
            results.append({"name": f.stem, "filename": f.name})
    return results


_SAFE_NAME_RE = re.compile(r"^[\w\- \u4e00-\u9fff]+$")


@router.get("/fandoms/{fandom_name}/files")
async def list_fandom_files(
    fandom_name: str, data_dir: str = Query("./fandoms"),
) -> Any:
    """扫描 fandom 目录下的角色和世界观 .md 文件。"""
    if not validate_path(data_dir):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    if not _SAFE_NAME_RE.match(fandom_name):
        return error_response(400, "INVALID_NAME", "非法的 fandom 名称", [])

    fandom_dir = Path(data_dir) / "fandoms" / fandom_name

    characters = await run_in_threadpool(
        _scan_md_files, fandom_dir / "core_characters",
    )
    worldbuilding = await run_in_threadpool(
        _scan_md_files, fandom_dir / "core_worldbuilding",
    )

    return {"characters": characters, "worldbuilding": worldbuilding}


@router.get("/fandoms/{fandom_name}/files/{category}/{filename}")
async def read_fandom_file(
    fandom_name: str,
    category: str,
    filename: str,
    data_dir: str = Query("./fandoms"),
) -> Any:
    """读取 fandom 下指定分类的 .md 文件内容。"""
    if not validate_path(data_dir):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    if not _SAFE_NAME_RE.match(fandom_name):
        return error_response(400, "INVALID_NAME", "非法的 fandom 名称", [])
    if category not in ("core_characters", "core_worldbuilding"):
        return error_response(400, "INVALID_CATEGORY", "不支持的分类", [])
    # 防止路径遍历（PRD §5.5）
    if "/" in filename or "\\" in filename or ".." in filename:
        return error_response(400, "INVALID_FILENAME", "非法的文件名", [])

    file_path = Path(data_dir) / "fandoms" / fandom_name / category / filename
    if not file_path.is_file():
        return error_response(404, "FILE_NOT_FOUND", f"文件不存在: {filename}", [])

    try:
        content = await run_in_threadpool(file_path.read_text, "utf-8")
    except Exception as exc:
        logger.exception("Read fandom file failed: fandom=%s file=%s", fandom_name, filename)
        return error_response(500, "FILE_READ_FAILED", str(exc), [])

    return {"filename": filename, "category": category, "content": content}


@router.delete("/fandoms/{fandom_name}")
async def delete_fandom(fandom_name: str, data_dir: str = Query("./fandoms")) -> Any:
    """删除整个 Fandom 目录（含所有 AU）→ 移入垃圾箱（D-0023）。"""
    if not validate_path(data_dir):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    if not _SAFE_NAME_RE.match(fandom_name):
        return error_response(400, "INVALID_NAME", "非法的 fandom 名称", [])

    fandoms_root = Path(data_dir) / "fandoms"
    fandom_dir = fandoms_root / fandom_name
    if not fandom_dir.is_dir():
        return error_response(404, "NOT_FOUND", f"Fandom 不存在: {fandom_name}", [])

    from api import build_trash_service
    trash = build_trash_service()
    try:
        entry = await run_in_threadpool(
            trash.move_to_trash,
            fandoms_root,            # scope_root = fandoms/ 目录
            fandom_name,             # relative_path
            "fandom",
            fandom_name,
        )
    except Exception as exc:
        logger.exception("Delete fandom failed: %s", fandom_name)
        return error_response(500, "DELETE_FAILED", str(exc), [])

    return {"status": "ok", "trash_id": entry.trash_id, "deleted": str(fandom_dir)}


@router.delete("/fandoms/{fandom_name}/aus/{au_name}")
async def delete_au(fandom_name: str, au_name: str, data_dir: str = Query("./fandoms")) -> Any:
    """删除指定 AU 目录 → 移入垃圾箱（D-0023）。"""
    if not validate_path(data_dir):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    if not _SAFE_NAME_RE.match(fandom_name) or not _SAFE_NAME_RE.match(au_name):
        return error_response(400, "INVALID_NAME", "非法名称", [])

    fandom_dir = Path(data_dir) / "fandoms" / fandom_name
    au_dir = fandom_dir / "aus" / au_name
    if not au_dir.is_dir():
        return error_response(404, "NOT_FOUND", f"AU 不存在: {au_name}", [])

    from api import build_trash_service
    trash = build_trash_service()
    try:
        entry = await run_in_threadpool(
            trash.move_to_trash,
            fandom_dir,              # scope_root = fandom 根目录
            f"aus/{au_name}",        # relative_path
            "au",
            au_name,
        )
    except Exception as exc:
        logger.exception("Delete AU failed: fandom=%s au=%s", fandom_name, au_name)
        return error_response(500, "DELETE_FAILED", str(exc), [])

    return {"status": "ok", "trash_id": entry.trash_id, "deleted": str(au_dir)}


# ---------------------------------------------------------------------------
# 重命名
# ---------------------------------------------------------------------------

class RenameRequest(BaseModel):
    new_name: str


@router.put("/fandoms/{fandom_name}/rename")
async def rename_fandom(fandom_name: str, req: RenameRequest, data_dir: str = Query("./fandoms")) -> Any:
    """重命名 Fandom。更新目录名 + fandom.yaml 中的 name。"""
    if not validate_path(data_dir):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    if not _SAFE_NAME_RE.match(fandom_name):
        return error_response(400, "INVALID_NAME", "当前名称不合法", [])

    new_dir_name = _safe_dirname(req.new_name)
    if not new_dir_name:
        return error_response(400, "INVALID_NAME", "新名称不合法", [])

    fandoms_root = Path(data_dir) / "fandoms"
    old_dir = fandoms_root / fandom_name
    new_dir = fandoms_root / new_dir_name

    if not old_dir.is_dir():
        return error_response(404, "NOT_FOUND", f"Fandom 不存在: {fandom_name}", [])
    if new_dir.exists():
        return error_response(409, "ALREADY_EXISTS", f"目标名称已存在: {new_dir_name}", [])

    import yaml

    try:
        def _do_rename() -> None:
            # 先更新 YAML（在旧目录中），再改目录名，防止部分失败
            fandom_yaml = old_dir / "fandom.yaml"
            if fandom_yaml.is_file():
                raw = yaml.safe_load(fandom_yaml.read_text(encoding="utf-8")) or {}
                raw["name"] = req.new_name
                fandom_yaml.write_text(
                    yaml.dump(raw, allow_unicode=True, sort_keys=False),
                    encoding="utf-8",
                )
            old_dir.rename(new_dir)

        await run_in_threadpool(_do_rename)
    except Exception as exc:
        logger.exception("Rename fandom failed: %s → %s", fandom_name, req.new_name)
        return error_response(500, "RENAME_FAILED", str(exc), [])

    return {"status": "ok", "old_name": fandom_name, "new_name": req.new_name, "new_dir": new_dir_name}


@router.put("/fandoms/{fandom_name}/aus/{au_name}/rename")
async def rename_au(
    fandom_name: str,
    au_name: str,
    req: RenameRequest,
    data_dir: str = Query("./fandoms"),
) -> Any:
    """重命名 AU。更新目录名 + project.yaml 中的 name。"""
    if not validate_path(data_dir):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    if not _SAFE_NAME_RE.match(fandom_name) or not _SAFE_NAME_RE.match(au_name):
        return error_response(400, "INVALID_NAME", "名称不合法", [])

    new_dir_name = _safe_dirname(req.new_name)
    if not new_dir_name:
        return error_response(400, "INVALID_NAME", "新名称不合法", [])

    fandom_dir = Path(data_dir) / "fandoms" / fandom_name
    old_dir = fandom_dir / "aus" / au_name
    new_dir = fandom_dir / "aus" / new_dir_name

    if not old_dir.is_dir():
        return error_response(404, "NOT_FOUND", f"AU 不存在: {au_name}", [])
    if new_dir.exists():
        return error_response(409, "ALREADY_EXISTS", f"目标名称已存在: {new_dir_name}", [])

    import yaml

    try:
        def _do_rename() -> None:
            # 先更新 YAML（在旧目录中），再改目录名，防止部分失败
            project_yaml = old_dir / "project.yaml"
            if project_yaml.is_file():
                raw = yaml.safe_load(project_yaml.read_text(encoding="utf-8")) or {}
                raw["name"] = req.new_name
                raw["au_id"] = str(new_dir)
                project_yaml.write_text(
                    yaml.dump(raw, allow_unicode=True, sort_keys=False),
                    encoding="utf-8",
                )
            old_dir.rename(new_dir)

        await run_in_threadpool(_do_rename)
    except Exception as exc:
        logger.exception("Rename AU failed: %s/%s → %s", fandom_name, au_name, req.new_name)
        return error_response(500, "RENAME_FAILED", str(exc), [])

    return {"status": "ok", "old_name": au_name, "new_name": req.new_name, "new_dir": new_dir_name}
