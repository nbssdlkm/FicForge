# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""重算全局状态。参见 PRD §4.3。

手动触发全量重建 characters_last_seen / last_scene_ending / last_confirmed_chapter_focus。
使用场景：外部工具修改章节文件后一键修复状态。
"""

from __future__ import annotations

import logging
from dataclasses import asdict
from pathlib import Path
from typing import Any

import frontmatter

from core.domain.character_scanner import scan_characters_in_chapter
from core.domain.text_utils import extract_last_scene_ending

logger = logging.getLogger(__name__)


def recalc_state(
    au_path: Path,
    state_repo: Any,
    chapter_repo: Any,
    project_repo: Any,
    fact_repo: Any = None,
) -> dict[str, Any]:
    """重算全局状态，返回重建结果。

    Args:
        au_path: AU 根目录。
        state_repo: StateRepository 实例。
        chapter_repo: ChapterRepository 实例。
        project_repo: ProjectRepository 实例。

    Returns:
        重建结果 dict。
    """
    au_id = str(au_path)

    try:
        state = state_repo.get(au_id)
    except Exception:
        # state.yaml 损坏或缺失时创建默认 state
        from core.domain.state import State
        state = State(au_id=au_id)

    # 读取 cast_registry
    try:
        project = project_repo.get(au_id)
        cast_registry = asdict(project.cast_registry) if project.cast_registry else {"characters": []}
    except Exception:
        cast_registry = {"characters": []}

    # 获取所有已确认章节
    try:
        chapters = chapter_repo.list_main(au_id)
    except Exception:
        chapters = []

    chapters_scanned = 0
    new_characters_last_seen: dict[str, int] = {}
    new_last_scene_ending = ""
    new_last_confirmed_focus: list[str] = []

    if not chapters:
        # current_chapter == 1 或无章节：全部清空
        state.characters_last_seen = {}
        state.last_scene_ending = ""
        state.last_confirmed_chapter_focus = []
        state.chapters_dirty = []
        state.chapter_focus = []
        state_repo.save(state)
        return {
            "characters_last_seen": {},
            "last_scene_ending": "",
            "last_confirmed_chapter_focus": [],
            "chapters_scanned": 0,
            "cleaned_dirty_count": 0,
            "cleaned_focus_count": 0,
        }

    # 按章节号排序
    sorted_chapters = sorted(chapters, key=lambda c: c.chapter_num)

    for ch in sorted_chapters:
        try:
            content = ch.content
            if not content:
                continue
        except Exception:
            continue

        chapters_scanned += 1

        # 扫描角色
        scanned = scan_characters_in_chapter(
            content, cast_registry, chapter_num=ch.chapter_num,
        )
        for char_name, ch_num in scanned.items():
            existing = new_characters_last_seen.get(char_name, 0)
            if ch_num > existing:
                new_characters_last_seen[char_name] = ch_num

    # 最后一章的信息
    last_chapter = sorted_chapters[-1]
    try:
        last_content = last_chapter.content or ""
        new_last_scene_ending = extract_last_scene_ending(last_content)
    except Exception:
        new_last_scene_ending = ""

    # 从最后一章读取 confirmed_focus
    new_last_confirmed_focus = list(getattr(last_chapter, "confirmed_focus", []) or [])

    # 清理 chapters_dirty：移除不存在章节文件的 dirty 标记
    existing_nums = {ch.chapter_num for ch in sorted_chapters}
    old_dirty = list(getattr(state, "chapters_dirty", []) or [])
    new_dirty = [n for n in old_dirty if n in existing_nums]
    cleaned_dirty_count = len(old_dirty) - len(new_dirty)

    # 清理 chapter_focus：移除失效的 fact_id（不存在或已 resolved）
    old_focus = list(getattr(state, "chapter_focus", []) or [])
    cleaned_focus_count = 0
    if old_focus and fact_repo:
        try:
            facts = fact_repo.list_all(au_id)
            valid_focus_ids = {f.id for f in facts if f.status == "unresolved"}
            new_focus = [fid for fid in old_focus if fid in valid_focus_ids]
            cleaned_focus_count = len(old_focus) - len(new_focus)
        except Exception:
            new_focus = old_focus
    else:
        new_focus = old_focus

    # 写回 state
    state.characters_last_seen = new_characters_last_seen
    state.last_scene_ending = new_last_scene_ending
    state.last_confirmed_chapter_focus = new_last_confirmed_focus
    state.chapters_dirty = new_dirty
    state.chapter_focus = new_focus
    state_repo.save(state)

    return {
        "characters_last_seen": new_characters_last_seen,
        "last_scene_ending": new_last_scene_ending,
        "last_confirmed_chapter_focus": new_last_confirmed_focus,
        "chapters_scanned": chapters_scanned,
        "cleaned_dirty_count": cleaned_dirty_count,
        "cleaned_focus_count": cleaned_focus_count,
    }
