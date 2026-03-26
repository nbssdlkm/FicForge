"""LocalFileFactRepository — facts.jsonl 读写实现。

facts.jsonl 采用 JSONL 格式（每行一条独立 JSON）。
常规流程 append-only（D-0003），仅 undo 级联回滚时允许物理删除。

并发控制：所有写操作使用 filelock 串行化（PRD §6.7）。
⚠️ filelock 是同步阻塞的，FastAPI 路由调用时须包装在 run_in_threadpool 中。
"""

from __future__ import annotations

import json
import random
import string
import time
from pathlib import Path
from typing import Any, Optional

from filelock import FileLock

from core.domain.enums import FactSource, FactStatus, FactType, NarrativeWeight
from core.domain.fact import Fact
from infra.storage_local.file_utils import atomic_write, now_utc
from repositories.interfaces.fact_repository import FactRepository


# ---------------------------------------------------------------------------
# Fact ID 生成（PRD §6.7）
# ---------------------------------------------------------------------------

def generate_fact_id() -> str:
    """生成全局唯一 Fact ID。

    格式：f_{unix时间戳}_{4位随机字母数字}（如 f_1711230000_a3xq）。
    禁用自增序列——Phase 2D 离线双写同步时会产生主键碰撞。
    """
    ts = int(time.time())
    rand = "".join(random.choices(string.ascii_lowercase + string.digits, k=4))
    return f"f_{ts}_{rand}"


# ---------------------------------------------------------------------------
# Fact ↔ JSON 序列化
# ---------------------------------------------------------------------------

def _fact_to_dict(fact: Fact) -> dict[str, Any]:
    """Fact 领域对象 → JSON-serializable dict。"""
    d: dict[str, Any] = {
        "id": fact.id,
        "content_raw": fact.content_raw,
        "content_clean": fact.content_clean,
        "characters": fact.characters,
        "timeline": fact.timeline,
        "chapter": fact.chapter,
        "status": fact.status.value if isinstance(fact.status, FactStatus) else str(fact.status),
        "type": fact.type.value if isinstance(fact.type, FactType) else str(fact.type),
        "narrative_weight": (
            fact.narrative_weight.value
            if isinstance(fact.narrative_weight, NarrativeWeight)
            else str(fact.narrative_weight)
        ),
        "source": fact.source.value if isinstance(fact.source, FactSource) else str(fact.source),
        "revision": fact.revision,
        "created_at": fact.created_at,
        "updated_at": fact.updated_at,
    }
    # 可选字段——仅在有值时写入，保持 JSONL 紧凑
    if fact.story_time:
        d["story_time"] = fact.story_time
    if fact.resolves is not None:
        d["resolves"] = fact.resolves
    return d


def _dict_to_fact(d: dict[str, Any]) -> Fact:
    """JSON dict → Fact 领域对象（字段缺失时补默认值）。"""
    now = now_utc()
    return Fact(
        id=d["id"],
        content_raw=d.get("content_raw", ""),
        content_clean=d.get("content_clean", ""),
        characters=d.get("characters") or [],
        timeline=d.get("timeline", ""),
        story_time=d.get("story_time", ""),
        chapter=d.get("chapter", 0),
        status=FactStatus(d.get("status", "active")),
        type=FactType(d.get("type", "plot_event")),
        resolves=d.get("resolves"),
        narrative_weight=NarrativeWeight(d.get("narrative_weight", "medium")),
        source=FactSource(d.get("source", "extract_auto")),
        revision=d.get("revision", 1),
        created_at=d.get("created_at") or now,
        updated_at=d.get("updated_at") or now,
    )


# ---------------------------------------------------------------------------
# Repository 实现
# ---------------------------------------------------------------------------

