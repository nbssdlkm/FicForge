"""后台任务 Worker 函数。参见 PRD §2.6.5。"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from infra.vector_index.task_queue import TaskInfo

logger = logging.getLogger(__name__)


def worker_vectorize_chapter(info: TaskInfo, deps: dict[str, Any]) -> None:
    """向量化单个章节（调用 T-015 vectorize_chapter）。

    防御性校验：章节文件不存在则静默返回。
    """
    from infra.vector_index.vectorize import vectorize_chapter

    au_path = Path(info.payload["au_path"])
    chapter_num = info.payload["chapter_num"]
    chapter_repo = deps.get("chapter_repo")
    vector_repo = deps.get("vector_repo")
    cast_registry = info.payload.get("cast_registry")

    vectorize_chapter(
        au_path, chapter_num, chapter_repo, vector_repo,
        cast_registry=cast_registry,
    )


def worker_delete_chapter_chunks(info: TaskInfo, deps: dict[str, Any]) -> None:
    """删除章节的 ChromaDB chunks（undo 用）。"""
    vector_repo = deps.get("vector_repo")
    au_id = info.au_id
    chapter_num = info.payload["chapter_num"]

    if vector_repo:
        vector_repo.delete_chapter(au_id, chapter_num)
        logger.info("已删除章节 %d 的 chunks", chapter_num)


def worker_rebuild_index(info: TaskInfo, deps: dict[str, Any]) -> None:
    """全量重建索引。"""
    from infra.vector_index.chunker import split_chapter_into_chunks

    au_path = Path(info.payload["au_path"])
    chapter_repo = deps.get("chapter_repo")
    vector_repo = deps.get("vector_repo")

    if not chapter_repo or not vector_repo:
        logger.error("rebuild_index: 缺少 chapter_repo 或 vector_repo")
        return

    chapters = chapter_repo.list_main(str(au_path))
    chapter_chunks = []
    for ch in chapters:
        raw_path = Path(str(au_path)) / "chapters" / "main" / f"ch{ch.chapter_num:04d}.md"
        if raw_path.exists():
            raw_text = raw_path.read_text(encoding="utf-8")
            chunks = split_chapter_into_chunks(raw_text, ch.chapter_num)
            chapter_chunks.append((ch.chapter_num, chunks))

    vector_repo.rebuild_all(str(au_path), chapter_chunks)
    logger.info("全量重建完成：%d 章", len(chapter_chunks))
