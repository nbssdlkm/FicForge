"""确认章节流程。参见 PRD §4.3、§2.6.5 多文件写入顺序契约。

严格遵循 5 步写入顺序：备份 → 章节 → state → ops → 清理草稿。
AU 互斥锁在入口获取（D-0009）。方法是同步的（D-0021）。
"""

from __future__ import annotations

import asyncio
import re
import uuid
from pathlib import Path
from typing import Any, Coroutine, Optional, TypeVar

from core.domain.chapter import Chapter
from core.domain.character_scanner import scan_characters_in_chapter
from core.domain.enums import IndexStatus
from core.domain.generated_with import GeneratedWith
from core.domain.ops_entry import OpsEntry
from core.domain.text_utils import extract_last_scene_ending
from core.services.au_mutex import AUMutexManager
from infra.storage_local.file_utils import compute_content_hash, now_utc
from repositories.implementations.local_file_ops import generate_op_id
from repositories.interfaces.chapter_repository import ChapterRepository
from repositories.interfaces.draft_repository import DraftRepository
from repositories.interfaces.ops_repository import OpsRepository
from repositories.interfaces.state_repository import StateRepository

_T = TypeVar("_T")


def _call(coro: Coroutine[Any, Any, _T]) -> _T:
    """Run async-but-actually-sync Repository coroutine synchronously.

    T-002/T-004 的 ChapterRepository / DraftRepository / StateRepository 仍为 async def，
    但内部仅做同步 I/O。本函数在 run_in_threadpool 线程池上下文中安全调用。
    """
    return asyncio.run(coro)


class ConfirmChapterError(Exception):
    """确认章节流程错误。"""


