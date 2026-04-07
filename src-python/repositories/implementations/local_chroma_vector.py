# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""LocalChromaVectorRepository — ChromaDB 向量存储实现。

3 个 collection: chapters / characters / worldbuilding（D-0022: oc 合并入 characters）。
D-0013: WAL 模式由 chromadb_client.init_chromadb 保证。
"""

from __future__ import annotations

import logging
from typing import Any, Optional

from core.domain.chunk import Chunk
from infra.embeddings.provider import EmbeddingProvider
from infra.vector_index.chunker import ChunkData

logger = logging.getLogger(__name__)


class LocalChromaVectorRepository:
    """基于 ChromaDB 的向量存储。"""

    def __init__(self, client: Any, embedding_provider: EmbeddingProvider) -> None:
        self._client = client
        self._embedding = embedding_provider

    def _get_collection(self, name: str) -> Any:
        return self._client.get_or_create_collection(name=name)

    @staticmethod
    def _norm(au_id: str) -> str:
        """Windows/Unix 路径统一为正斜杠，去掉 ./ 前缀。"""
        return au_id.replace("\\", "/").lstrip("./")

    # ------------------------------------------------------------------
    # 章节索引
    # ------------------------------------------------------------------

    def index_chapter(self, au_id: str, chunks: list[ChunkData]) -> None:
        """将章节 chunks 写入 ChromaDB chapters collection。"""
        au_id = self._norm(au_id)
        if not chunks:
            return

        collection = self._get_collection("chapters")
        texts = [c.content for c in chunks]
        embeddings = self._embedding.embed(texts)

        ids = [
            f"{au_id}_ch{c.chapter_num:04d}_{c.chunk_index}"
            for c in chunks
        ]
        metadatas = [
            {
                "au_id": au_id,
                "chapter": c.chapter_num,
                "chunk_index": c.chunk_index,
                "branch_id": c.branch_id,
                "characters": ",".join(c.characters),
                "content": c.content[:200],  # 摘要
            }
            for c in chunks
        ]

        collection.upsert(
            ids=ids,
            embeddings=embeddings,
            documents=texts,
            metadatas=metadatas,
        )

    def delete_chapter(self, au_id: str, chapter_num: int) -> None:
        """删除指定 AU 的指定章节的所有 chunks。"""
        au_id = self._norm(au_id)
        collection = self._get_collection("chapters")
        try:
            collection.delete(where={
                "$and": [
                    {"au_id": au_id},
                    {"chapter": chapter_num},
                ]
            })
        except Exception as e:
            logger.warning("删除章节 %d chunks 失败: %s", chapter_num, e)

    def search(
        self,
        au_id: str,
        query_text: str,
        collection_name: str = "chapters",
        top_k: int = 3,
        char_filter: Optional[list[str]] = None,
    ) -> list[Chunk]:
        """向量检索。角色过滤在 Python 层执行（跨 ChromaDB 版本兼容）。"""
        au_id = self._norm(au_id)
        collection = self._get_collection(collection_name)

        query_embedding = self._embedding.embed([query_text])[0]

        # 取更多结果用于 Python 层过滤
        fetch_k = top_k * 3 if char_filter else top_k

        # 所有 collection 按 AU 隔离查询
        where_filter: dict[str, str] | None = {"au_id": au_id}
        results = collection.query(
            query_embeddings=[query_embedding],
            n_results=fetch_k,
            where=where_filter,
        )

        chunks: list[Chunk] = []
        documents = results.get("documents", [[]])[0]
        distances = results.get("distances", [[]])[0]
        metadatas = results.get("metadatas", [[]])[0]

        for i, doc in enumerate(documents):
            meta = metadatas[i] if i < len(metadatas) else {}
            dist = distances[i] if i < len(distances) else 0.0
            chunks.append(Chunk(
                content=doc,
                chapter_num=meta.get("chapter", 0),
                score=1.0 - dist,  # ChromaDB 返回 L2 距离，转为相似度
                metadata=meta,
            ))

        # Python 层角色过滤（跨 ChromaDB 版本兼容）
        if char_filter:
            filter_set = set(char_filter)
            chunks = [
                c for c in chunks
                if any(name in c.metadata.get("characters", "") for name in filter_set)
            ]

        return chunks[:top_k]

    def rebuild_all(
        self, au_id: str, chapters: list[tuple[int, list[ChunkData]]]
    ) -> None:
        """全量重建索引：删除 AU 所有 chunks → 逐章重新 index。"""
        au_id = self._norm(au_id)
        collection = self._get_collection("chapters")
        # 删除所有
        try:
            all_items = collection.get()
            if all_items["ids"]:
                au_ids = [
                    id_ for id_ in all_items["ids"] if id_.startswith(au_id)
                ]
                if au_ids:
                    collection.delete(ids=au_ids)
        except Exception as e:
            logger.warning("清理旧索引失败: %s", e)

        # 逐章重建
        for _chapter_num, chunks in chapters:
            self.index_chapter(au_id, chunks)

    def index_settings_files(
        self, au_id: str, file_type: str, chunks: list[ChunkData]
    ) -> None:
        """索引设定文件到对应 collection（characters/worldbuilding）。

        先删除该 AU + 文件的旧 chunks，再写入新 chunks。
        """
        au_id = self._norm(au_id)
        if not chunks:
            return

        collection = self._get_collection(file_type)

        # 提取 source_file 用于 ID 生成和删除旧 chunks
        import re as _re
        source_file = chunks[0].metadata.get("source_file", "") if chunks else ""
        # 安全化文件名用于 ChromaDB ID（移除空格、点等）
        file_stem = _re.sub(r"[.\s]+", "_", source_file.replace(".md", "")) if source_file else "unknown"

        # 先删除该 AU 下该文件的旧 chunks（避免跨 AU 误删）
        if source_file:
            try:
                old_results = collection.get(
                    where={"source_file": source_file},
                    include=["metadatas"],
                )
                if old_results and old_results.get("ids"):
                    old_ids = old_results.get("ids", [])
                    old_metas = old_results.get("metadatas") or []
                    delete_ids = []
                    for i, id_ in enumerate(old_ids):
                        meta = old_metas[i] if i < len(old_metas) else {}
                        if meta.get("au_id") == au_id or str(id_).startswith(f"{au_id}_"):
                            delete_ids.append(id_)
                    if delete_ids:
                        collection.delete(ids=delete_ids)
            except Exception as e:
                logger.warning("删除旧设定 chunks 失败: %s", e)

        texts = [c.content for c in chunks]
        embeddings = self._embedding.embed(texts)

        ids = [f"{au_id}_{file_type}_{file_stem}_{c.chunk_index}" for c in chunks]
        metadatas = [
            {
                "au_id": au_id,
                "characters": ",".join(c.characters),
                "content": c.content[:200],
                "source_file": c.metadata.get("source_file", ""),
            }
            for c in chunks
        ]

        collection.upsert(
            ids=ids,
            embeddings=embeddings,
            documents=texts,
            metadatas=metadatas,
        )
