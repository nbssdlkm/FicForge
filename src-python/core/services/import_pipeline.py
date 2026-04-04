"""导入流水线。参见 PRD §4.8。

实现三级章节切分策略、格式解析器和导入编排。
"""

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from core.domain.chapter import Chapter
from core.domain.character_scanner import scan_characters_in_chapter
from core.domain.enums import IndexStatus, OpType
from core.domain.ops_entry import OpsEntry
from core.domain.text_utils import extract_last_scene_ending
from infra.storage_local.file_utils import compute_content_hash, now_utc
from repositories.implementations.local_file_ops import generate_op_id


# ---------------------------------------------------------------------------
# 三级章节切分策略（PRD §4.8）
# ---------------------------------------------------------------------------

# 优先级 1：标准章节标识
_STANDARD_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"^第[一二三四五六七八九十百千\d]+章", re.MULTILINE),
    re.compile(r"^Chapter\s+\d+", re.MULTILINE | re.IGNORECASE),
    re.compile(r"^第[一二三四五六七八九十百千\d]+节", re.MULTILINE),
]

# 优先级 2：纯数字标题
_INTEGER_PATTERN: re.Pattern[str] = re.compile(r"^\d{1,3}\s*$", re.MULTILINE)

# 自动切分每段字数
_AUTO_SPLIT_SIZE: int = 3000


def split_into_chapters(
    text: str,
    source_format: str = "txt",
) -> list[dict[str, Any]]:
    """三级切分策略，返回 [{chapter_num, title, content}]。"""
    if not text.strip():
        return []

    # 优先级 1：标准章节标识
    result = _try_standard_split(text)
    if result is not None:
        return result

    # 优先级 2：连续整数标题
    result = _try_integer_split(text)
    if result is not None:
        return result

    # 优先级 3：按 3000 字自动切分
    return _auto_split(text)


def _try_standard_split(text: str) -> Optional[list[dict[str, Any]]]:
    """尝试用标准章节标识切分。"""
    # 合并所有标准模式的匹配
    matches: list[tuple[int, str]] = []
    for pat in _STANDARD_PATTERNS:
        for m in pat.finditer(text):
            matches.append((m.start(), m.group()))

    if not matches:
        return None

    # 按位置排序
    matches.sort(key=lambda x: x[0])

    # 至少需要 1 个匹配
    chapters: list[dict[str, Any]] = []

    # 保留第一个章节标识之前的内容（前言/序言）
    pre_content = text[: matches[0][0]].strip()

    for i, (start, title_text) in enumerate(matches):
        # 标题行：从匹配起始到该行结束
        line_end = text.find("\n", start)
        if line_end == -1:
            full_title = text[start:].strip()
        else:
            full_title = text[start:line_end].strip()

        # 内容：从标题行之后到下一个匹配之前
        content_start = (line_end + 1) if line_end != -1 else len(text)
        if i + 1 < len(matches):
            content_end = matches[i + 1][0]
        else:
            content_end = len(text)

        content = text[content_start:content_end].strip()

        # 将前言内容拼到第一章开头
        if i == 0 and pre_content:
            content = pre_content + "\n\n" + content if content else pre_content

        chapters.append({
            "chapter_num": i + 1,
            "title": full_title,
            "content": content,
        })

    return chapters if chapters else None


def _try_integer_split(text: str) -> Optional[list[dict[str, Any]]]:
    """尝试用纯数字标题切分。"""
    matches: list[tuple[int, str]] = []
    for m in _INTEGER_PATTERN.finditer(text):
        matches.append((m.start(), m.group().strip()))

    if len(matches) < 2:
        return None

    # 验证是否为连续整数序列
    nums = [int(title) for _, title in matches]
    is_sequential = all(
        nums[i + 1] == nums[i] + 1 for i in range(len(nums) - 1)
    )
    if not is_sequential:
        return None

    chapters: list[dict[str, Any]] = []

    # 保留第一个数字标题之前的内容
    pre_content = text[: matches[0][0]].strip()

    for i, (start, title_text) in enumerate(matches):
        line_end = text.find("\n", start)
        content_start = (line_end + 1) if line_end != -1 else len(text)
        if i + 1 < len(matches):
            content_end = matches[i + 1][0]
        else:
            content_end = len(text)

        content = text[content_start:content_end].strip()

        # 将前言内容拼到第一章开头
        if i == 0 and pre_content:
            content = pre_content + "\n\n" + content if content else pre_content

        chapters.append({
            "chapter_num": i + 1,
            "title": title_text,
            "content": content,
        })

    return chapters if chapters else None


