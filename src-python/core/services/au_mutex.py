# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""AU 粒度互斥锁管理器。参见 DECISIONS D-0009。

同一 AU 同一时间只有一个状态机变更操作。
confirm_chapter / undo_chapter / resolve_dirty_chapter 复用此管理器。
"""

from __future__ import annotations

import threading


class AUMutexManager:
    """按 AU 分桶的互斥锁管理器。

    使用 threading.Lock 实现，适用于 run_in_threadpool 环境下的同步 Service 方法。
    API 路由层负责将 Service 调用包装在 run_in_threadpool 中。
    """

    def __init__(self) -> None:
        self._locks: dict[str, threading.Lock] = {}
        self._meta_lock = threading.Lock()

    def get_lock(self, au_id: str) -> threading.Lock:
        """获取指定 AU 的互斥锁（懒创建）。"""
        with self._meta_lock:
            if au_id not in self._locks:
                self._locks[au_id] = threading.Lock()
            return self._locks[au_id]
