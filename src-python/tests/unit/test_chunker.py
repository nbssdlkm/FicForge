# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""章节切块单元测试。"""

from __future__ import annotations

from infra.vector_index.chunker import split_chapter_into_chunks


def test_short_text_single_chunk():
    """短文本 → 单个 chunk。"""
    text = "短文本内容。"
    chunks = split_chapter_into_chunks(text, chapter_num=1)
    assert len(chunks) == 1
    assert chunks[0].content == "短文本内容。"
    assert chunks[0].chapter_num == 1
    assert chunks[0].chunk_index == 0


def test_long_text_multiple_chunks():
    """长文本多段落 → 按段落切分。"""
    paras = ["这是一个很长的段落。" * 30 for _ in range(5)]
    text = "\n\n".join(paras)
    chunks = split_chapter_into_chunks(text, chapter_num=2, max_size=500)
    assert len(chunks) > 1
    for chunk in chunks:
        assert chunk.chapter_num == 2


def test_split_at_sentence_boundary():
    """切分点在句号处。"""
    text = "第一句话。第二句话。第三句话。" * 50
    chunks = split_chapter_into_chunks(text, chapter_num=1, max_size=100)
    for chunk in chunks:
        # 每个 chunk 不应在字中间截断
        content = chunk.content.strip()
        if content:
            assert content[-1] in "。！？…" or len(content) < 100


def test_overlap_between_chunks():
    """overlap：相邻 chunk 有重叠。"""
    paras = [f"段落{i}的内容很长很长很长。" * 20 for i in range(3)]
    text = "\n\n".join(paras)
    chunks = split_chapter_into_chunks(text, chapter_num=1, max_size=200, overlap_sentences=1)
    if len(chunks) >= 2:
        # 第二个 chunk 的开头应包含第一个 chunk 末尾的句子
        last_sentence_of_first = chunks[0].content.rsplit("。", 2)[-2] + "。" if "。" in chunks[0].content else ""
        if last_sentence_of_first:
            assert last_sentence_of_first in chunks[1].content or len(chunks) == 1


def test_merge_short_paragraphs():
    """< 100 字段落合并。"""
    text = "短。\n\n也短。\n\n还是短。"
    chunks = split_chapter_into_chunks(text, chapter_num=1)
    # 三个短段落应合并为一个 chunk
    assert len(chunks) == 1
    assert "短" in chunks[0].content


def test_frontmatter_stripped():
    """含 frontmatter → 正确剥离。"""
    text = "---\nchapter_id: ch_123\nrevision: 1\n---\n正文内容。"
    chunks = split_chapter_into_chunks(text, chapter_num=1)
    assert len(chunks) == 1
    assert "chapter_id" not in chunks[0].content
    assert "正文内容" in chunks[0].content


def test_empty_text():
    """空文本 → 空列表。"""
    assert split_chapter_into_chunks("", chapter_num=1) == []
    assert split_chapter_into_chunks("---\nkey: val\n---\n", chapter_num=1) == []


def test_chunk_metadata():
    """chunk 元数据正确。"""
    text = "内容。"
    chunks = split_chapter_into_chunks(text, chapter_num=38)
    assert chunks[0].chapter_num == 38
    assert chunks[0].chunk_index == 0
    assert chunks[0].branch_id == "main"