class LocalFileFactRepository(FactRepository):
    """基于本地文件系统的事实表存储（facts.jsonl）。

    ⚠️ 所有方法为同步（def）——filelock 是阻塞操作，
    FastAPI async 路由调用时须包装在 starlette.concurrency.run_in_threadpool 中。
    """

    @staticmethod
    def _facts_path(au_id: str) -> Path:
        return Path(au_id) / "facts.jsonl"

    @staticmethod
    def _lock_path(au_id: str) -> Path:
        return Path(au_id) / "facts.jsonl.lock"

    @staticmethod
    def _get_lock(au_id: str) -> FileLock:
        return FileLock(str(LocalFileFactRepository._lock_path(au_id)))

    @staticmethod
    def _read_all_raw(au_id: str) -> tuple[list[Fact], list[str]]:
        """逐行读取 facts.jsonl。

        返回 (facts, error_log)。损坏行跳过并记录到 error_log。
        """
        path = LocalFileFactRepository._facts_path(au_id)
        if not path.exists():
            return [], []
        facts: list[Fact] = []
        errors: list[str] = []
        for line_num, raw_line in enumerate(
            path.read_text(encoding="utf-8").splitlines(), 1
        ):
            stripped = raw_line.strip()
            if not stripped:
                continue
            try:
                d = json.loads(stripped)
                facts.append(_dict_to_fact(d))
            except (json.JSONDecodeError, KeyError, ValueError) as e:
                errors.append(f"Line {line_num}: {e}")
        return facts, errors

    # -----------------------------------------------------------------------
    # 读取方法
    # -----------------------------------------------------------------------

    def get(self, au_id: str, fact_id: str) -> Optional[Fact]:
        facts, _ = self._read_all_raw(au_id)
        for f in facts:
            if f.id == fact_id:
                return f
        return None

    def list_all(self, au_id: str) -> list[Fact]:
        facts, _ = self._read_all_raw(au_id)
        return facts

    def list_by_status(self, au_id: str, status: FactStatus) -> list[Fact]:
        return [f for f in self.list_all(au_id) if f.status == status]

    def list_by_chapter(self, au_id: str, chapter_num: int) -> list[Fact]:
        return [f for f in self.list_all(au_id) if f.chapter == chapter_num]

    def list_by_characters(self, au_id: str, character_names: list[str]) -> list[Fact]:
        names_set = set(character_names)
        return [f for f in self.list_all(au_id) if names_set & set(f.characters)]

    def list_unresolved(self, au_id: str) -> list[Fact]:
        return self.list_by_status(au_id, FactStatus.UNRESOLVED)

    # -----------------------------------------------------------------------
    # 写入方法（全部持有 filelock）
    # -----------------------------------------------------------------------

    def append(self, au_id: str, fact: Fact) -> None:
        """追加一条 fact（append-only，D-0003）。"""
        path = self._facts_path(au_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        line = json.dumps(_fact_to_dict(fact), ensure_ascii=False) + "\n"
        with self._get_lock(au_id):
            # 确保文件末尾有换行符——防止两条 JSON 粘连
            if path.exists() and path.stat().st_size > 0:
                with open(path, "rb") as fb:
                    fb.seek(-1, 2)
                    if fb.read(1) != b"\n":
                        line = "\n" + line
            with open(path, "a", encoding="utf-8") as f:
                f.write(line)

    def update(self, au_id: str, fact: Fact) -> None:
        """原地更新（全文重写 + 原子写入）。自动刷新 updated_at + revision+1。"""
        fact.updated_at = now_utc()
        fact.revision += 1
        path = self._facts_path(au_id)
        target_line = json.dumps(_fact_to_dict(fact), ensure_ascii=False)
        with self._get_lock(au_id):
            if not path.exists():
                return
            raw_lines = path.read_text(encoding="utf-8").splitlines()
            new_lines: list[str] = []
            for raw_line in raw_lines:
                stripped = raw_line.strip()
                if not stripped:
                    continue
                try:
                    d = json.loads(stripped)
                    if d.get("id") == fact.id:
                        new_lines.append(target_line)
                    else:
                        new_lines.append(stripped)
                except json.JSONDecodeError:
                    new_lines.append(stripped)  # 保留损坏行
            content = "\n".join(new_lines) + "\n" if new_lines else ""
            atomic_write(path, content)

    def delete_by_ids(self, au_id: str, fact_ids: list[str]) -> None:
        """按 ID 列表精准删除（仅限 undo 级联回滚，D-0003）。"""
        ids_set = set(fact_ids)
        path = self._facts_path(au_id)
        with self._get_lock(au_id):
            if not path.exists():
                return
            raw_lines = path.read_text(encoding="utf-8").splitlines()
            new_lines: list[str] = []
            for raw_line in raw_lines:
                stripped = raw_line.strip()
                if not stripped:
                    continue
                try:
                    d = json.loads(stripped)
                    if d.get("id") in ids_set:
                        continue  # 跳过被删除的行
                    new_lines.append(stripped)
                except json.JSONDecodeError:
                    new_lines.append(stripped)  # 保留损坏行
            content = "\n".join(new_lines) + "\n" if new_lines else ""
            atomic_write(path, content)