def _auto_split(text: str) -> list[dict[str, Any]]:
    """按 3000 字切分，切在段落边界（空行处）。"""
    stripped = text.strip()
    if not stripped:
        return []

    if len(stripped) <= _AUTO_SPLIT_SIZE:
        return [{"chapter_num": 1, "title": "自动分段 1", "content": stripped}]

    chapters: list[dict[str, Any]] = []
    remaining = stripped
    seg_num = 0

    while remaining:
        seg_num += 1
        if len(remaining) <= _AUTO_SPLIT_SIZE:
            chapters.append({
                "chapter_num": seg_num,
                "title": f"自动分段 {seg_num}",
                "content": remaining.strip(),
            })
            break

        # 在 _AUTO_SPLIT_SIZE 附近找段落边界（空行）
        search_start = max(0, _AUTO_SPLIT_SIZE - 500)
        search_end = min(len(remaining), _AUTO_SPLIT_SIZE + 500)
        search_region = remaining[search_start:search_end]

        # 找最近的空行（段落边界）
        best_split = -1
        for m in re.finditer(r"\n\s*\n", search_region):
            best_split = search_start + m.end()
            break  # 取第一个空行

        if best_split == -1:
            # 没有空行，直接在 _AUTO_SPLIT_SIZE 处切
            best_split = _AUTO_SPLIT_SIZE

        chunk = remaining[:best_split].strip()
        remaining = remaining[best_split:].strip()

        chapters.append({
            "chapter_num": seg_num,
            "title": f"自动分段 {seg_num}",
            "content": chunk,
        })

    return chapters


def get_split_method(text: str) -> str:
    """返回将使用的切分方法名称。"""
    if not text.strip():
        return "auto_3000"
    if _try_standard_split(text) is not None:
        return "title"
    if _try_integer_split(text) is not None:
        return "integer"
    return "auto_3000"


# ---------------------------------------------------------------------------
# 格式解析器
# ---------------------------------------------------------------------------

def parse_import_file(file_path: Path) -> str:
    """读取文件，返回纯文本内容。"""
    suffix = file_path.suffix.lower()

    if suffix in (".txt", ".md"):
        return file_path.read_text(encoding="utf-8")

    if suffix == ".docx":
        return _parse_docx(file_path)

    if suffix in (".html", ".htm"):
        return _parse_html(file_path)

    raise ValueError(f"不支持的文件格式: {suffix}")


def _parse_docx(file_path: Path) -> str:
    """使用 python-docx 提取正文段落。"""
    from docx import Document  # type: ignore[import-untyped]

    doc = Document(str(file_path))
    paragraphs: list[str] = []
    for para in doc.paragraphs:
        text = para.text.strip()
        if text:
            paragraphs.append(text)
    return "\n\n".join(paragraphs)


def _parse_html(file_path: Path) -> str:
    """从 HTML 中提取正文文本（去除标签，保留段落结构）。"""
    import html
    raw = file_path.read_text(encoding="utf-8", errors="replace")

    # 去除 script/style 标签及内容
    raw = re.sub(r"<(script|style)[^>]*>.*?</\1>", "", raw, flags=re.DOTALL | re.IGNORECASE)
    # <br> <br/> → 换行
    raw = re.sub(r"<br\s*/?>", "\n", raw, flags=re.IGNORECASE)
    # <p> </p> <div> </div> <h1-6> → 双换行
    raw = re.sub(r"</(p|div|h[1-6]|li|tr|blockquote)>", "\n\n", raw, flags=re.IGNORECASE)
    raw = re.sub(r"<(p|div|h[1-6]|li|tr|blockquote)[^>]*>", "", raw, flags=re.IGNORECASE)
    # 去除其他标签
    raw = re.sub(r"<[^>]+>", "", raw)
    # HTML 实体解码
    raw = html.unescape(raw)
    # 合并多余空行
    raw = re.sub(r"\n{3,}", "\n\n", raw)
    return raw.strip()


# ---------------------------------------------------------------------------
# 导入编排 Service
# ---------------------------------------------------------------------------

