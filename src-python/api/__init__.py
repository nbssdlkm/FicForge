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
from infra.vector_index.task_queue import BackgroundTaskQueue, TaskInfo
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


def _dispatch_worker(info: TaskInfo) -> None:
    """按 task_type 分发到对应 worker。"""
    from infra.vector_index.workers import (
        worker_delete_chapter_chunks,
        worker_delete_settings_chunks,
        worker_rebuild_index,
        worker_vectorize_chapter,
        worker_vectorize_settings_file,
    )

    _workers = {
        "vectorize_chapter": worker_vectorize_chapter,
        "delete_chapter_chunks": worker_delete_chapter_chunks,
        "vectorize_settings_file": worker_vectorize_settings_file,
        "delete_settings_chunks": worker_delete_settings_chunks,
        "rebuild_index": worker_rebuild_index,
    }

    worker_fn = _workers.get(info.task_type)
    if worker_fn is None:
        import logging
        logging.getLogger(__name__).warning("未知 task_type: %s", info.task_type)
        return

    # 构建 deps（lazy，避免启动时初始化 ChromaDB）
    deps = {
        "chapter_repo": build_chapter_repository(),
        "vector_repo": _get_vector_repo(),
    }
    worker_fn(info, deps)


_vector_repo_instance: Any = None
_vector_repo_init_attempted: bool = False


def _get_vector_repo() -> Any:
    """延迟初始化 vector_repo 单例（ChromaDB + Embedding 可能不可用）。"""
    global _vector_repo_instance, _vector_repo_init_attempted
    if _vector_repo_init_attempted:
        return _vector_repo_instance
    _vector_repo_init_attempted = True

    try:
        from pathlib import Path as _Path
        from infra.vector_index.chromadb_client import init_chromadb
        from infra.embeddings.local_provider import LocalEmbeddingProvider
        from repositories.implementations.local_chroma_vector import LocalChromaVectorRepository

        persist_dir = _Path("./fandoms/.chromadb")
        client = init_chromadb(persist_dir)
        embedding = LocalEmbeddingProvider()
        _vector_repo_instance = LocalChromaVectorRepository(client, embedding)
    except Exception:
        import logging
        logging.getLogger(__name__).warning(
            "vector_repo 初始化失败，向量化功能不可用", exc_info=True
        )
    return _vector_repo_instance


_task_queue = BackgroundTaskQueue(worker_fn=_dispatch_worker)


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


def build_au_mutex() -> AUMutexManager:
    return _au_mutex


def build_trash_service() -> TrashService:
    return _trash_service


def build_task_queue() -> BackgroundTaskQueue:
    return _task_queue


def validate_path(path: str) -> bool:
    """校验路径安全性。所有接受用户路径的端点必须调用。

    拒绝：.. 路径遍历组件、空路径、null byte、超长路径。
    允许：绝对路径（桌面应用中 au_path 通常是绝对路径）。
    """
    if not path or not path.strip():
        return False
    # 拒绝 .. 组件（路径遍历防护）
    if ".." in path:
        return False
    # 拒绝 null byte（B-10）
    if "\x00" in path:
        return False
    # 拒绝超长路径（B-07，避免 OS 层 File name too long 500）
    if len(path) > 500:
        return False
    return True


# ---------------------------------------------------------------------------
# 生成状态共享（B-05 / B-06）
# ---------------------------------------------------------------------------

import time as _time

_au_generating: dict[str, float] = {}
"""AU 级生成锁：au_path → 开始时间戳。路由层维护。"""

_GENERATION_TIMEOUT = 300  # 5 分钟超时（B-06）


def mark_generating(au_path: str) -> None:
    """标记 AU 正在生成。"""
    _au_generating[au_path] = _time.time()


def clear_generating(au_path: str) -> None:
    """清除 AU 生成状态。"""
    _au_generating.pop(au_path, None)


def is_generating(au_path: str) -> bool:
    """检查 AU 是否正在生成（含超时自动清理）。"""
    start = _au_generating.get(au_path)
    if start is None:
        return False
    if _time.time() - start > _GENERATION_TIMEOUT:
        _au_generating.pop(au_path, None)
        return False
    return True
