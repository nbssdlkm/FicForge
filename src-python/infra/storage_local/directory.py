"""AU 目录结构创建。参见 PRD §3.1。"""

from __future__ import annotations

from pathlib import Path


def ensure_au_directories(au_path: Path) -> None:
    """创建 PRD §3.1 定义的完整 AU 目录结构。

    新建 AU 时调用。已存在的目录不会被覆盖。
    """
    dirs = [
        au_path / "chapters" / "main",
        au_path / "chapters" / "backups",
        au_path / "chapters" / ".drafts",
        au_path / "chapters" / "branches",
        au_path / "chapters" / "snapshots",
        au_path / "characters",
        au_path / "oc",
        au_path / "worldbuilding",
        au_path / "imports",
    ]
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)
