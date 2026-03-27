"""章节文本切块。参见 PRD §5.2。

切分规则：
- frontmatter 剥离（python-frontmatter，不用正则）
- 按段落切（空行或 ## 标题为边界）
- 切分点在句号/叹号/问号处
- < 100 字合并到相邻段
- > 600 字先按句号切分再组合
- Overlap 用"最后一整句"
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any


@dataclass
class ChunkData:
    """切块结果（内部使用，不依赖 domain Chunk 避免循环导入）。"""

    content: str
    chapter_num: int
    chunk_index: int
    branch_id: str = "main"
    characters: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


# 句子结束标点
_SENTENCE_END = re.compile(r"[。！？…\n]")


def split_chapter_into_chunks(
    text: str,
    chapter_num: int,
    max_size: int = 500,
    overlap_sentences: int = 1,
) -> list[ChunkData]:
    """将章节文本切块（PRD §5.2）。

    Args:
        text: 章节原始文本（可能含 frontmatter）。
        chapter_num: 章节号。
        max_size: 每个 chunk 最大字符数。
        overlap_sentences: overlap 句数。

    Returns:
        ChunkData 列表。
    """
    # 第零步：剥离 frontmatter
    import frontmatter as fm
    post = fm.loads(text)
    body: str = post.content.strip()

    if not body:
        return []

    # 按段落切（空行或 ## 标题为边界）
    raw_paragraphs = re.split(r"\n\s*\n|(?=^##\s)", body, flags=re.MULTILINE)
    paragraphs = [p.strip() for p in raw_paragraphs if p.strip()]

    # < 100 字合并到相邻段
    merged = _merge_short_paragraphs(paragraphs, min_size=100)

    # > 600 字按句号切分再组合
    expanded: list[str] = []
    for para in merged:
        if len(para) > 600:
            expanded.extend(_split_long_paragraph(para, max_size))
        else:
            expanded.append(para)

    # 按 max_size 组合成 chunks
    chunks_text = _combine_into_chunks(expanded, max_size)

    # 添加 overlap（最后一整句）
    if overlap_sentences > 0 and len(chunks_text) > 1:
        chunks_text = _add_overlap(chunks_text, overlap_sentences)

    # 构建 ChunkData
    result: list[ChunkData] = []
    for i, content in enumerate(chunks_text):
        result.append(ChunkData(
            content=content,
            chapter_num=chapter_num,
            chunk_index=i,
            branch_id="main",
        ))

    return result


def _merge_short_paragraphs(paragraphs: list[str], min_size: int) -> list[str]:
    """< min_size 字的段落合并到相邻段。"""
    if not paragraphs:
        return []
    merged: list[str] = [paragraphs[0]]
    for para in paragraphs[1:]:
        if len(merged[-1]) < min_size:
            merged[-1] += "\n" + para
        else:
            merged.append(para)
    # 最后一段也可能太短
    if len(merged) > 1 and len(merged[-1]) < min_size:
        merged[-2] += "\n" + merged[-1]
        merged.pop()
    return merged


def _split_long_paragraph(para: str, max_size: int) -> list[str]:
    """按句号切分长段落，再组合成 <= max_size 的块。"""
    sentences = _split_sentences(para)
    result: list[str] = []
    current = ""
    for sent in sentences:
        if current and len(current) + len(sent) > max_size:
            result.append(current.strip())
            current = sent
        else:
            current += sent
    if current.strip():
        result.append(current.strip())
    return result if result else [para]


def _split_sentences(text: str) -> list[str]:
    """按句子结束标点切分。保留标点在句子末尾。"""
    parts: list[str] = []
    last = 0
    for m in _SENTENCE_END.finditer(text):
        end = m.end()
        parts.append(text[last:end])
        last = end
    if last < len(text):
        parts.append(text[last:])
    return [p for p in parts if p.strip()]


def _combine_into_chunks(paragraphs: list[str], max_size: int) -> list[str]:
    """将段落组合成 <= max_size 的 chunks。"""
    if not paragraphs:
        return []
    chunks: list[str] = [paragraphs[0]]
    for para in paragraphs[1:]:
        if len(chunks[-1]) + len(para) + 1 <= max_size:
            chunks[-1] += "\n" + para
        else:
            chunks.append(para)
    return chunks


def _add_overlap(chunks: list[str], n_sentences: int) -> list[str]:
    """为相邻 chunk 添加 overlap（最后 n 整句）。"""
    result = [chunks[0]]
    for i in range(1, len(chunks)):
        prev_sentences = _split_sentences(chunks[i - 1])
        overlap = "".join(prev_sentences[-n_sentences:]) if prev_sentences else ""
        if overlap:
            result.append(overlap + chunks[i])
        else:
            result.append(chunks[i])
    return result
