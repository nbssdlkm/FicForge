"""API 层依赖注入 + 工具函数。

所有 Repository/Service 构建器在此定义，路由文件通过导入使用。
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi.responses import JSONResponse

from core.services.au_mutex import AUMutexManager
from core.services.confirm_chapter import ConfirmChapterService
from core.services.trash_service import TrashService
from infra.vector_index.task_queue import BackgroundTaskQueue
from core.services.dirty_resolve import ResolveDirtyChapterService
from core.services.undo_chapter import UndoChapterService
from repositories.implementations.local_file_chapter import LocalFileChapterRepository
from repositories.implementations.local_file_draft import LocalFileDraftRepository
from repositories.implementations.local_file_fact import LocalFileFactRepository
from repositories.implementations.local_file_fandom import LocalFileFandomRepository
from repositories.implementations.local_file_ops import LocalFileOpsRepository
from repositories.implementations.local_file_project import LocalFileProjectRepository
from repositories.implementations.local_file_settings import LocalFileSettingsRepository
from repositories.implementations.local_file_state import LocalFileStateRepository

# ---------------------------------------------------------------------------
# 单例（Phase 1 单进程共享）
# ---------------------------------------------------------------------------

_au_mutex = AUMutexManager()
_trash_service = TrashService(retention_days=30)
_task_queue = BackgroundTaskQueue()


# ---------------------------------------------------------------------------
# Repository 构建器
# ---------------------------------------------------------------------------

def build_chapter_repository() -> LocalFileChapterRepository:
    return LocalFileChapterRepository()

def build_draft_repository() -> LocalFileDraftRepository:
    return LocalFileDraftRepository()

def build_fact_repository() -> LocalFileFactRepository:
    return LocalFileFactRepository()

def build_ops_repository() -> LocalFileOpsRepository:
    return LocalFileOpsRepository()

def build_state_repository() -> LocalFileStateRepository:
    return LocalFileStateRepository()

def build_project_repository() -> LocalFileProjectRepository:
    return LocalFileProjectRepository()

def build_settings_repository(data_dir: Path = Path("./fandoms")) -> LocalFileSettingsRepository:
    return LocalFileSettingsRepository(data_dir)

def build_fandom_repository() -> LocalFileFandomRepository:
    return LocalFileFandomRepository()


# ---------------------------------------------------------------------------
# Service 构建器
# ---------------------------------------------------------------------------

def build_confirm_chapter_service() -> ConfirmChapterService:
    return ConfirmChapterService(
        chapter_repo=build_chapter_repository(),
        draft_repo=build_draft_repository(),
        state_repo=build_state_repository(),
        ops_repo=build_ops_repository(),
        au_mutex=_au_mutex,
    )

def build_undo_chapter_service() -> UndoChapterService:
    return UndoChapterService(
        chapter_repo=build_chapter_repository(),
        draft_repo=build_draft_repository(),
        state_repo=build_state_repository(),
        ops_repo=build_ops_repository(),
        fact_repo=build_fact_repository(),
        au_mutex=_au_mutex,
    )

def build_resolve_dirty_service() -> ResolveDirtyChapterService:
    return ResolveDirtyChapterService(
        chapter_repo=build_chapter_repository(),
        state_repo=build_state_repository(),
        ops_repo=build_ops_repository(),
        fact_repo=build_fact_repository(),
        au_mutex=_au_mutex,
    )


# ---------------------------------------------------------------------------
# 工具函数
# ---------------------------------------------------------------------------

def error_response(
    status_code: int,
    error_code: str,
    message: str,
    actions: Optional[list[str]] = None,
) -> JSONResponse:
    """统一错误响应（D-0019）。"""
    return JSONResponse(
        status_code=status_code,
        content={
            "error_code": error_code,
            "message": message,
            "actions": actions or [],
        },
    )

def build_draft_filename(chapter_num: int, variant: str) -> str:
    """构建草稿文件名。"""
    return f"ch{chapter_num:04d}_draft_{variant}.md"


def build_trash_service() -> TrashService:
    return _trash_service


def build_task_queue() -> BackgroundTaskQueue:
    return _task_queue


def validate_path(path: str) -> bool:
    """拒绝含路径遍历的输入。所有接受用户路径的端点必须调用。"""
    return ".." not in path
