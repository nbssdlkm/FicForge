"""章节向量化编排函数。参见 PRD §5.3。"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Optional

from infra.vector_index.chunker import ChunkData, split_chapter_into_chunks

logger = logging.getLogger(__name__)


def vectorize_chapter(
    au_path: Path,
    chapter_num: int,
    chapter_repo: Any,
    vector_repo: Any,
    cast_registry: Optional[dict[str, Any]] = None,
    character_aliases: Optional[dict[str, list[str]]] = None,
) -> None:
    """向量化单个章节。

    步骤：
    1. 防御性校验——章节文件不存在则静默返回
    2. 读取章节原文
    3. 切块
    4. 扫描角色名填入 chunk 元数据
    5. 写入 ChromaDB
    """
    au_id = str(au_path)

    # 步骤 1：防御性校验
    try:
        exists = chapter_repo.exists(au_id, chapter_num)
    except Exception:
        exists = False

    if not exists:
        logger.info("章节 %d 文件不存在，跳过向量化", chapter_num)
        return

    try:
        # 步骤 2：读取原文（含 frontmatter，chunker 会剥离）
        import frontmatter as fm
        ch_path = Path(au_id) / "chapters" / "main" / f"ch{chapter_num:04d}.md"
        raw_text = ch_path.read_text(encoding="utf-8")

        # 步骤 3：切块
        chunks = split_chapter_into_chunks(raw_text, chapter_num)

        if not chunks:
            return

        # 步骤 4：扫描角色名
        if cast_registry:
            from core.domain.character_scanner import scan_characters_in_chapter
            for chunk in chunks:
                scanned = scan_characters_in_chapter(
                    chunk.content,
                    cast_registry,
                    character_aliases,
                    chapter_num,
                )
                chunk.characters = list(scanned.keys())

        # 步骤 5：写入 ChromaDB
        vector_repo.index_chapter(au_id, chunks)

    except Exception as e:
        logger.error("向量化章节 %d 失败: %s", chapter_num, e, exc_info=True)
        # 不抛异常到上层——记录日志即可
