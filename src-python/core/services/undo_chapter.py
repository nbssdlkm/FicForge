"""撤销最新章流程。参见 PRD §6.3 步骤 0-10。

⚠️ 这是整个项目最危险的 Service：10 步级联回滚，涉及 5 类文件。
任何一步遗漏都可能导致数据不一致。

严格遵循多文件写入顺序：数据变更 → state → ops（事务提交标记）。
AU 互斥锁在入口获取（D-0009）。方法是同步的（D-0021）。
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Coroutine, Optional, TypeVar

from core.domain.character_scanner import scan_characters_in_chapter
from core.domain.enums import FactStatus, IndexStatus
from core.domain.ops_entry import OpsEntry
from core.domain.text_utils import extract_last_scene_ending
from core.services.au_mutex import AUMutexManager
from infra.storage_local.file_utils import now_utc
from repositories.implementations.local_file_ops import generate_op_id
from repositories.interfaces.chapter_repository import ChapterRepository
from repositories.interfaces.draft_repository import DraftRepository
from repositories.interfaces.fact_repository import FactRepository
from repositories.interfaces.ops_repository import OpsRepository
from repositories.interfaces.state_repository import StateRepository

_T = TypeVar("_T")


def _call(coro: Coroutine[Any, Any, _T]) -> _T:
    """Run async-but-actually-sync Repository coroutine synchronously."""
    return asyncio.run(coro)


class UndoChapterError(Exception):
    """撤销章节流程错误。"""


class UndoChapterService:
    """撤销最新章 Service（PRD §6.3 步骤 0-10）。

    依赖通过构造器注入。方法是同步的（D-0021），API 层负责 async 包装。
    """

    def __init__(
        self,
        chapter_repo: ChapterRepository,
        draft_repo: DraftRepository,
        state_repo: StateRepository,
        ops_repo: OpsRepository,
        fact_repo: FactRepository,
        au_mutex: AUMutexManager,
    ) -> None:
        self._chapter_repo = chapter_repo
        self._draft_repo = draft_repo
        self._state_repo = state_repo
        self._ops_repo = ops_repo
        self._fact_repo = fact_repo
        self._mutex = au_mutex

    def undo_latest_chapter(
        self,
        au_path: Path,
        cast_registry: Optional[dict[str, Any]] = None,
        character_aliases: Optional[dict[str, list[str]]] = None,
    ) -> dict[str, Any]:
        """撤销最新章。严格遵循 PRD §6.3 步骤 0-10。

        Args:
            au_path: AU 根目录。
            cast_registry: project.yaml 的 cast_registry（快照真空兜底时需要）。
            character_aliases: {主名: [别名列表]}（快照真空兜底时需要）。

        Returns:
            撤销结果 dict（chapter_num, new_current_chapter）。

        Raises:
            UndoChapterError: 没有章节可撤销或其他前置校验失败。
        """
        au_id = str(au_path)

        with self._mutex.get_lock(au_id):
            return self._do_undo(
                au_id,
                cast_registry or {},
                character_aliases or {},
            )

    def _do_undo(
        self,
        au_id: str,
        cast_registry: dict[str, Any],
        character_aliases: dict[str, list[str]],
    ) -> dict[str, Any]:
        """锁内执行撤销流程（步骤 0-10）。"""

        # =================================================================
        # 步骤 0：前置校验 + 异步任务取消
        # =================================================================
        state = _call(self._state_repo.get(au_id))
        n = state.current_chapter - 1

        if n < 1:
            raise UndoChapterError("没有已确认章节可撤销（current_chapter == 1）")

        # TODO: T-017 BackgroundTaskQueue — 取消该章的 vectorize_chapter 任务
        # 防止 undo 删除 chunks 后，延迟执行的向量化重新写回幽灵数据

        # =================================================================
        # 步骤 1：确定被撤销的章节号 N
        # =================================================================
        # N = current_chapter - 1（D-0001）

        # 读取被撤销章节信息（用于 ops target_id）
        chapter_id = ""
        try:
            old_chapter = _call(self._chapter_repo.get(au_id, n))
            chapter_id = old_chapter.chapter_id
        except FileNotFoundError:
            pass  # 章节文件已不存在（异常状态），继续回滚

        # =================================================================
        # 步骤 3：facts 状态回滚（在删除前执行，以便读取 resolves 关系）
        # =================================================================
        self._rollback_fact_statuses(au_id, n)

        # =================================================================
        # 步骤 2：删除章节文件 + 清理 ≥N 的所有草稿（D-0016）
        # =================================================================
        _call(self._chapter_repo.delete(au_id, n))
        _call(self._draft_repo.delete_from_chapter(au_id, n))

        # =================================================================
        # 步骤 4：facts 物理删除（D-0003，通过 ops target_id 精准删除）
        # =================================================================
        self._delete_chapter_facts(au_id, n)

        # =================================================================
        # 步骤 5：ChromaDB chunks 删除（Phase 1: 标记 stale）
        # =================================================================
        # TODO: T-017 queue.enqueue(delete_chapter_chunks, n)
        state.index_status = IndexStatus.STALE

        # =================================================================
        # 步骤 6：last_scene_ending 回滚
        # =================================================================
        state.last_scene_ending = self._rollback_last_scene_ending(au_id, n)

        # =================================================================
        # 步骤 7：characters_last_seen 回滚
        # =================================================================
        state.characters_last_seen = self._rollback_characters_last_seen(
            au_id, n, cast_registry, character_aliases
        )

        # =================================================================
        # 步骤 8：chapter_focus 清空
        # =================================================================
        state.chapter_focus = []

        # =================================================================
        # 步骤 9：last_confirmed_chapter_focus 回退
        # =================================================================
        state.last_confirmed_chapter_focus = self._rollback_confirmed_focus(
            au_id, n
        )

        # =================================================================
        # 步骤 10：chapters_dirty 清理
        # =================================================================
        if n in state.chapters_dirty:
            state.chapters_dirty.remove(n)

        # =================================================================
        # 更新 current_chapter
        # =================================================================
        state.current_chapter = n  # 回退：下一章待写变回 N

        # =================================================================
        # 最终写入（遵循多文件写入顺序）
        # =================================================================

        # state.yaml（StateRepository.save 自动 revision+1 + updated_at）
        _call(self._state_repo.save(state))

        # ops.jsonl（事务提交标记，payload 为空 {}）
        ops_entry = OpsEntry(
            op_id=generate_op_id(),
            op_type="undo_chapter",
            target_id=chapter_id,
            chapter_num=n,
            timestamp=now_utc(),
            payload={},
        )
        self._ops_repo.append(au_id, ops_entry)

        return {
            "chapter_num": n,
            "new_current_chapter": state.current_chapter,
        }

    # -----------------------------------------------------------------
    # 步骤 3：facts 状态回滚
    # -----------------------------------------------------------------

    def _rollback_fact_statuses(self, au_id: str, n: int) -> None:
        """回滚被撤销章节 facts 的 resolves 关系。

        对于 chapter==N 的 facts 中有 resolves 字段的条目：
        找到被 resolves 指向的目标 fact，若其 status 为 "resolved"
        且无其他 fact 仍然 resolves 它，则恢复为 "unresolved"。
        """
        all_facts = self._fact_repo.list_all(au_id)
        chapter_n_facts = [f for f in all_facts if f.chapter == n]

        # 收集需要检查的 target_id
        targets_to_check: set[str] = set()
        for fact in chapter_n_facts:
            if fact.resolves:
                targets_to_check.add(fact.resolves)

        if not targets_to_check:
            return

        # 找出即将被删除的 fact IDs（步骤 4 用 ops，但这里需要预判）
        add_fact_ops = self._ops_repo.get_add_facts_for_chapter(au_id, n)
        ids_to_delete = {op.target_id for op in add_fact_ops}

        for target_id in targets_to_check:
            target = self._fact_repo.get(au_id, target_id)
            if target is None or target.status != FactStatus.RESOLVED:
                continue

            # 检查是否有其他 fact（排除即将删除的）仍然 resolves 该目标
            still_resolved = any(
                f.resolves == target_id
                for f in all_facts
                if f.id not in ids_to_delete and f.id != target_id
            )
            if not still_resolved:
                target.status = FactStatus.UNRESOLVED
                self._fact_repo.update(au_id, target)

    # -----------------------------------------------------------------
    # 步骤 4：facts 物理删除
    # -----------------------------------------------------------------

    def _delete_chapter_facts(self, au_id: str, n: int) -> None:
        """通过 ops target_id 精准删除第 N 章的 facts（D-0003）。

        ⚠️ 禁止按 chapter 字段删除——chapter 是用户可变字段。
        若 ops 中无 add_fact 记录，不删除任何 fact。
        """
        add_fact_ops = self._ops_repo.get_add_facts_for_chapter(au_id, n)
        if not add_fact_ops:
            return  # 无记录则不删除（宁可残留也不误删）

        target_ids = [op.target_id for op in add_fact_ops]
        self._fact_repo.delete_by_ids(au_id, target_ids)

    # -----------------------------------------------------------------
    # 步骤 6：last_scene_ending 回滚
    # -----------------------------------------------------------------

    def _rollback_last_scene_ending(self, au_id: str, n: int) -> str:
        """回滚 last_scene_ending。

        N==1: 空字符串。
        否则: 优先从 ops 快照恢复，降级为读取 ch{N-1} 末尾。
        """
        if n == 1:
            return ""

        # 优先：ops 快照
        confirm_op = self._ops_repo.get_confirm_for_chapter(au_id, n - 1)
        if confirm_op and "last_scene_ending_snapshot" in confirm_op.payload:
            snapshot = confirm_op.payload["last_scene_ending_snapshot"]
            if isinstance(snapshot, str):
                return snapshot

        # 降级：读取 ch{N-1} 末尾
        try:
            content = _call(self._chapter_repo.get_content_only(au_id, n - 1))
            return extract_last_scene_ending(content)
        except FileNotFoundError:
            return ""

    # -----------------------------------------------------------------
    # 步骤 7：characters_last_seen 回滚
    # -----------------------------------------------------------------

    def _rollback_characters_last_seen(
        self,
        au_id: str,
        n: int,
        cast_registry: dict[str, Any],
        character_aliases: dict[str, list[str]],
    ) -> dict[str, int]:
        """回滚 characters_last_seen。

        N==1: 空字典。
        否则: 优先从 ops 快照恢复，降级为全量扫描重建。
        """
        if n == 1:
            return {}

        # 优先：ops 快照
        confirm_op = self._ops_repo.get_confirm_for_chapter(au_id, n - 1)
        if confirm_op and "characters_last_seen_snapshot" in confirm_op.payload:
            snapshot = confirm_op.payload["characters_last_seen_snapshot"]
            if isinstance(snapshot, dict):
                try:
                    return {str(k): int(v) for k, v in snapshot.items()}
                except (ValueError, TypeError):
                    pass  # 快照数据损坏，降级到全量扫描

        # 降级：全量扫描重建（快照真空兜底）
        return self._rebuild_characters_last_seen(
            au_id, cast_registry, character_aliases
        )

    def _rebuild_characters_last_seen(
        self,
        au_id: str,
        cast_registry: dict[str, Any],
        character_aliases: dict[str, list[str]],
    ) -> dict[str, int]:
        """全量扫描所有现存章节重建 characters_last_seen。

        撤销是低频高危操作，必须优先保证数据完整性而非速度。
        """
        chapters = _call(self._chapter_repo.list_main(au_id))
        result: dict[str, int] = {}
        for ch in chapters:
            scanned = scan_characters_in_chapter(
                ch.content, cast_registry, character_aliases, ch.chapter_num
            )
            for name, num in scanned.items():
                if num > result.get(name, 0):
                    result[name] = num
        return result

    # -----------------------------------------------------------------
    # 步骤 9：last_confirmed_chapter_focus 回退
    # -----------------------------------------------------------------

    def _rollback_confirmed_focus(self, au_id: str, n: int) -> list[str]:
        """回退 last_confirmed_chapter_focus。

        读取 ch{N-1} 的 frontmatter confirmed_focus。
        N==1 或章节不存在时清空。
        """
        if n <= 1:
            return []
        try:
            prev_ch = _call(self._chapter_repo.get(au_id, n - 1))
            return list(prev_ch.confirmed_focus)
        except FileNotFoundError:
            return []
