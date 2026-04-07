# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""后台任务队列。参见 PRD §2.6.5。

ChromaDB 写操作必须在单工作线程串行消费（max_workers=1）。
支持去重（D-0017）和 3 次指数退避重试。
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)


class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass
class TaskInfo:
    task_id: str
    task_type: str
    au_id: str
    payload: dict[str, Any]
    status: TaskStatus = TaskStatus.PENDING
    error: Optional[str] = None
    future: Optional[Future[None]] = field(default=None, repr=False)


class BackgroundTaskQueue:
    """后台任务队列（串行 + 去重 + 重试）。"""

    def __init__(self, worker_fn: Optional[Callable[[TaskInfo], None]] = None) -> None:
        self._executor = ThreadPoolExecutor(max_workers=1)
        self._lock = threading.Lock()
        self._tasks: dict[str, TaskInfo] = {}
        self._worker_fn = worker_fn or _default_worker

    def enqueue(self, task_type: str, au_id: str, payload: dict[str, Any]) -> str:
        """入队任务，返回 task_id。触发去重检查。"""
        with self._lock:
            # --- 去重（D-0017）---
            dedup_key = _dedup_key(task_type, au_id, payload)
            for tid, info in list(self._tasks.items()):
                if info.status != TaskStatus.PENDING:
                    continue
                existing_key = _dedup_key(info.task_type, info.au_id, info.payload)
                if existing_key == dedup_key:
                    logger.info("去重：丢弃重复任务 %s (已有 %s)", dedup_key, tid)
                    return tid  # 返回已有的 task_id

            # --- rebuild_index 淘汰同 AU 排队任务 ---
            if task_type == "rebuild_index":
                _cancelable = ("vectorize_chapter", "resolve_dirty_chapter",
                               "vectorize_settings_file", "delete_settings_chunks")
                for tid, info in list(self._tasks.items()):
                    if (info.au_id == au_id
                            and info.status == TaskStatus.PENDING
                            and info.task_type in _cancelable):
                        info.status = TaskStatus.CANCELLED
                        logger.info("rebuild_index 淘汰排队任务: %s (%s)", tid, info.task_type)

            task_id = str(uuid.uuid4())[:8]
            task_info = TaskInfo(
                task_id=task_id,
                task_type=task_type,
                au_id=au_id,
                payload=payload,
            )
            self._tasks[task_id] = task_info

            # 提交到线程池
            future = self._executor.submit(self._run_task, task_id)
            task_info.future = future

        return task_id

    def get_status(self, task_id: str) -> TaskStatus:
        """查询任务状态。"""
        with self._lock:
            info = self._tasks.get(task_id)
            return info.status if info else TaskStatus.FAILED

    def cancel(self, task_id: str) -> bool:
        """取消等待中的任务。已执行的无法取消。"""
        with self._lock:
            info = self._tasks.get(task_id)
            if info and info.status == TaskStatus.PENDING:
                info.status = TaskStatus.CANCELLED
                return True
            return False

    def _run_task(self, task_id: str) -> None:
        """在工作线程中执行任务（含重试）。"""
        with self._lock:
            info = self._tasks.get(task_id)
            if not info or info.status == TaskStatus.CANCELLED:
                return
            info.status = TaskStatus.RUNNING

        delays = [1, 2, 4]
        last_error: Optional[Exception] = None

        for attempt in range(3):
            try:
                self._worker_fn(info)
                with self._lock:
                    info.status = TaskStatus.COMPLETED
                return
            except Exception as e:
                last_error = e
                if attempt < 2:
                    logger.warning(
                        "任务 %s 失败 (attempt %d/3): %s，%ds 后重试",
                        task_id, attempt + 1, e, delays[attempt],
                    )
                    time.sleep(delays[attempt])

        # 3 次均失败
        with self._lock:
            info.status = TaskStatus.FAILED
            info.error = str(last_error)
        logger.error("任务 %s 3 次重试均失败: %s", task_id, last_error)

    def shutdown(self, wait: bool = True) -> None:
        """关闭线程池。"""
        self._executor.shutdown(wait=wait)


def _dedup_key(task_type: str, au_id: str, payload: dict[str, Any]) -> str:
    """生成去重 key。支持 chapter_num（章节）和 file_path（设定文件）。"""
    # 设定文件任务用 file_path 去重
    file_path = payload.get("file_path", "")
    if file_path:
        return f"{au_id}:{task_type}:{file_path}"
    chapter_num = payload.get("chapter_num", "")
    return f"{au_id}:{task_type}:{chapter_num}"


def _default_worker(info: TaskInfo) -> None:
    """默认 worker（占位）。"""
    logger.info("执行任务: %s %s", info.task_type, info.payload)