@dataclass
class ImportResult:
    """导入结果。"""

    total_chapters: int = 0
    split_method: str = ""
    characters_found: list[str] = field(default_factory=list)
    state_initialized: bool = False


def import_chapters(
    au_path: Path,
    chapters: list[dict[str, Any]],
    chapter_repo: Any,
    state_repo: Any,
    ops_repo: Any,
    fact_repo: Any,
    project_repo: Any,
    task_queue: Optional[Any] = None,
    cast_registry: Optional[dict[str, Any]] = None,
    character_aliases: Optional[dict[str, list[str]]] = None,
    split_method: str = "auto_3000",
) -> ImportResult:
    """导入章节全链路编排。

    步骤：
    1. 写入章节文件
    2. 初始化 state.yaml
    3. 全量角色扫描
    4. 向量化入队
    5. 写入 ops.jsonl
    6. 返回结果
    """
    au_id = str(au_path)
    timestamp = now_utc()
    effective_registry = cast_registry or {"characters": []}

    # ------------------------------------------------------------------
    # 步骤 1：写入章节文件
    # ------------------------------------------------------------------
    for ch_data in chapters:
        ch_num = ch_data["chapter_num"]
        content = ch_data["content"]
        chapter = Chapter(
            au_id=au_id,
            chapter_num=ch_num,
            content=content,
            chapter_id=f"ch_{uuid.uuid4().hex[:8]}",
            revision=1,
            confirmed_at=timestamp,
            content_hash=compute_content_hash(content),
            provenance="imported",
        )
        chapter_repo.save(chapter)

    # ------------------------------------------------------------------
    # 步骤 3：全量角色扫描（在 state 初始化之前，因为要填充 characters_last_seen）
    # ------------------------------------------------------------------
    characters_last_seen: dict[str, int] = {}
    for ch_data in chapters:
        scanned = scan_characters_in_chapter(
            ch_data["content"],
            effective_registry,
            character_aliases,
            ch_data["chapter_num"],
        )
        # max 合并：保留最大章节号
        for name, ch_num in scanned.items():
            if name not in characters_last_seen or ch_num > characters_last_seen[name]:
                characters_last_seen[name] = ch_num

    # ------------------------------------------------------------------
    # 步骤 2：初始化 state.yaml
    # ------------------------------------------------------------------
    last_chapter_num = max(ch["chapter_num"] for ch in chapters) if chapters else 0
    last_content = chapters[-1]["content"] if chapters else ""
    last_scene_ending = extract_last_scene_ending(last_content, max_chars=50)

    from core.domain.state import State

    state = State(
        au_id=au_id,
        revision=1,
        current_chapter=last_chapter_num + 1,
        last_scene_ending=last_scene_ending,
        characters_last_seen=characters_last_seen,
        last_confirmed_chapter_focus=[],
        chapter_focus=[],
        chapters_dirty=[],
        index_status=IndexStatus.STALE if task_queue is None else IndexStatus.READY,
    )
    state_repo.save(state)

    # ------------------------------------------------------------------
    # 步骤 4：向量化
    # ------------------------------------------------------------------
    if task_queue is not None:
        for ch_data in chapters:
            task_queue.enqueue(
                "vectorize_chapter",
                au_id,
                {"chapter_num": ch_data["chapter_num"]},
            )

    # ------------------------------------------------------------------
    # 步骤 5：写入 ops.jsonl
    # ------------------------------------------------------------------
    ops_entry = OpsEntry(
        op_id=generate_op_id(),
        op_type=OpType.IMPORT_PROJECT.value,
        target_id=au_id,
        timestamp=timestamp,
        payload={
            "chapter_range": [
                min(ch["chapter_num"] for ch in chapters),
                last_chapter_num,
            ],
            "total_chapters": len(chapters),
            "characters_found": list(characters_last_seen.keys()),
            "state_snapshot": {
                "current_chapter": state.current_chapter,
                "last_scene_ending": state.last_scene_ending,
                "characters_last_seen": state.characters_last_seen,
            },
        },
    )
    ops_repo.append(au_id, ops_entry)

    # ------------------------------------------------------------------
    # 步骤 6：返回结果
    # ------------------------------------------------------------------
    return ImportResult(
        total_chapters=len(chapters),
        split_method=split_method,
        characters_found=list(characters_last_seen.keys()),
        state_initialized=True,
    )
