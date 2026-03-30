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


def worker_vectorize_settings_file(info: TaskInfo, deps: dict[str, Any]) -> None:
    """向量化设定文件（characters/worldbuilding .md）。

    先删除该文件的旧 chunks，再切块写入对应 collection。
    """
    from infra.vector_index.chunker import split_chapter_into_chunks

    file_path = Path(info.payload["file_path"])
    au_id = info.au_id
    collection_name = info.payload.get("collection", "characters")
    vector_repo = deps.get("vector_repo")

    if not file_path.is_file():
        logger.info("设定文件不存在，跳过向量化: %s", file_path)
        return

    if not vector_repo:
        logger.warning("vector_repo 未提供，跳过向量化")
        return

    try:
        content = file_path.read_text(encoding="utf-8")
        if not content.strip():
            return

        # 切块（复用章节切块器，chapter_num=0 表示非章节）
        chunks = split_chapter_into_chunks(content, chapter_num=0)
        if not chunks:
            return

        # 为 chunks 设置文件名元数据
        for i, chunk in enumerate(chunks):
            chunk.metadata["source_file"] = file_path.name
            chunk.metadata["collection"] = collection_name

        # 先删旧 chunks 再写新（upsert 语义）
        vector_repo.index_settings_files(au_id, collection_name, chunks)
        logger.info("向量化设定文件完成: %s (%d chunks)", file_path.name, len(chunks))

    except Exception as e:
        logger.error("向量化设定文件失败: %s — %s", file_path, e, exc_info=True)


def worker_delete_settings_chunks(info: TaskInfo, deps: dict[str, Any]) -> None:
    """删除设定文件的所有 ChromaDB chunks。"""
    file_path = info.payload.get("file_path", "")
    au_id = info.au_id
    collection_name = info.payload.get("collection", "characters")
    vector_repo = deps.get("vector_repo")

    if not vector_repo:
        logger.warning("vector_repo 未提供，跳过删除")
        return

    try:
        # 删除当前 AU 下该文件的 chunks，避免跨 AU 误删
        filename = Path(file_path).name if file_path else ""
        if filename:
            collection = vector_repo._get_collection(collection_name)
            # 先按 source_file 查，再在 Python 层限定到当前 au_id
            results = collection.get(
                where={"source_file": filename},
                include=["metadatas"],
            )
            if results and results.get("ids"):
                ids = results.get("ids", [])
                metas = results.get("metadatas") or []
                delete_ids = []
                for i, id_ in enumerate(ids):
                    meta = metas[i] if i < len(metas) else {}
                    # 优先使用 metadata.au_id；兼容旧数据时回退到 ID 前缀匹配
                    if meta.get("au_id") == au_id or str(id_).startswith(f"{au_id}_"):
                        delete_ids.append(id_)
                if delete_ids:
                    collection.delete(ids=delete_ids)
                    logger.info("已删除设定文件 %s 的 %d chunks", filename, len(delete_ids))
    except Exception as e:
        logger.error("删除设定文件 chunks 失败: %s — %s", file_path, e, exc_info=True)


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
