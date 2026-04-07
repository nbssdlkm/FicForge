# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""LocalFileOpsRepository — ops.jsonl 读写实现。

ops.jsonl 是业务关键依赖（D-0010），用于 undo 快照恢复、dirty 基线、同步回放。
严格 append-only——永不修改或删除现有条目。

并发控制：所有写操作使用 filelock 串行化（PRD §2.6.5）。
⚠️ filelock 是同步阻塞的，FastAPI 路由调用时须包装在 run_in_threadpool 中（D-0021）。
"""

from __future__ import annotations

import json
import random
import string
import time
from pathlib import Path
from typing import Any, Optional

from filelock import FileLock

from core.domain.ops_entry import OpsEntry
from repositories.interfaces.ops_repository import OpsRepository


# ---------------------------------------------------------------------------
# op_id 生成
# ---------------------------------------------------------------------------

def generate_op_id() -> str:
    """生成全局唯一操作 ID。

    格式：op_{unix时间戳}_{4位随机字母数字}（如 op_1711230000_b7k2）。
    与 fact_id 风格一致，Phase 2D 同步需要全局唯一。
    """
    ts = int(time.time())
    rand = "".join(random.choices(string.ascii_lowercase + string.digits, k=4))
    return f"op_{ts}_{rand}"


# ---------------------------------------------------------------------------
# OpsEntry ↔ JSON 序列化
# ---------------------------------------------------------------------------

def _ops_entry_to_dict(entry: OpsEntry) -> dict[str, Any]:
    """OpsEntry → JSON-serializable dict。"""
    d: dict[str, Any] = {
        "op_id": entry.op_id,
        "op_type": entry.op_type,
        "target_id": entry.target_id,
        "timestamp": entry.timestamp,
        "payload": entry.payload,
    }
    if entry.chapter_num is not None:
        d["chapter_num"] = entry.chapter_num
    return d


def _dict_to_ops_entry(d: dict[str, Any]) -> OpsEntry:
    """JSON dict → OpsEntry（字段缺失时补默认值）。"""
    return OpsEntry(
        op_id=d["op_id"],
        op_type=d.get("op_type", ""),
        target_id=d.get("target_id", ""),
        timestamp=d.get("timestamp", ""),
        chapter_num=d.get("chapter_num"),
        payload=d.get("payload") or {},
    )


# ---------------------------------------------------------------------------
# Repository 实现
# ---------------------------------------------------------------------------

class LocalFileOpsRepository(OpsRepository):
    """基于本地文件系统的操作日志存储（ops.jsonl）。

    严格 append-only——不提供 update 或 delete 方法。
    ⚠️ 所有方法为同步（def）——filelock 是阻塞操作，
    FastAPI async 路由调用时须包装在 starlette.concurrency.run_in_threadpool 中。
    """

    @staticmethod
    def _ops_path(au_id: str) -> Path:
        return Path(au_id) / "ops.jsonl"

    @staticmethod
    def _lock_path(au_id: str) -> Path:
        return Path(au_id) / "ops.jsonl.lock"

    @staticmethod
    def _get_lock(au_id: str) -> FileLock:
        return FileLock(str(LocalFileOpsRepository._lock_path(au_id)))

    @staticmethod
    def _read_all_raw(au_id: str) -> tuple[list[OpsEntry], list[str]]:
        """逐行读取 ops.jsonl。

        返回 (entries, error_log)。损坏行跳过并记录到 error_log。
        """
        path = LocalFileOpsRepository._ops_path(au_id)
        if not path.exists():
            return [], []
        entries: list[OpsEntry] = []
        errors: list[str] = []
        for line_num, raw_line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), 1
        ):
            stripped = raw_line.strip()
            if not stripped:
                continue
            try:
                d = json.loads(stripped)
                entries.append(_dict_to_ops_entry(d))
            except (json.JSONDecodeError, KeyError, ValueError) as e:
                errors.append(f"Line {line_num}: {e}")
        return entries, errors

    # -----------------------------------------------------------------------
    # 写入方法
    # -----------------------------------------------------------------------

    def append(self, au_id: str, entry: OpsEntry) -> None:
        """追加一条操作日志（严格 append-only）。"""
        path = self._ops_path(au_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(_ops_entry_to_dict(entry), ensure_ascii=False) + "\n"
        with self._get_lock(au_id):
            # 确保文件末尾有换行符——防止两条 JSON 粘连
            if path.exists() and path.stat().st_size > 0:
                with open(path, "rb") as fb:
                    fb.seek(-1, 2)
                    if fb.read(1) != b"\n":
                        line = "\n" + line
            with open(path, "a", encoding="utf-8") as f:
                f.write(line)

    # -----------------------------------------------------------------------
    # 读取方法
    # -----------------------------------------------------------------------

    def list_all(self, au_id: str) -> list[OpsEntry]:
        # 文件不存在时直接返回，不创建锁文件（避免对不存在的 AU 路径产生副作用）
        if not self._ops_path(au_id).exists():
            return []
        # 在 filelock 下读取，防止读到 append 写入一半的行造成误判损坏
        with self._get_lock(au_id):
            entries, errors = self._read_all_raw(au_id)
        if errors:
            self._handle_corruption(au_id)
        return entries

    @staticmethod
    def _handle_corruption(au_id: str) -> None:
        """损坏行检测后：创建 .bak 备份 + 通过 StateRepository 标记 sync_unsafe=True。"""
        import shutil

        # .bak 备份
        path = LocalFileOpsRepository._ops_path(au_id)
        bak_path = path.with_suffix(".jsonl.bak")
        try:
            shutil.copy2(str(path), str(bak_path))
        except Exception:
            pass

        # 通过 StateRepository 原子写入 sync_unsafe=True
        try:
            from repositories.implementations.local_file_state import LocalFileStateRepository
            state_repo = LocalFileStateRepository()
            state = state_repo.get(au_id)
            state.sync_unsafe = True
            state_repo.save(state)
        except Exception:
            pass

    def list_by_target(self, au_id: str, target_id: str) -> list[OpsEntry]:
        return [e for e in self.list_all(au_id) if e.target_id == target_id]

    def list_by_chapter(self, au_id: str, chapter_num: int) -> list[OpsEntry]:
        return [e for e in self.list_all(au_id) if e.chapter_num == chapter_num]

    def get_by_op_type(self, au_id: str, op_type: str) -> list[OpsEntry]:
        return [e for e in self.list_all(au_id) if e.op_type == op_type]

    def get_confirm_for_chapter(
        self, au_id: str, chapter_num: int
    ) -> Optional[OpsEntry]:
        """返回该章节最新的 confirm_chapter 记录（undo 步骤 6/7 用）。"""
        for e in reversed(self.list_all(au_id)):
            if e.op_type == "confirm_chapter" and e.chapter_num == chapter_num:
                return e
        return None

    def get_add_facts_for_chapter(
        self, au_id: str, chapter_num: int
    ) -> list[OpsEntry]:
        """返回 chapter_num==N 且 op_type=="add_fact" 的记录（undo 步骤 4 用）。"""
        return [
            e
            for e in self.list_all(au_id)
            if e.op_type == "add_fact" and e.chapter_num == chapter_num
        ]

    def get_latest_by_type(self, au_id: str, op_type: str) -> Optional[OpsEntry]:
        """返回指定类型的最新一条记录（按文件顺序最后一条）。"""
        entries = self.get_by_op_type(au_id, op_type)
        return entries[-1] if entries else None
