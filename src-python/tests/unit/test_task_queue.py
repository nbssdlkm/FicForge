"""后台任务队列单元测试。"""

from __future__ import annotations

import threading
import time
from unittest.mock import MagicMock

import pytest

from infra.vector_index.task_queue import BackgroundTaskQueue, TaskInfo, TaskStatus


def _noop_worker(info: TaskInfo) -> None:
    """空 worker。"""
    pass


def _slow_worker(info: TaskInfo) -> None:
    """慢 worker（模拟耗时任务）。"""
    time.sleep(0.1)


# ===== 基础 =====


def test_enqueue_and_status():
    """enqueue → get_status 返回 pending/completed。"""
    q = BackgroundTaskQueue(worker_fn=_noop_worker)
    tid = q.enqueue("vectorize_chapter", "au1", {"chapter_num": 1})
    # 等任务完成
    time.sleep(0.2)
    assert q.get_status(tid) == TaskStatus.COMPLETED
    q.shutdown()


def test_task_completed():
    """任务执行完成 → completed。"""
    results = []

    def worker(info: TaskInfo) -> None:
        results.append(info.task_type)

    q = BackgroundTaskQueue(worker_fn=worker)
    q.enqueue("test_task", "au1", {})
    time.sleep(0.2)
    assert results == ["test_task"]
    q.shutdown()


def test_cancel_pending():
    """cancel 等待中的任务 → 成功。"""
    q = BackgroundTaskQueue(worker_fn=_slow_worker)
    # 先占住线程
    q.enqueue("slow", "au1", {"chapter_num": 1})
    # 第二个任务应该在 pending
    tid2 = q.enqueue("fast", "au1", {"chapter_num": 2})
    result = q.cancel(tid2)
    assert result is True
    q.shutdown(wait=False)


def test_cancel_running_fails():
    """cancel 已执行的任务 → False。"""
    q = BackgroundTaskQueue(worker_fn=_slow_worker)
    tid = q.enqueue("slow", "au1", {"chapter_num": 1})
    time.sleep(0.05)  # 让任务开始
    result = q.cancel(tid)
    # 可能已经 running 或 completed
    assert result is False or q.get_status(tid) in (TaskStatus.RUNNING, TaskStatus.COMPLETED)
    q.shutdown()


# ===== 去重 =====


def test_dedup_same_task():
    """同 AU 同章节同类型 → 后入丢弃。"""
    q = BackgroundTaskQueue(worker_fn=_slow_worker)
    # 占住线程
    q.enqueue("slow", "au1", {"chapter_num": 99})

    tid1 = q.enqueue("vectorize_chapter", "au1", {"chapter_num": 1})
    tid2 = q.enqueue("vectorize_chapter", "au1", {"chapter_num": 1})
    assert tid1 == tid2  # 返回同一 ID（去重）
    q.shutdown(wait=False)


def test_rebuild_evicts_vectorize():
    """rebuild_index → 淘汰同 AU 的 vectorize 排队任务。"""
    q = BackgroundTaskQueue(worker_fn=_slow_worker)
    # 占住线程
    q.enqueue("slow", "au1", {"chapter_num": 99})

    tid_v = q.enqueue("vectorize_chapter", "au1", {"chapter_num": 1})
    q.enqueue("rebuild_index", "au1", {})

    assert q.get_status(tid_v) == TaskStatus.CANCELLED
    q.shutdown(wait=False)


# ===== 串行 =====


def test_serial_execution():
    """连续入队 3 个任务 → 按顺序执行。"""
    order: list[int] = []
    lock = threading.Lock()

    def worker(info: TaskInfo) -> None:
        with lock:
            order.append(info.payload.get("seq", 0))
        time.sleep(0.05)

    q = BackgroundTaskQueue(worker_fn=worker)
    for i in range(3):
        q.enqueue("task", "au1", {"seq": i, "chapter_num": i})

    time.sleep(0.5)
    assert order == [0, 1, 2]
    q.shutdown()


# ===== 重试 =====


def test_retry_success_on_third():
    """前 2 次失败第 3 次成功 → completed。"""
    attempts = {"n": 0}

    def flaky_worker(info: TaskInfo) -> None:
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise RuntimeError("模拟失败")

    q = BackgroundTaskQueue(worker_fn=flaky_worker)
    tid = q.enqueue("test", "au1", {"chapter_num": 1})
    time.sleep(10)  # 等待重试 1s+2s+执行
    assert q.get_status(tid) == TaskStatus.COMPLETED
    q.shutdown()


def test_retry_all_fail():
    """3 次都失败 → failed。"""
    def always_fail(info: TaskInfo) -> None:
        raise RuntimeError("永久失败")

    q = BackgroundTaskQueue(worker_fn=always_fail)
    tid = q.enqueue("test", "au1", {"chapter_num": 1})
    time.sleep(10)  # 等待 3 次重试 1+2+4=7s
    assert q.get_status(tid) == TaskStatus.FAILED
    q.shutdown()