class ConfirmChapterService:
    """确认章节 Service（PRD §4.3 + §2.6.5）。

    依赖通过构造器注入。方法是同步的（D-0021），API 层负责 async 包装。
    """

    def __init__(
        self,
        chapter_repo: ChapterRepository,
        draft_repo: DraftRepository,
        state_repo: StateRepository,
        ops_repo: OpsRepository,
        au_mutex: AUMutexManager,
    ) -> None:
        self._chapter_repo = chapter_repo
        self._draft_repo = draft_repo
        self._state_repo = state_repo
        self._ops_repo = ops_repo
        self._mutex = au_mutex

    def confirm_chapter(
        self,
        au_path: Path,
        chapter_num: int,
        draft_id: str,
        generated_with: Optional[GeneratedWith] = None,
        cast_registry: Optional[dict[str, Any]] = None,
        character_aliases: Optional[dict[str, list[str]]] = None,
    ) -> dict[str, Any]:
        """确认章节。严格遵循 PRD §2.6.5 多文件写入顺序契约。

        Args:
            au_path: AU 根目录。
            chapter_num: 要确认的章节号（int，D-0014）。
            draft_id: 草稿文件名（如 "ch0038_draft_B.md"）。
            generated_with: 生成统计元数据。provenance 为 ai 时应有值。
            cast_registry: project.yaml 的 cast_registry dict。
            character_aliases: {主名: [别名列表]}。

        Returns:
            确认结果 dict（chapter_id, chapter_num, revision, content_hash, current_chapter）。

        Raises:
            ConfirmChapterError: 前置校验失败或草稿不存在。
        """
        au_id = str(au_path)

        with self._mutex.get_lock(au_id):
            return self._do_confirm(
                au_id,
                chapter_num,
                draft_id,
                generated_with,
                cast_registry or {},
                character_aliases or {},
            )

    def _do_confirm(
        self,
        au_id: str,
        chapter_num: int,
        draft_id: str,
        generated_with: Optional[GeneratedWith],
        cast_registry: dict[str, Any],
        character_aliases: dict[str, list[str]],
    ) -> dict[str, Any]:
        """锁内执行确认流程。"""

        # === 步骤 0：前置校验 ===
        if chapter_num <= 0:
            raise ConfirmChapterError(
                f"chapter_num 必须为正整数，收到 {chapter_num}"
            )

        parsed = _parse_draft_id(draft_id)
        if parsed is None:
            raise ConfirmChapterError(f"无效的 draft_id: {draft_id}")

        draft_chapter_num, draft_variant = parsed
        if draft_chapter_num != chapter_num:
            raise ConfirmChapterError(
                f"draft_id 章节号 {draft_chapter_num} 与请求章节号 {chapter_num} 不匹配"
            )

        try:
            draft = _call(self._draft_repo.get(au_id, chapter_num, draft_variant))
        except FileNotFoundError as exc:
            raise ConfirmChapterError(f"草稿文件不存在: {draft_id}") from exc

        draft_content = draft.content

        # === 步骤 1：备份（如果覆盖已有章节）===
        old_chapter: Optional[Chapter] = None
        if _call(self._chapter_repo.exists(au_id, chapter_num)):
            old_chapter = _call(self._chapter_repo.get(au_id, chapter_num))
            _call(self._chapter_repo.backup_chapter(au_id, chapter_num))

        # === 步骤 2：写入正文章节 ===
        content_hash = compute_content_hash(draft_content)
        timestamp = now_utc()

        chapter_id = old_chapter.chapter_id if old_chapter else str(uuid.uuid4())
        revision = (old_chapter.revision + 1) if old_chapter else 1

        # 读取 state 获取 confirmed_focus（步骤 3 清空之前的值）
        state = _call(self._state_repo.get(au_id))
        confirmed_focus = list(state.chapter_focus)

        chapter = Chapter(
            au_id=au_id,
            chapter_num=chapter_num,
            content=draft_content,
            chapter_id=chapter_id,
            revision=revision,
            confirmed_focus=confirmed_focus,
            confirmed_at=timestamp,
            content_hash=content_hash,
            provenance="ai",
            generated_with=generated_with,
        )
        _call(self._chapter_repo.save(chapter))

        # === 步骤 3：更新 state.yaml ===
        old_current_chapter = state.current_chapter
        is_advancing = chapter_num == old_current_chapter

        # current_chapter：仅推进时 +1（D-0001）
        if is_advancing:
            state.current_chapter = chapter_num + 1

        # last_scene_ending：仅推进时更新
        if is_advancing:
            state.last_scene_ending = extract_last_scene_ending(draft_content)

        # last_confirmed_chapter_focus：保存本章 focus
        state.last_confirmed_chapter_focus = confirmed_focus

        # characters_last_seen：字典合并更新（取 max）
        scanned = scan_characters_in_chapter(
            draft_content, cast_registry, character_aliases, chapter_num
        )
        for char_name, ch_num in scanned.items():
            existing = state.characters_last_seen.get(char_name, 0)
            if ch_num > existing:
                state.characters_last_seen[char_name] = ch_num

        # chapter_focus：清空
        state.chapter_focus = []

        # index_status：标记 stale（步骤 6）
        state.index_status = IndexStatus.STALE

        # save（StateRepository.save 自动更新 revision + updated_at）
        _call(self._state_repo.save(state))

        # === 步骤 4：append ops.jsonl ===
        gw_payload: dict[str, Any] = {}
        if generated_with is not None:
            gw_payload = {
                "mode": generated_with.mode,
                "model": generated_with.model,
                "temperature": generated_with.temperature,
                "top_p": generated_with.top_p,
                "input_tokens": generated_with.input_tokens,
                "output_tokens": generated_with.output_tokens,
                "char_count": generated_with.char_count,
                "duration_ms": generated_with.duration_ms,
            }

        ops_entry = OpsEntry(
            op_id=generate_op_id(),
            op_type="confirm_chapter",
            target_id=chapter_id,
            chapter_num=chapter_num,
            timestamp=timestamp,
            payload={
                "focus": confirmed_focus,
                "characters_last_seen_snapshot": dict(state.characters_last_seen),
                "last_scene_ending_snapshot": state.last_scene_ending,
                "generated_with": gw_payload,
            },
        )
        self._ops_repo.append(au_id, ops_entry)

        # === 步骤 5：清理草稿 ===
        _call(self._draft_repo.delete_by_chapter(au_id, chapter_num))

        return {
            "chapter_id": chapter_id,
            "chapter_num": chapter_num,
            "revision": revision,
            "content_hash": content_hash,
            "current_chapter": state.current_chapter,
        }


def _parse_draft_id(draft_id: str) -> tuple[int, str] | None:
    """解析草稿文件名 → (chapter_num, variant)。"""
    m = re.match(r"^ch(\d{4,})_draft_(\w+)\.md$", draft_id)
    if m:
        return int(m.group(1)), m.group(2)
    return None
