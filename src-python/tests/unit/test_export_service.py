"""导出功能单元测试。"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import frontmatter as fm
import pytest

from core.services.export_service import export_chapters


# ===================================================================
# Helpers
# ===================================================================

@dataclass
class FakeChapter:
    au_id: str
    chapter_num: int
    content: str
    chapter_id: str = ""
    revision: int = 1
    confirmed_focus: list[str] | None = None
    confirmed_at: str = ""
    content_hash: str = ""
    provenance: str = "imported"
    generated_with: Any = None

    def __post_init__(self) -> None:
        if self.confirmed_focus is None:
            self.confirmed_focus = []


class FakeChapterRepo:
    """Fake chapter repository that also writes real files."""

    def __init__(self, au_path: Path) -> None:
        self.au_path = au_path
        self.chapters: list[FakeChapter] = []

    def add(self, chapter_num: int, content: str, title: str = "") -> None:
        au_id = str(self.au_path)
        ch = FakeChapter(au_id=au_id, chapter_num=chapter_num, content=content)
        self.chapters.append(ch)

        # Write real file with frontmatter
        ch_dir = self.au_path / "chapters" / "main"
        ch_dir.mkdir(parents=True, exist_ok=True)
        post = fm.Post(content, chapter_id=f"ch_{chapter_num}", revision=1, provenance="imported")
        ch_path = ch_dir / f"ch{chapter_num:04d}.md"
        ch_path.write_text(fm.dumps(post), encoding="utf-8")

    def list_main(self, au_id: str) -> list[FakeChapter]:
        return sorted(self.chapters, key=lambda c: c.chapter_num)


# ===================================================================
# 导出测试
# ===================================================================

class TestExportChapters:

    def test_export_three_chapters_txt(self, tmp_path: Path):
        """3 章导出 txt → 正确拼接，无 frontmatter。"""
        au_path = tmp_path / "test_au"
        repo = FakeChapterRepo(au_path)
        repo.add(1, "第一章的内容。")
        repo.add(2, "第二章的内容。")
        repo.add(3, "第三章的内容。")

        result = export_chapters(au_path, repo, format="txt")

        assert "第一章的内容。" in result
        assert "第二章的内容。" in result
        assert "第三章的内容。" in result
        # 不包含 frontmatter
        assert "---" not in result
        assert "chapter_id" not in result

    def test_export_range(self, tmp_path: Path):
        """指定范围导出（2-3 章）→ 只包含 2、3 章。"""
        au_path = tmp_path / "test_au"
        repo = FakeChapterRepo(au_path)
        repo.add(1, "第一章内容。")
        repo.add(2, "第二章内容。")
        repo.add(3, "第三章内容。")

        result = export_chapters(au_path, repo, start_chapter=2, end_chapter=3)

        assert "第一章内容" not in result
        assert "第二章内容" in result
        assert "第三章内容" in result

    def test_export_no_title(self, tmp_path: Path):
        """include_title=False → 无标题行。"""
        au_path = tmp_path / "test_au"
        repo = FakeChapterRepo(au_path)
        repo.add(1, "内容一。")
        repo.add(2, "内容二。")

        result = export_chapters(
            au_path, repo,
            include_title=False,
            include_chapter_num=False,
        )

        assert "第" not in result
        assert "内容一" in result
        assert "内容二" in result

    def test_export_md_format(self, tmp_path: Path):
        """md 格式导出 → 标题用 ## 标记。"""
        au_path = tmp_path / "test_au"
        repo = FakeChapterRepo(au_path)
        repo.add(1, "内容。")

        result = export_chapters(au_path, repo, format="md")

        assert "## 第1章" in result
        assert "内容。" in result

    def test_export_empty(self, tmp_path: Path):
        """无章节 → 返回空字符串。"""
        au_path = tmp_path / "test_au"
        repo = FakeChapterRepo(au_path)

        result = export_chapters(au_path, repo)

        assert result == ""

    def test_export_single_chapter(self, tmp_path: Path):
        """单章导出。"""
        au_path = tmp_path / "test_au"
        repo = FakeChapterRepo(au_path)
        repo.add(1, "唯一的一章。")

        result = export_chapters(au_path, repo, start_chapter=1, end_chapter=1)

        assert "唯一的一章" in result

    def test_export_frontmatter_stripped(self, tmp_path: Path):
        """确保 frontmatter 被正确剥离。"""
        au_path = tmp_path / "test_au"
        repo = FakeChapterRepo(au_path)

        # 写入带有丰富 frontmatter 的文件
        ch_dir = au_path / "chapters" / "main"
        ch_dir.mkdir(parents=True, exist_ok=True)
        post = fm.Post(
            "正文内容不含 YAML",
            chapter_id="ch_abc",
            revision=3,
            provenance="imported",
            content_hash="deadbeef",
        )
        (ch_dir / "ch0001.md").write_text(fm.dumps(post), encoding="utf-8")
        repo.chapters.append(FakeChapter(au_id=str(au_path), chapter_num=1, content="正文内容不含 YAML"))

        result = export_chapters(au_path, repo, format="txt")

        assert "正文内容不含 YAML" in result
        assert "chapter_id" not in result
        assert "deadbeef" not in result

    def test_export_out_of_range(self, tmp_path: Path):
        """请求超出范围 → 返回空。"""
        au_path = tmp_path / "test_au"
        repo = FakeChapterRepo(au_path)
        repo.add(1, "内容。")

        result = export_chapters(au_path, repo, start_chapter=5, end_chapter=10)

        assert result == ""
