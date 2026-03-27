"""Dirty 章节解除流程。参见 PRD §4.3。

最新章 vs 历史章分流：两者的 state 更新范围完全不同。
AU 互斥锁在入口获取（D-0009）。方法是同步的（D-0021）。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

from core.domain.character_scanner import scan_characters_in_chapter
from core.domain.enums import IndexStatus
from core.domain.fact_change import FactChange
from core.domain.ops_entry import OpsEntry
from core.domain.text_utils import extract_last_scene_ending
from core.services.au_mutex import AUMutexManager
from core.services.facts_lifecycle import edit_fact as _edit_fact
from core.services.facts_lifecycle import update_fact_status as _update_fact_status
from infra.storage_local.file_utils import compute_content_hash, now_utc
from repositories.implementations.local_file_ops import generate_op_id
from repositories.interfaces.chapter_repository import ChapterRepository
from repositories.interfaces.fact_repository import FactRepository
from repositories.interfaces.ops_repository import OpsRepository
from repositories.interfaces.state_repository import StateRepository


class DirtyResolveError(Exception):
    """Dirty 章节解除流程错误。"""


class ResolveDirtyChapterService:
    """Dirty 章节解除 Service（PRD §4.3）。

    依赖通过构造器注入。方法是同步的（D-0021），API 层负责 async 包装。
    """

    def __init__(
        self,
        chapter_repo: ChapterRepository,
        state_repo: StateRepository,
        ops_repo: OpsRepository,
        fact_repo: FactRepository,
        au_mutex: AUMutexManager,
    ) -> None:
        self._chapter_repo = chapter_repo
        self._state_repo = state_repo
        self._ops_repo = ops_repo
        self._fact_repo = fact_repo
        self._mutex = au_mutex

    def resolve_dirty_chapter(
        self,
        au_path: Path,
        chapter_num: int,
        confirmed_fact_changes: list[FactChange],
        cast_registry: Optional[dict[str, Any]] = None,
        character_aliases: Optional[dict[str, list[str]]] = None,
    ) -> dict[str, Any]:
        """解除 dirty 章节。

        Args:
            au_path: AU 根目录。
            chapter_num: 要解除 dirty 的章节号。
            confirmed_fact_changes: 用户在 facts 确认面板的操作结果（可为空列表）。
            cast_registry: project.yaml 的 cast_registry（最新章重算时需要）。
            character_aliases: {主名: [别名列表]}。

        Returns:
            结果 dict（chapter_num, is_latest, content_hash）。

        Raises:
            DirtyResolveError: 前置校验失败。
        """
        au_id = str(au_path)

        with self._mutex.get_lock(au_id):
            return self._do_resolve(
                au_id,
                chapter_num,
                confirmed_fact_changes,
                cast_registry or {},
                character_aliases or {},
            )

    def _do_resolve(
        self,
        au_id: str,
        chapter_num: int,
        confirmed_fact_changes: list[FactChange],
        cast_registry: dict[str, Any],
        character_aliases: dict[str, list[str]],
    ) -> dict[str, Any]:
        """锁内执行 dirty resolve 流程。"""

        # =================================================================
        # 步骤 1：前置校验
        # =================================================================
        state = self._state_repo.get(au_id)

        if chapter_num not in state.chapters_dirty:
            raise DirtyResolveError(
                f"章节 {chapter_num} 不在 chapters_dirty 列表中"
            )

        if not self._chapter_repo.exists(au_id, chapter_num):
            raise DirtyResolveError(
                f"章节 {chapter_num} 文件不存在"
            )

        # =================================================================
        # 步骤 2：执行 facts 变更
        # =================================================================
        timestamp = now_utc()
        self._apply_fact_changes(au_id, chapter_num, confirmed_fact_changes, timestamp)

        # 重新读取 state——fact 级联操作（悬空清理等）可能已修改并保存了 state
        state = self._state_repo.get(au_id)

        # =================================================================
        # 步骤 3：最新章 / 历史章分流
        # =================================================================
        is_latest = chapter_num == state.current_chapter - 1

        if is_latest:
            # 最新章：重算 characters_last_seen + last_scene_ending
            state.characters_last_seen = self._recalc_characters_latest(
                au_id, chapter_num, cast_registry, character_aliases
            )
            content = self._chapter_repo.get_content_only(au_id, chapter_num)
            state.last_scene_ending = extract_last_scene_ending(content)
        else:
            # 历史章：不覆盖全局 characters_last_seen，不重算 last_scene_ending
            # 只重建 ChromaDB chunks（Phase 1 标记 stale）
            content = self._chapter_repo.get_content_only(au_id, chapter_num)

        # =================================================================
        # 步骤 4：重算 content_hash（D-0011）
        # =================================================================
        new_hash = compute_content_hash(content)
        chapter = self._chapter_repo.get(au_id, chapter_num)
        chapter.content_hash = new_hash
        chapter.revision += 1  # 写路径契约：每次写操作必须同时 bump revision
        chapter.confirmed_at = now_utc()
        self._chapter_repo.save(chapter)

        # =================================================================
        # 步骤 5：更新 state.yaml
        # =================================================================
        state.chapters_dirty.remove(chapter_num)
        state.index_status = IndexStatus.STALE
        # StateRepository.save() 自动 revision+1 + updated_at
        self._state_repo.save(state)

        # =================================================================
        # 步骤 6：append ops.jsonl
        # =================================================================
        ops_entry = OpsEntry(
            op_id=generate_op_id(),
            op_type="resolve_dirty_chapter",
            target_id=chapter.chapter_id,
            chapter_num=chapter_num,
            timestamp=timestamp,
            payload={},
        )
        self._ops_repo.append(au_id, ops_entry)

        # =================================================================
        # 步骤 7：ChromaDB 重建（Phase 1 简化：标记 stale）
        # =================================================================
        # TODO: T-017 queue.enqueue(rebuild_chapter_chunks, chapter_num)

        return {
            "chapter_num": chapter_num,
            "is_latest": is_latest,
            "content_hash": new_hash,
        }

    # -----------------------------------------------------------------
    # 步骤 2：facts 变更
    # -----------------------------------------------------------------

    def _apply_fact_changes(
        self,
        au_id: str,
        chapter_num: int,
        changes: list[FactChange],
        timestamp: str,  # noqa: ARG002 — kept for interface compat
    ) -> None:
        """执行用户在 facts 确认面板上的操作。

        复用 facts_lifecycle 的级联逻辑（resolves 联动 + 悬空 focus 清理），
        而不是直接调用 repository 绕过级联。
        """
        au_path = Path(au_id)
        for change in changes:
            if change.action == "keep":
                continue

            if change.action == "update" and change.updated_fields:
                # 复用 edit_fact：自动处理 resolves 联动 + 悬空清理 + ops 记录
                _edit_fact(
                    au_path,
                    change.fact_id,
                    change.updated_fields,
                    self._fact_repo,
                    self._ops_repo,
                    self._state_repo,
                )

            elif change.action == "deprecate":
                # 复用 update_fact_status：自动处理悬空清理 + ops 记录
                _update_fact_status(
                    au_path,
                    change.fact_id,
                    "deprecated",
                    chapter_num,
                    self._fact_repo,
                    self._ops_repo,
                    self._state_repo,
                )

    # -----------------------------------------------------------------
    # 步骤 3：最新章 characters_last_seen 重算
    # -----------------------------------------------------------------

    def _recalc_characters_latest(
        self,
        au_id: str,
        chapter_num: int,
        cast_registry: dict[str, Any],
        character_aliases: dict[str, list[str]],
    ) -> dict[str, int]:
        """重算最新章的 characters_last_seen。

        优先从 ops 快照获取 N-1 基线，降级为扫描 N-3 到 N-1 章。
        然后扫描第 N 章，与基线合并（取 max）。
        """
        n = chapter_num

        # 获取基线
        baseline = self._get_baseline(au_id, n, cast_registry, character_aliases)

        # 扫描第 N 章
        content = self._chapter_repo.get_content_only(au_id, n)
        scanned = scan_characters_in_chapter(
            content, cast_registry, character_aliases, n
        )

        # 合并（取 max）
        for name, ch_num in scanned.items():
            if ch_num > baseline.get(name, 0):
                baseline[name] = ch_num

        return baseline

    def _get_baseline(
        self,
        au_id: str,
        n: int,
        cast_registry: dict[str, Any],
        character_aliases: dict[str, list[str]],
    ) -> dict[str, int]:
        """获取 characters_last_seen 基线。

        优先从 ops 读取 N-1 的 confirm_chapter 快照。
        快照真空兜底：扫描 N-3 到 N-1 章（不足 3 章则扫描全部现存章）。
        """
        if n <= 1:
            return {}

        # 优先：ops 快照
        confirm_op = self._ops_repo.get_confirm_for_chapter(au_id, n - 1)
        if confirm_op and "characters_last_seen_snapshot" in confirm_op.payload:
            snapshot = confirm_op.payload["characters_last_seen_snapshot"]
            if isinstance(snapshot, dict):
                try:
                    return {str(k): int(v) for k, v in snapshot.items()}
                except (ValueError, TypeError):
                    pass  # 快照数据损坏，降级到扫描

        # 降级：扫描 N-3 到 N-1 章（PRD §4.3 dirty resolve 专用逻辑）
        return self._scan_recent_chapters(
            au_id, n, cast_registry, character_aliases
        )

    def _scan_recent_chapters(
        self,
        au_id: str,
        n: int,
        cast_registry: dict[str, Any],
        character_aliases: dict[str, list[str]],
    ) -> dict[str, int]:
        """扫描 N-3 到 N-1 章重算基线。不足 3 章则扫描全部现存章。

        注意：这与 undo 的全量扫描不同——dirty resolve 只扫最近 3 章。
        """
        all_chapters = self._chapter_repo.list_main(au_id)

        # 确定扫描范围：N-3 到 N-1（不含 N 本身）
        start = max(1, n - 3)
        target_chapters = [
            ch for ch in all_chapters
            if start <= ch.chapter_num <= n - 1
        ]

        # 不足 3 章则扫描全部（不含 N 本身）
        if len(target_chapters) < 3:
            target_chapters = [
                ch for ch in all_chapters if ch.chapter_num < n
            ]

        result: dict[str, int] = {}
        for ch in target_chapters:
            scanned = scan_characters_in_chapter(
                ch.content, cast_registry, character_aliases, ch.chapter_num
            )
            for name, ch_num in scanned.items():
                if ch_num > result.get(name, 0):
                    result[name] = ch_num

        return result
