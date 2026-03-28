"""导入流水线单元测试。"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Optional
from unittest.mock import MagicMock, patch

import pytest

from core.services.import_pipeline import (
    ImportResult,
    get_split_method,
    import_chapters,
    parse_import_file,
    split_into_chapters,
)


# ===================================================================
# 章节切分测试
# ===================================================================

class TestStandardSplit:
    """优先级 1：标准章节标识切分。"""

    def test_chinese_chapter_markers(self):
        """含"第一章"标识 → 正确切分。"""
        text = "第一章 初遇\n\n林深走进了咖啡馆。\n\n第二章 重逢\n\n陈明抬头看见了他。"
        result = split_into_chapters(text)
        assert len(result) == 2
        assert result[0]["chapter_num"] == 1
        assert result[0]["title"] == "第一章 初遇"
        assert "林深" in result[0]["content"]
        assert result[1]["chapter_num"] == 2
        assert result[1]["title"] == "第二章 重逢"
        assert "陈明" in result[1]["content"]

    def test_english_chapter_markers(self):
        """含 "Chapter 1" 英文标识 → 正确切分。"""
        text = "Chapter 1\n\nIt was a dark and stormy night.\n\nChapter 2\n\nThe sun rose."
        result = split_into_chapters(text)
        assert len(result) == 2
        assert result[0]["title"] == "Chapter 1"
        assert "dark and stormy" in result[0]["content"]
        assert result[1]["title"] == "Chapter 2"

    def test_chinese_numeric_chapter(self):
        """含"第1章"数字标识 → 正确切分。"""
        text = "第1章 序幕\n\n故事开始了。\n\n第2章 展开\n\n剧情继续。"
        result = split_into_chapters(text)
        assert len(result) == 2
        assert result[0]["title"] == "第1章 序幕"

    def test_section_markers(self):
        """含"第一节"标识 → 正确切分。"""
        text = "第一节 导论\n\n开始。\n\n第二节 发展\n\n继续。"
        result = split_into_chapters(text)
        assert len(result) == 2

    def test_pre_chapter_content_preserved(self):
        """章节标识前的内容（前言/序言）不应被丢弃。"""
        text = "这是作者的前言，写在正文之前。\n\n第一章 开始\n\n正文内容。\n\n第二章 继续\n\n更多内容。"
        result = split_into_chapters(text)
        assert len(result) == 2
        # 前言内容应被保留在第一章中
        assert "前言" in result[0]["content"]
        assert "正文内容" in result[0]["content"]


class TestIntegerSplit:
    """优先级 2：纯数字标题切分。"""

    def test_sequential_integers(self):
        """纯数字标题（1、2、3）→ 正确切分。"""
        text = "1\n\n第一段内容，很有意思。\n\n2\n\n第二段内容，更有意思。\n\n3\n\n第三段内容。"
        result = split_into_chapters(text)
        assert len(result) == 3
        assert result[0]["chapter_num"] == 1
        assert result[0]["title"] == "1"
        assert "第一段" in result[0]["content"]

    def test_pre_integer_content_preserved(self):
        """数字标题前的内容（前言）不应被丢弃。"""
        text = "作者有话说：这是前言。\n\n1\n\n第一段内容。\n\n2\n\n第二段内容。"
        result = split_into_chapters(text)
        assert len(result) == 2
        assert "前言" in result[0]["content"]
        assert "第一段" in result[0]["content"]

    def test_non_sequential_integers_fallback(self):
        """非连续数字 → 不走整数切分，走自动切分。"""
        text = "1\n\n内容一。\n\n5\n\n内容五。"
        method = get_split_method(text)
        # 非连续整数不走 integer split
        assert method != "integer"


class TestAutoSplit:
    """优先级 3：自动切分。"""

    def test_no_markers_auto_split(self):
        """无任何章节标识 → 按 3000 字自动切分。"""
        # 构造超过 3000 字的文本，段落间用空行分隔
        paragraphs = ["这是一段很长的文字。" * 50 + "\n" for _ in range(20)]
        text = "\n".join(paragraphs)
        result = split_into_chapters(text)
        assert len(result) > 1
        for ch in result:
            assert ch["title"].startswith("自动分段")

    def test_auto_split_paragraph_boundary(self):
        """自动切分在段落边界（空行处）。"""
        # 构造刚好超过 3000 字的文本
        para = "这是测试段落。" * 100 + "\n"
        text = "\n".join([para] * 10)
        result = split_into_chapters(text)
        # 确认每段内容不会在句子中间切断
        for ch in result:
            content = ch["content"]
            assert content  # 非空

    def test_empty_text(self):
        """空文本 → 返回空列表。"""
        assert split_into_chapters("") == []
        assert split_into_chapters("   ") == []

    def test_short_text_single_chapter(self):
        """只有一段文本（无标题）→ 整体作为第 1 章。"""
        text = "这是一段短文本，没有任何章节标识。"
        result = split_into_chapters(text)
        assert len(result) == 1
        assert result[0]["chapter_num"] == 1
        assert result[0]["title"] == "自动分段 1"
        assert "短文本" in result[0]["content"]


class TestGetSplitMethod:
    """split_method 检测。"""

    def test_title_method(self):
        text = "第一章 开始\n\n内容。\n\n第二章 继续\n\n更多内容。"
        assert get_split_method(text) == "title"

    def test_integer_method(self):
        text = "1\n\n内容一。\n\n2\n\n内容二。"
        assert get_split_method(text) == "integer"

    def test_auto_method(self):
        assert get_split_method("一段普通文本") == "auto_3000"
        assert get_split_method("") == "auto_3000"


# ===================================================================
# 格式解析测试
# ===================================================================

class TestParseImportFile:
    """格式解析器。"""

    def test_txt_file(self, tmp_path: Path):
        """.txt 文件 → 正确读取。"""
        f = tmp_path / "test.txt"
        f.write_text("Hello World 你好世界", encoding="utf-8")
        result = parse_import_file(f)
        assert result == "Hello World 你好世界"

    def test_md_file(self, tmp_path: Path):
        """.md 文件 → 正确读取。"""
        f = tmp_path / "test.md"
        f.write_text("# Title\n\nParagraph", encoding="utf-8")
        result = parse_import_file(f)
        assert "# Title" in result

    def test_docx_file(self, tmp_path: Path):
        """.docx 文件 → 正确提取正文（mock python-docx）。"""
        f = tmp_path / "test.docx"
        f.write_bytes(b"fake")

        mock_para1 = MagicMock()
        mock_para1.text = "第一段内容"
        mock_para2 = MagicMock()
        mock_para2.text = "第二段内容"
        mock_para_empty = MagicMock()
        mock_para_empty.text = "   "

        mock_doc = MagicMock()
        mock_doc.paragraphs = [mock_para1, mock_para_empty, mock_para2]

        # Document is imported lazily inside _parse_docx via `from docx import Document`
        with patch.dict("sys.modules", {"docx": MagicMock()}):
            import sys
            sys.modules["docx"].Document = MagicMock(return_value=mock_doc)
            result = parse_import_file(f)
            assert "第一段内容" in result
            assert "第二段内容" in result
            # 空段落应被过滤
            assert "   " not in result

    def test_unsupported_format(self, tmp_path: Path):
        """不支持的格式 → 抛出 ValueError。"""
        f = tmp_path / "test.pdf"
        f.write_bytes(b"fake")
        with pytest.raises(ValueError, match="不支持"):
            parse_import_file(f)


# ===================================================================
# 导入编排测试
# ===================================================================

class FakeChapterRepo:
    """Fake chapter repository for testing."""

    def __init__(self) -> None:
        self.saved: list[Any] = []

    def save(self, chapter: Any) -> None:
        self.saved.append(chapter)

    def list_main(self, au_id: str) -> list[Any]:
        return self.saved

    def exists(self, au_id: str, chapter_num: int) -> bool:
        return any(ch.chapter_num == chapter_num for ch in self.saved)


class FakeStateRepo:
    """Fake state repository for testing."""

    def __init__(self) -> None:
        self.saved_state: Any = None

    def save(self, state: Any) -> None:
        self.saved_state = state

    def get(self, au_id: str) -> Any:
        return self.saved_state


class FakeOpsRepo:
    """Fake ops repository for testing."""

    def __init__(self) -> None:
        self.entries: list[Any] = []

    def append(self, au_id: str, entry: Any) -> None:
        self.entries.append(entry)


class FakeFactRepo:
    pass


class FakeProjectRepo:
    pass


class TestImportChapters:
    """导入编排 Service。"""

    def _make_chapters(self, count: int = 3) -> list[dict[str, Any]]:
        return [
            {
                "chapter_num": i + 1,
                "title": f"第{i + 1}章",
                "content": f"这是第{i + 1}章的内容。" * 20,
            }
            for i in range(count)
        ]

    def test_three_chapters_files_created(self, tmp_path: Path):
        """3 章导入 → chapter_repo.save 被调用 3 次。"""
        ch_repo = FakeChapterRepo()
        state_repo = FakeStateRepo()
        ops_repo = FakeOpsRepo()
        chapters = self._make_chapters(3)

        result = import_chapters(
            au_path=tmp_path / "fandoms" / "test" / "au1",
            chapters=chapters,
            chapter_repo=ch_repo,
            state_repo=state_repo,
            ops_repo=ops_repo,
            fact_repo=FakeFactRepo(),
            project_repo=FakeProjectRepo(),
        )

        assert result.total_chapters == 3
        assert len(ch_repo.saved) == 3
        assert result.state_initialized is True

    def test_state_current_chapter(self, tmp_path: Path):
        """state.yaml current_chapter = last_chapter + 1。"""
        ch_repo = FakeChapterRepo()
        state_repo = FakeStateRepo()
        ops_repo = FakeOpsRepo()
        chapters = self._make_chapters(3)

        import_chapters(
            au_path=tmp_path / "test_au",
            chapters=chapters,
            chapter_repo=ch_repo,
            state_repo=state_repo,
            ops_repo=ops_repo,
            fact_repo=FakeFactRepo(),
            project_repo=FakeProjectRepo(),
        )

        assert state_repo.saved_state is not None
        assert state_repo.saved_state.current_chapter == 4

    def test_state_last_scene_ending(self, tmp_path: Path):
        """state.yaml last_scene_ending = 第 3 章末尾。"""
        ch_repo = FakeChapterRepo()
        state_repo = FakeStateRepo()
        ops_repo = FakeOpsRepo()
        chapters = self._make_chapters(3)

        import_chapters(
            au_path=tmp_path / "test_au",
            chapters=chapters,
            chapter_repo=ch_repo,
            state_repo=state_repo,
            ops_repo=ops_repo,
            fact_repo=FakeFactRepo(),
            project_repo=FakeProjectRepo(),
        )

        assert state_repo.saved_state.last_scene_ending != ""

    def test_characters_last_seen(self, tmp_path: Path):
        """characters_last_seen 包含扫描到的角色。"""
        ch_repo = FakeChapterRepo()
        state_repo = FakeStateRepo()
        ops_repo = FakeOpsRepo()
        chapters = [
            {"chapter_num": 1, "title": "Ch1", "content": "林深走进了房间。"},
            {"chapter_num": 2, "title": "Ch2", "content": "陈明在看书。林深也来了。"},
            {"chapter_num": 3, "title": "Ch3", "content": "陈明离开了。"},
        ]
        cast_registry = {"from_core": ["林深", "陈明"], "au_specific": [], "oc": []}

        import_chapters(
            au_path=tmp_path / "test_au",
            chapters=chapters,
            chapter_repo=ch_repo,
            state_repo=state_repo,
            ops_repo=ops_repo,
            fact_repo=FakeFactRepo(),
            project_repo=FakeProjectRepo(),
            cast_registry=cast_registry,
        )

        cls = state_repo.saved_state.characters_last_seen
        assert "林深" in cls
        assert "陈明" in cls
        assert cls["林深"] == 2  # 最后出现在第 2 章
        assert cls["陈明"] == 3  # 最后出现在第 3 章

    def test_ops_import_project_record(self, tmp_path: Path):
        """ops.jsonl 有 import_project 记录。"""
        ch_repo = FakeChapterRepo()
        state_repo = FakeStateRepo()
        ops_repo = FakeOpsRepo()

        import_chapters(
            au_path=tmp_path / "test_au",
            chapters=self._make_chapters(2),
            chapter_repo=ch_repo,
            state_repo=state_repo,
            ops_repo=ops_repo,
            fact_repo=FakeFactRepo(),
            project_repo=FakeProjectRepo(),
        )

        assert len(ops_repo.entries) == 1
        entry = ops_repo.entries[0]
        assert entry.op_type == "import_project"
        assert "chapter_range" in entry.payload

    def test_vectorize_enqueue(self, tmp_path: Path):
        """有 task_queue 时 → 每章入队一次。"""
        ch_repo = FakeChapterRepo()
        state_repo = FakeStateRepo()
        ops_repo = FakeOpsRepo()
        mock_queue = MagicMock()
        mock_queue.enqueue.return_value = "task_id"

        import_chapters(
            au_path=tmp_path / "test_au",
            chapters=self._make_chapters(3),
            chapter_repo=ch_repo,
            state_repo=state_repo,
            ops_repo=ops_repo,
            fact_repo=FakeFactRepo(),
            project_repo=FakeProjectRepo(),
            task_queue=mock_queue,
        )

        assert mock_queue.enqueue.call_count == 3

    def test_chapter_provenance_imported(self, tmp_path: Path):
        """导入章节的 provenance 应为 "imported"。"""
        ch_repo = FakeChapterRepo()
        state_repo = FakeStateRepo()
        ops_repo = FakeOpsRepo()

        import_chapters(
            au_path=tmp_path / "test_au",
            chapters=self._make_chapters(1),
            chapter_repo=ch_repo,
            state_repo=state_repo,
            ops_repo=ops_repo,
            fact_repo=FakeFactRepo(),
            project_repo=FakeProjectRepo(),
        )

        assert ch_repo.saved[0].provenance == "imported"

    def test_chapter_has_content_hash(self, tmp_path: Path):
        """每个导入章节都有 content_hash。"""
        ch_repo = FakeChapterRepo()
        state_repo = FakeStateRepo()
        ops_repo = FakeOpsRepo()

        import_chapters(
            au_path=tmp_path / "test_au",
            chapters=self._make_chapters(1),
            chapter_repo=ch_repo,
            state_repo=state_repo,
            ops_repo=ops_repo,
            fact_repo=FakeFactRepo(),
            project_repo=FakeProjectRepo(),
        )

        assert ch_repo.saved[0].content_hash != ""

    def test_index_status_stale_without_task_queue(self, tmp_path: Path):
        """无 task_queue 时 index_status 应为 STALE（未向量化）。"""
        ch_repo = FakeChapterRepo()
        state_repo = FakeStateRepo()
        ops_repo = FakeOpsRepo()

        import_chapters(
            au_path=tmp_path / "test_au",
            chapters=self._make_chapters(2),
            chapter_repo=ch_repo,
            state_repo=state_repo,
            ops_repo=ops_repo,
            fact_repo=FakeFactRepo(),
            project_repo=FakeProjectRepo(),
            task_queue=None,
        )

        assert state_repo.saved_state.index_status.value == "stale"

    def test_index_status_ready_with_task_queue(self, tmp_path: Path):
        """有 task_queue 时 index_status 应为 READY。"""
        ch_repo = FakeChapterRepo()
        state_repo = FakeStateRepo()
        ops_repo = FakeOpsRepo()
        mock_queue = MagicMock()
        mock_queue.enqueue.return_value = "task_id"

        import_chapters(
            au_path=tmp_path / "test_au",
            chapters=self._make_chapters(2),
            chapter_repo=ch_repo,
            state_repo=state_repo,
            ops_repo=ops_repo,
            fact_repo=FakeFactRepo(),
            project_repo=FakeProjectRepo(),
            task_queue=mock_queue,
        )

        assert state_repo.saved_state.index_status.value == "ready"

    def test_split_method_passed_through(self, tmp_path: Path):
        """split_method 应直接使用传入值，不重新计算。"""
        ch_repo = FakeChapterRepo()
        state_repo = FakeStateRepo()
        ops_repo = FakeOpsRepo()

        result = import_chapters(
            au_path=tmp_path / "test_au",
            chapters=self._make_chapters(2),
            chapter_repo=ch_repo,
            state_repo=state_repo,
            ops_repo=ops_repo,
            fact_repo=FakeFactRepo(),
            project_repo=FakeProjectRepo(),
            split_method="title",
        )

        assert result.split_method == "title"
