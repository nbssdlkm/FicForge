"""向量仓库 + 向量化单元测试。"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from infra.vector_index.chunker import ChunkData
from infra.vector_index.vectorize import vectorize_chapter
from repositories.implementations.local_chroma_vector import LocalChromaVectorRepository


def _mock_embedding_provider(dim: int = 8) -> MagicMock:
    """Mock embedding provider 返回固定维度向量。"""
    provider = MagicMock()
    provider.embed.side_effect = lambda texts: [[0.1 * (i + 1)] * dim for i in range(len(texts))]
    return provider


def _make_chunks(chapter_num: int = 1, n: int = 3) -> list[ChunkData]:
    return [
        ChunkData(
            content=f"chunk {i} 内容。林深在场。",
            chapter_num=chapter_num,
            chunk_index=i,
            characters=["林深"] if i % 2 == 0 else ["陈明"],
        )
        for i in range(n)
    ]


# ===== LocalChromaVectorRepository =====


def test_index_and_search(tmp_path: Path) -> None:
    """index_chapter → search 能找到。"""
    import chromadb

    client = chromadb.Client()
    embed = _mock_embedding_provider()
    repo = LocalChromaVectorRepository(client, embed)

    chunks = _make_chunks(chapter_num=1, n=3)
    repo.index_chapter("test_au", chunks)

    results = repo.search("test_au", "测试查询", top_k=3)
    assert len(results) > 0


def test_delete_chapter(tmp_path: Path) -> None:
    """delete_chapter → search 找不到。"""
    import chromadb

    client = chromadb.Client()
    embed = _mock_embedding_provider()
    repo = LocalChromaVectorRepository(client, embed)

    chunks = _make_chunks(chapter_num=5, n=2)
    repo.index_chapter("test_au", chunks)
    repo.delete_chapter("test_au", 5)

    results = repo.search("test_au", "查询", top_k=5)
    ch5_results = [r for r in results if r.metadata.get("chapter") == 5]
    assert len(ch5_results) == 0


def test_search_with_char_filter(tmp_path: Path) -> None:
    """search 带 char_filter → 只返回包含指定角色的 chunk。"""
    import chromadb

    client = chromadb.Client()
    embed = _mock_embedding_provider()
    repo = LocalChromaVectorRepository(client, embed)

    chunks = _make_chunks(chapter_num=1, n=4)
    repo.index_chapter("test_au", chunks)

    results = repo.search("test_au", "查询", top_k=10, char_filter=["林深"])
    for r in results:
        assert "林深" in r.metadata.get("characters", "")


def test_search_without_char_filter(tmp_path: Path) -> None:
    """search 不带 char_filter → 返回所有相关 chunk。"""
    import chromadb

    client = chromadb.Client()
    embed = _mock_embedding_provider()
    repo = LocalChromaVectorRepository(client, embed)

    chunks = _make_chunks(chapter_num=1, n=4)
    repo.index_chapter("test_au", chunks)

    results = repo.search("test_au", "查询", top_k=10)
    # 不过滤角色，应返回所有 chunk
    assert len(results) == 4


# ===== vectorize_chapter =====


def test_vectorize_chapter_normal(tmp_path: Path) -> None:
    """正常章节 → ChromaDB 中有 chunks。"""
    import chromadb

    au = tmp_path / "test_au"
    au.mkdir()
    (au / "chapters" / "main").mkdir(parents=True)
    (au / "chapters" / "main" / "ch0001.md").write_text(
        "---\nchapter_id: ch1\n---\n正文内容很长。" * 20, encoding="utf-8"
    )

    mock_chapter_repo = MagicMock()
    mock_chapter_repo.exists.return_value = True

    client = chromadb.Client()
    embed = _mock_embedding_provider()
    vector_repo = LocalChromaVectorRepository(client, embed)

    vectorize_chapter(au, 1, mock_chapter_repo, vector_repo)

    results = vector_repo.search(str(au), "正文", top_k=5)
    assert len(results) > 0


def test_vectorize_chapter_missing_file(tmp_path: Path) -> None:
    """章节文件不存在 → 静默返回。"""
    mock_chapter_repo = MagicMock()
    mock_chapter_repo.exists.return_value = False

    # 不应抛异常
    vectorize_chapter(tmp_path, 999, mock_chapter_repo, MagicMock())


def test_vectorize_chunk_has_characters(tmp_path: Path) -> None:
    """chunk 元数据包含 characters。"""
    import chromadb

    au = tmp_path / "test_au"
    au.mkdir()
    (au / "chapters" / "main").mkdir(parents=True)
    (au / "chapters" / "main" / "ch0001.md").write_text(
        "林深走进咖啡馆。陈明正在擦杯子。" * 10, encoding="utf-8"
    )

    mock_chapter_repo = MagicMock()
    mock_chapter_repo.exists.return_value = True

    client = chromadb.Client()
    embed = _mock_embedding_provider()
    vector_repo = LocalChromaVectorRepository(client, embed)

    cast = {"from_core": ["林深", "陈明"], "au_specific": [], "oc": []}
    vectorize_chapter(au, 1, mock_chapter_repo, vector_repo, cast_registry=cast)

    results = vector_repo.search(str(au), "咖啡馆", top_k=5)
    assert len(results) > 0
    # 至少有一个结果包含角色信息
    has_chars = any(r.metadata.get("characters", "") for r in results)
    assert has_chars
