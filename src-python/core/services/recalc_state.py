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

    state = state_repo.get(au_id)

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
        state_repo.save(state)
        return {
            "characters_last_seen": {},
            "last_scene_ending": "",
            "last_confirmed_chapter_focus": [],
            "chapters_scanned": 0,
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

    # 写回 state
    state.characters_last_seen = new_characters_last_seen
    state.last_scene_ending = new_last_scene_ending
    state.last_confirmed_chapter_focus = new_last_confirmed_focus
    state_repo.save(state)

    return {
        "characters_last_seen": new_characters_last_seen,
        "last_scene_ending": new_last_scene_ending,
        "last_confirmed_chapter_focus": new_last_confirmed_focus,
        "chapters_scanned": chapters_scanned,
    }
