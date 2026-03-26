"""章节角色扫描。参见 PRD §2.6.5 scan_characters_in_chapter。

Phase 1 简化：只实现 ①②③ 三档匹配（cast_registry 角色名 + aliases）。
不实现第 ④ 档高频专名识别（Import 专用）。
"""

from __future__ import annotations

from typing import Any


def scan_characters_in_chapter(
    chapter_text: str,
    cast_registry: dict[str, Any],
    character_aliases: dict[str, list[str]] | None = None,
    chapter_num: int = 0,
) -> dict[str, int]:
    """扫描章节正文中出场的角色。

    扫描源优先级（Phase 1 只走前 3 档）：
      ① cast_registry 角色名 + 各角色 aliases 别名
      ② core_characters 文件名（已包含在 cast_registry.from_core）
      ③ oc 文件名（已包含在 cast_registry.oc）

    别名匹配时强制映射为主名（PRD §2.6.5）。

    Args:
        chapter_text: 纯正文（已剥离 frontmatter）。
        cast_registry: project.yaml 的 cast_registry dict
            (keys: from_core, au_specific, oc)。
        character_aliases: {主名: [别名1, 别名2, ...]}。
            Phase 1 简化为从调用方传入，不从设定文件读取。
        chapter_num: 当前章节号，写入返回字典的值。

    Returns:
        {角色主名: chapter_num} 字典。调用方负责与 characters_last_seen 做 max 合并。
    """
    if not chapter_text.strip():
        return {}

    # ① 收集 cast_registry 中所有角色名
    all_names: set[str] = set()
    for group in ("from_core", "au_specific", "oc"):
        names = cast_registry.get(group)
        if isinstance(names, list):
            all_names.update(names)

    # 建立 搜索名 → 主名 映射
    search_map: dict[str, str] = {}
    for name in all_names:
        search_map[name] = name

    # ① aliases 映射
    if character_aliases:
        for main_name, aliases in character_aliases.items():
            for alias in aliases:
                search_map[alias] = main_name

    # 按名字长度降序排列（长名优先匹配，防止短名误匹配子串）
    sorted_names = sorted(search_map.keys(), key=len, reverse=True)

    # 在正文中搜索
    result: dict[str, int] = {}
    for name in sorted_names:
        main_name = search_map[name]
        if main_name in result:
            continue  # 已通过更优先的名字匹配过
        # 使用正则确保匹配完整词（中文不需要词边界，直接查找子串）
        if name in chapter_text:
            result[main_name] = chapter_num

    return result
