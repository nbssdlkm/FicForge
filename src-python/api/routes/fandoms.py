"""Fandom / AU 管理路由。"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
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
