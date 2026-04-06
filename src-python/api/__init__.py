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
    _worker_au_path = info.payload.get("au_path") if info.payload else None
    deps = {
        "chapter_repo": build_chapter_repository(),
        "vector_repo": _get_vector_repo(au_path=_worker_au_path),
        "state_repo": build_state_repository(),
    }
    worker_fn(info, deps)


_chromadb_client: Any = None
_chromadb_init_attempted: bool = False
_default_vector_repo: Any = None
_default_vector_repo_init_attempted: bool = False
_au_vector_repo_cache: dict[tuple[str, str, str, str], Any] = {}  # (au_path, model, api_base, api_key) → repo


def _ensure_chromadb_client() -> Any:
    """延迟初始化 ChromaDB 客户端单例。"""
    global _chromadb_client, _chromadb_init_attempted
    if _chromadb_init_attempted:
        return _chromadb_client
    _chromadb_init_attempted = True
    try:
        from pathlib import Path as _Path
        from infra.vector_index.chromadb_client import init_chromadb
        _chromadb_client = init_chromadb(_Path("./fandoms/.chromadb"))
    except Exception:
        import logging
        logging.getLogger(__name__).warning(
            "ChromaDB 初始化失败，向量化功能不可用", exc_info=True
        )
    return _chromadb_client


def _build_embedding_provider(mode: str, model: str, api_key: str, api_base: str) -> Any:
    """根据配置创建 embedding provider。api_key 必须是明文非掩码值。"""
    from infra.embeddings.local_provider import LocalEmbeddingProvider
    from infra.embeddings.provider import OpenAICompatibleEmbeddingProvider

    if mode == "api" and model and api_key and not api_key.startswith("****"):
        return OpenAICompatibleEmbeddingProvider(
            api_base=api_base, api_key=api_key, model=model,
        )
    return LocalEmbeddingProvider()


def _get_vector_repo(au_path: str | None = None) -> Any:
    """获取 vector_repo。

    如果 au_path 指定且该 AU 有 embedding_lock 配置，使用 AU 级 provider；
    否则使用全局默认 provider。
    """
    global _default_vector_repo, _default_vector_repo_init_attempted

    client = _ensure_chromadb_client()
    if client is None:
        return None

    from repositories.implementations.local_chroma_vector import LocalChromaVectorRepository

    # 尝试 AU 级别 embedding_lock 覆盖（带缓存）
    if au_path:
        try:
            project = build_project_repository().get(au_path)
            lock = getattr(project, "embedding_lock", None)
            if lock:
                lock_model = str(getattr(lock, "model", ""))
                lock_key = str(getattr(lock, "api_key", ""))
                lock_base = str(getattr(lock, "api_base", ""))
                lock_mode = str(getattr(lock, "mode", ""))
                if lock_model and lock_key and not lock_key.startswith("****"):
                    cache_key = (au_path, lock_model, lock_base, lock_key)
                    if cache_key not in _au_vector_repo_cache:
                        provider = _build_embedding_provider(
                            lock_mode or "api", lock_model, lock_key, lock_base,
                        )
                        _au_vector_repo_cache[cache_key] = LocalChromaVectorRepository(client, provider)
                    return _au_vector_repo_cache[cache_key]
        except Exception:
            pass  # fallback 到全局默认

    # 全局默认 provider（缓存单例）
    if not _default_vector_repo_init_attempted:
        _default_vector_repo_init_attempted = True
        try:
            settings = build_settings_repository().get()
            emb = getattr(settings, "embedding", None)
            emb_mode = str(getattr(emb, "mode", "")) if emb else ""
            emb_model = str(getattr(emb, "model", "")) if emb else ""
            emb_key = str(getattr(emb, "api_key", "")) if emb else ""
            emb_base = str(getattr(emb, "api_base", "")) if emb else ""
            provider = _build_embedding_provider(emb_mode, emb_model, emb_key, emb_base)
            _default_vector_repo = LocalChromaVectorRepository(client, provider)
        except Exception:
            import logging
            logging.getLogger(__name__).warning(
                "vector_repo 初始化失败，向量化功能不可用", exc_info=True
            )
    return _default_vector_repo


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


def build_vector_repository(au_path: str | None = None) -> Any:
    """获取 vector_repo（可能为 None）。传入 au_path 时优先使用 AU 级 embedding_lock。"""
    return _get_vector_repo(au_path=au_path)


def is_masked_key(value: str | None) -> bool:
    """检测是否为掩码 API Key（如 ****abcd 或 ****）。

    用于 PUT 写入前过滤：掩码值不应覆盖真实 Key。
    空字符串不算掩码（用户可能想清空 Key）。
    """
    if not value:
        return False
    return value.startswith("****")


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
