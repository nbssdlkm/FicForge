"""导出功能。参见 PRD §6.8。

支持 txt/md 两种格式，frontmatter 剥离使用 frontmatter.loads()（§5.2）。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional

import frontmatter as fm


def export_chapters(
    au_path: Path,
    chapter_repo: Any,
    start_chapter: int = 1,
    end_chapter: Optional[int] = None,
    format: str = "txt",
    include_title: bool = True,
    include_chapter_num: bool = True,
) -> str:
    """导出指定范围章节，返回合并后的文本。

    步骤：
    1. 读取指定范围的章节
    2. 用 frontmatter.loads() 剥离 YAML frontmatter
    3. 按格式拼接
    """
    au_id = str(au_path)
    all_chapters = chapter_repo.list_main(au_id)

    # 过滤范围
    filtered = [
        ch for ch in all_chapters
        if ch.chapter_num >= start_chapter
        and (end_chapter is None or ch.chapter_num <= end_chapter)
    ]

    # 按章节号排序
    filtered.sort(key=lambda ch: ch.chapter_num)

    if not filtered:
        return ""

    parts: list[str] = []

    for ch in filtered:
        # 读取原始文件内容并剥离 frontmatter（§5.2）
        ch_path = Path(au_id) / "chapters" / "main" / f"ch{ch.chapter_num:04d}.md"
        if ch_path.exists():
            raw = ch_path.read_text(encoding="utf-8")
            post = fm.loads(raw)
            content = post.content
        else:
            # fallback: 使用 chapter 对象的 content
            content = ch.content

        # 构建章节块
        section_parts: list[str] = []

        if include_title or include_chapter_num:
            title_line = _build_title_line(
                ch.chapter_num,
                format=format,
                include_title=include_title,
                include_chapter_num=include_chapter_num,
            )
            if title_line:
                section_parts.append(title_line)

        section_parts.append(content.strip())
        parts.append("\n".join(section_parts))

    # 拼接
    if format == "md":
        return "\n\n".join(parts) + "\n"
    else:
        # txt: 空行分隔
        return "\n\n".join(parts) + "\n"


def _build_title_line(
    chapter_num: int,
    format: str = "txt",
    include_title: bool = True,
    include_chapter_num: bool = True,
) -> str:
    """构建标题行。"""
    if not include_title and not include_chapter_num:
        return ""

    title = f"第{chapter_num}章"

    if format == "md":
        return f"## {title}"
    else:
        return title
