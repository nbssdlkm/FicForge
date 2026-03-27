"""Facts 生命周期管理。参见 PRD §3.6、§6.7、§4.3。

四个 Service 方法：add_fact / edit_fact / update_fact_status / set_chapter_focus。
方法是同步的（D-0021），API 层负责 async 包装。
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any, Coroutine, Optional, TypeVar

from core.domain.enums import FactSource, FactStatus, FactType, NarrativeWeight
from core.domain.fact import Fact
from core.domain.ops_entry import OpsEntry
from infra.storage_local.file_utils import now_utc
from repositories.implementations.local_file_fact import generate_fact_id
from repositories.implementations.local_file_ops import generate_op_id
from repositories.interfaces.fact_repository import FactRepository
from repositories.interfaces.ops_repository import OpsRepository
from repositories.interfaces.state_repository import StateRepository

_T = TypeVar("_T")


def _call(coro: Coroutine[Any, Any, _T]) -> _T:
    """Run async-but-actually-sync Repository coroutine synchronously."""
    return asyncio.run(coro)


class FactsLifecycleError(Exception):
    """Facts 生命周期操作错误。"""


# ---------------------------------------------------------------------------
# 别名归一化
# ---------------------------------------------------------------------------

def _normalize_characters(
    characters: list[str],
    character_aliases: dict[str, list[str]],
) -> list[str]:
    """将 characters 数组中的别名映射为主名（§6.7 别名归一化）。"""
    if not character_aliases:
        return characters

    # 建立 别名→主名 映射
    alias_map: dict[str, str] = {}
    for main_name, aliases in character_aliases.items():
        for alias in aliases:
            alias_map[alias] = main_name

    result: list[str] = []
    seen: set[str] = set()
    for name in characters:
        main = alias_map.get(name, name)
        if main not in seen:
            result.append(main)
            seen.add(main)
    return result


# ---------------------------------------------------------------------------
# 悬空 ID 级联清理
# ---------------------------------------------------------------------------

def _clean_dangling_focus(
    au_id: str,
    fact_id: str,
    state_repo: StateRepository,
) -> bool:
    """从 chapter_focus 和 last_confirmed_chapter_focus 中移除指定 fact_id。

    Returns True if fact_id was in chapter_focus (caller should warn user).
    last_confirmed_chapter_focus 中静默移除。
    """
    state = _call(state_repo.get(au_id))
    changed = False
    was_in_focus = False

    if fact_id in state.chapter_focus:
        state.chapter_focus.remove(fact_id)
        was_in_focus = True
        changed = True

    if fact_id in state.last_confirmed_chapter_focus:
        state.last_confirmed_chapter_focus.remove(fact_id)
        changed = True

    if changed:
        _call(state_repo.save(state))

    return was_in_focus


# ---------------------------------------------------------------------------
# resolves 联动
# ---------------------------------------------------------------------------

def _apply_resolves_forward(
    au_id: str,
    resolves_target_id: str,
    fact_repo: FactRepository,
) -> None:
    """正向联动：将被 resolves 指向的旧 fact status 改为 resolved。"""
    target = fact_repo.get(au_id, resolves_target_id)
    if target is not None and target.status != FactStatus.RESOLVED:
        target.status = FactStatus.RESOLVED
        fact_repo.update(au_id, target)


def _apply_resolves_reverse(
    au_id: str,
    old_resolves_target_id: str,
    fact_repo: FactRepository,
) -> None:
    """反向级联：移除 resolves 后检查是否还有其他 fact 仍指向同一目标。

    若无其他 fact 指向 → 恢复为 unresolved。
    若仍有 → 保持 resolved。
    """
    all_facts = fact_repo.list_all(au_id)
    still_resolved = any(
        f.resolves == old_resolves_target_id
        for f in all_facts
    )
    if not still_resolved:
        target = fact_repo.get(au_id, old_resolves_target_id)
        if target is not None and target.status == FactStatus.RESOLVED:
            target.status = FactStatus.UNRESOLVED
            fact_repo.update(au_id, target)


# ===========================================================================
# Service 方法
# ===========================================================================


def add_fact(
    au_path: Path,
    chapter_num: int,
    fact_data: dict[str, Any],
    fact_repo: FactRepository,
    ops_repo: OpsRepository,
    source: str = "manual",
    character_aliases: Optional[dict[str, list[str]]] = None,
) -> Fact:
    """新增 fact。

    Args:
        au_path: AU 根目录。
        chapter_num: 产生该 fact 的章节号（写入 ops chapter_num）。
        fact_data: 字段 dict。
        fact_repo: FactRepository。
        ops_repo: OpsRepository。
        source: "manual" 或 "extract_auto"。
        character_aliases: 别名归一化映射。

    Returns:
        创建的 Fact 对象。
    """
    au_id = str(au_path)
    ts = now_utc()

    # 别名归一化
    characters = fact_data.get("characters") or []
    if character_aliases:
        characters = _normalize_characters(characters, character_aliases)

    fact = Fact(
        id=generate_fact_id(),
        content_raw=fact_data.get("content_raw", ""),
        content_clean=fact_data.get("content_clean", ""),
        characters=characters,
        timeline=fact_data.get("timeline", ""),
        story_time=fact_data.get("story_time", ""),
        chapter=fact_data.get("chapter", chapter_num),
        status=FactStatus(fact_data.get("status", "active")),
        type=FactType(fact_data.get("type", "plot_event")),
        resolves=fact_data.get("resolves"),
        narrative_weight=NarrativeWeight(fact_data.get("narrative_weight", "medium")),
        source=FactSource(source),
        revision=1,
        created_at=ts,
        updated_at=ts,
    )

    fact_repo.append(au_id, fact)

    # resolves 正向联动
    if fact.resolves:
        _apply_resolves_forward(au_id, fact.resolves, fact_repo)

    # ops
    ops_repo.append(
        au_id,
        OpsEntry(
            op_id=generate_op_id(),
            op_type="add_fact",
            target_id=fact.id,
            chapter_num=chapter_num,
            timestamp=ts,
            payload={
                "content_clean": fact.content_clean,
                "status": fact.status.value
                if isinstance(fact.status, FactStatus)
                else str(fact.status),
            },
        ),
    )

    return fact


def edit_fact(
    au_path: Path,
    fact_id: str,
    updated_fields: dict[str, Any],
    fact_repo: FactRepository,
    ops_repo: OpsRepository,
    state_repo: StateRepository,
    character_aliases: Optional[dict[str, list[str]]] = None,
) -> Fact:
    """编辑 fact。

    自动处理 resolves 反向级联 + 悬空 ID 级联清理。
    ops 记录为 edit_fact，无 chapter_num（不参与 undo 级联）。

    Returns:
        更新后的 Fact 对象。

    Raises:
        FactsLifecycleError: fact 不存在。
    """
    au_id = str(au_path)

    fact = fact_repo.get(au_id, fact_id)
    if fact is None:
        raise FactsLifecycleError(f"Fact 不存在: {fact_id}")

    old_resolves = fact.resolves
    old_status = (
        fact.status.value
        if isinstance(fact.status, FactStatus)
        else str(fact.status)
    )

    # 别名归一化
    if "characters" in updated_fields and character_aliases:
        updated_fields["characters"] = _normalize_characters(
            updated_fields["characters"], character_aliases
        )

    # 应用字段更新（枚举字段需要类型转换）
    _enum_fields: dict[str, type] = {
        "status": FactStatus,
        "type": FactType,
        "narrative_weight": NarrativeWeight,
        "source": FactSource,
    }
    for key, value in updated_fields.items():
        if hasattr(fact, key):
            if key in _enum_fields and isinstance(value, str):
                value = _enum_fields[key](value)
            setattr(fact, key, value)

    # update 自动刷新 updated_at + revision+1
    fact_repo.update(au_id, fact)

    # resolves 级联
    new_resolves = fact.resolves
    if old_resolves != new_resolves:
        # 新增关联 → 正向联动
        if new_resolves:
            _apply_resolves_forward(au_id, new_resolves, fact_repo)
        # 移除关联 → 反向级联
        if old_resolves:
            _apply_resolves_reverse(au_id, old_resolves, fact_repo)

    # 悬空 ID 级联清理（status 变更时）
    new_status = (
        fact.status.value
        if isinstance(fact.status, FactStatus)
        else str(fact.status)
    )
    if new_status in ("deprecated", "resolved") and old_status != new_status:
        _clean_dangling_focus(au_id, fact_id, state_repo)

    # ops（无 chapter_num）
    ops_repo.append(
        au_id,
        OpsEntry(
            op_id=generate_op_id(),
            op_type="edit_fact",
            target_id=fact_id,
            timestamp=now_utc(),
            payload={"updated_fields": updated_fields},
        ),
    )

    return fact


def update_fact_status(
    au_path: Path,
    fact_id: str,
    new_status: str,
    chapter_num: int,
    fact_repo: FactRepository,
    ops_repo: OpsRepository,
    state_repo: StateRepository,
) -> dict[str, Any]:
    """更新 fact status。

    自动处理悬空 ID 级联清理。

    Returns:
        结果 dict（fact_id, new_status, focus_warning）。
        focus_warning=True 表示该 fact 在 chapter_focus 中被移除（前端应显示红字警告）。

    Raises:
        FactsLifecycleError: fact 不存在。
    """
    au_id = str(au_path)

    fact = fact_repo.get(au_id, fact_id)
    if fact is None:
        raise FactsLifecycleError(f"Fact 不存在: {fact_id}")

    old_status = (
        fact.status.value
        if isinstance(fact.status, FactStatus)
        else str(fact.status)
    )
    fact.status = FactStatus(new_status)

    # update 自动刷新 updated_at + revision+1
    fact_repo.update(au_id, fact)

    # 悬空 ID 级联清理
    focus_warning = False
    if new_status in ("deprecated", "resolved"):
        focus_warning = _clean_dangling_focus(au_id, fact_id, state_repo)

    # ops（有 chapter_num）
    ops_repo.append(
        au_id,
        OpsEntry(
            op_id=generate_op_id(),
            op_type="update_fact_status",
            target_id=fact_id,
            chapter_num=chapter_num,
            timestamp=now_utc(),
            payload={
                "old_status": old_status,
                "new_status": new_status,
            },
        ),
    )

    return {
        "fact_id": fact_id,
        "new_status": new_status,
        "focus_warning": focus_warning,
    }


def set_chapter_focus(
    au_path: Path,
    focus_ids: list[str],
    fact_repo: FactRepository,
    ops_repo: OpsRepository,
    state_repo: StateRepository,
) -> dict[str, Any]:
    """设置 chapter_focus。

    校验：每个 fact_id 必须存在且 status == unresolved；列表 ≤ 2 个。

    Returns:
        结果 dict（focus_ids）。

    Raises:
        FactsLifecycleError: 校验失败。
    """
    au_id = str(au_path)

    # 校验长度
    if len(focus_ids) > 2:
        raise FactsLifecycleError(
            f"chapter_focus 最多 2 个，收到 {len(focus_ids)} 个"
        )

    # 校验每个 ID
    for fid in focus_ids:
        fact = fact_repo.get(au_id, fid)
        if fact is None:
            raise FactsLifecycleError(f"Fact 不存在: {fid}")
        if fact.status != FactStatus.UNRESOLVED:
            raise FactsLifecycleError(
                f"Fact {fid} 的 status 为 {fact.status.value}，只能选 unresolved"
            )

    # 更新 state
    state = _call(state_repo.get(au_id))
    state.chapter_focus = list(focus_ids)
    # StateRepository.save() 自动 revision+1 + updated_at
    _call(state_repo.save(state))

    # ops
    ops_repo.append(
        au_id,
        OpsEntry(
            op_id=generate_op_id(),
            op_type="set_chapter_focus",
            target_id=au_id,
            chapter_num=state.current_chapter,
            timestamp=now_utc(),
            payload={"focus": list(focus_ids)},
        ),
    )

    return {"focus_ids": list(focus_ids)}
