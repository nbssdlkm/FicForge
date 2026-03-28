"""Fandom / AU 管理路由。"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from api import build_fandom_repository, error_response
from infra.storage_local.directory import ensure_au_directories
from infra.storage_local.file_utils import now_utc

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
    repo = build_fandom_repository()
    try:
        names = await run_in_threadpool(repo.list_fandoms, data_dir)
        result = []
        for name in names:
            fandom_path = f"{data_dir}/fandoms/{name}"
            aus = await run_in_threadpool(repo.list_aus, fandom_path)
            result.append({"name": name, "aus": aus})
        return result
    except Exception as e:
        return error_response(500, "INTERNAL_ERROR", str(e))


@router.post("/fandoms")
async def create_fandom(request: CreateFandomRequest) -> Any:
    from pathlib import Path
    from core.domain.fandom import Fandom
    fandom_path = Path(request.data_dir) / "fandoms" / request.name
    fandom_path.mkdir(parents=True, exist_ok=True)
    repo = build_fandom_repository()
    fandom = Fandom(name=request.name, created_at=now_utc())
    await run_in_threadpool(repo.save, str(fandom_path), fandom)
    return {"name": request.name, "path": str(fandom_path)}


@router.get("/fandoms/{fandom_name}/aus")
async def list_aus(fandom_name: str, data_dir: str = "./fandoms") -> Any:
    repo = build_fandom_repository()
    fandom_path = f"{data_dir}/fandoms/{fandom_name}"
    try:
        aus = await run_in_threadpool(repo.list_aus, fandom_path)
        return aus
    except Exception as e:
        return error_response(500, "INTERNAL_ERROR", str(e))


@router.post("/fandoms/{fandom_name}/aus")
async def create_au(fandom_name: str, request: CreateAURequest) -> Any:
    from pathlib import Path
    au_path = Path(request.fandom_path) / "aus" / request.name
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


_SAFE_NAME_RE = re.compile(r"^[\w\-\u4e00-\u9fff]+$")


@router.get("/fandoms/{fandom_name}/files")
async def list_fandom_files(
    fandom_name: str, data_dir: str = Query("./fandoms"),
) -> Any:
    """扫描 fandom 目录下的角色和世界观 .md 文件。"""
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
        return error_response(500, "FILE_READ_FAILED", str(exc), [])

    return {"filename": filename, "category": category, "content": content}
