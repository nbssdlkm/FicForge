"""向量仓库 + 向量化单元测试。"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from infra.vector_index.task_queue import TaskInfo
from infra.vector_index.workers import worker_delete_settings_chunks
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

    cast = {"characters": ["林深", "陈明"]}
    vectorize_chapter(au, 1, mock_chapter_repo, vector_repo, cast_registry=cast)

    results = vector_repo.search(str(au), "咖啡馆", top_k=5)
    assert len(results) > 0
    # 至少有一个结果包含角色信息
    has_chars = any(r.metadata.get("characters", "") for r in results)
    assert has_chars


# ===== 设定文件 index_settings_files =====

def _make_settings_chunks(filename: str, n: int = 2) -> list[ChunkData]:
    return [
        ChunkData(
            content=f"{filename} chunk {i}",
            chapter_num=0,
            chunk_index=i,
            metadata={"source_file": filename},
        )
        for i in range(n)
    ]


def test_search_au_isolation():
    """不同 AU 的章节检索互不干扰。"""
    import chromadb
    client = chromadb.Client()
    embed = _mock_embedding_provider()
    repo = LocalChromaVectorRepository(client, embed)

    # AU1 和 AU2 各写入 1 章
    chunks_au1 = [ChunkData(content="AU1 独有内容", chapter_num=1, chunk_index=0)]
    chunks_au2 = [ChunkData(content="AU2 独有内容", chapter_num=1, chunk_index=0)]
    repo.index_chapter("au1", chunks_au1)
    repo.index_chapter("au2", chunks_au2)

    # AU1 只能搜到自己
    results_au1 = repo.search("au1", "内容", collection_name="chapters", top_k=10)
    assert all("AU1" in r.content for r in results_au1)
    assert not any("AU2" in r.content for r in results_au1)

    # AU2 只能搜到自己
    results_au2 = repo.search("au2", "内容", collection_name="chapters", top_k=10)
    assert all("AU2" in r.content for r in results_au2)


def test_delete_chapter_au_isolation():
    """删除章节只影响目标 AU，不误删其他 AU。"""
    import chromadb
    client = chromadb.Client()
    embed = _mock_embedding_provider()
    repo = LocalChromaVectorRepository(client, embed)

    chunks_au1 = [ChunkData(content="AU1 ch1", chapter_num=1, chunk_index=0)]
    chunks_au2 = [ChunkData(content="AU2 ch1", chapter_num=1, chunk_index=0)]
    repo.index_chapter("au1", chunks_au1)
    repo.index_chapter("au2", chunks_au2)

    # 删除 AU1 的第 1 章
    repo.delete_chapter("au1", 1)

    # AU1 搜不到了
    results_au1 = repo.search("au1", "内容", collection_name="chapters", top_k=10)
    assert len(results_au1) == 0

    # AU2 不受影响
    results_au2 = repo.search("au2", "内容", collection_name="chapters", top_k=10)
    assert len(results_au2) == 1
    assert "AU2" in results_au2[0].content


def test_settings_files_au_isolation():
    """不同 AU 的同名设定文件互不干扰。"""
    import chromadb
    client = chromadb.Client()
    embed = _mock_embedding_provider()
    repo = LocalChromaVectorRepository(client, embed)

    chunks_au1 = _make_settings_chunks("Connor.md", n=2)
    chunks_au2 = _make_settings_chunks("Connor.md", n=2)
    repo.index_settings_files("au1", "characters", chunks_au1)
    repo.index_settings_files("au2", "characters", chunks_au2)

    coll = repo._get_collection("characters")
    all_items = coll.get(include=["metadatas"])
    # 两个 AU × 2 chunks = 4 条
    assert len(all_items["ids"]) == 4

    # 按 au_id 过滤
    au1_items = coll.get(where={"au_id": "au1"}, include=[])
    au2_items = coll.get(where={"au_id": "au2"}, include=[])
    assert len(au1_items["ids"]) == 2
    assert len(au2_items["ids"]) == 2

    # 搜索按 AU 隔离
    results_au1 = repo.search("au1", "Connor", collection_name="characters", top_k=10)
    results_au2 = repo.search("au2", "Connor", collection_name="characters", top_k=10)
    assert len(results_au1) == 2
    assert len(results_au2) == 2


def test_settings_files_source_file_metadata():
    """Bug fix: source_file + au_id 元数据正确存入 ChromaDB。"""
    import chromadb
    client = chromadb.Client()
    embed = _mock_embedding_provider()
    repo = LocalChromaVectorRepository(client, embed)

    chunks = _make_settings_chunks("Connor.md", n=2)
    repo.index_settings_files("test_meta_au", "characters", chunks)

    coll = repo._get_collection("characters")
    results = coll.get(where={"au_id": "test_meta_au"}, include=["metadatas"])
    assert len(results["ids"]) == 2
    for meta in results["metadatas"]:
        assert meta["source_file"] == "Connor.md"
        assert meta["au_id"] == "test_meta_au"


def test_settings_files_no_id_collision():
    """Bug fix: 不同文件的 chunks 使用不同 ID，不互相覆盖。"""
    import chromadb
    client = chromadb.Client()
    embed = _mock_embedding_provider()
    repo = LocalChromaVectorRepository(client, embed)

    chunks_a = _make_settings_chunks("Connor.md", n=2)
    chunks_b = _make_settings_chunks("Hank.md", n=2)

    repo.index_settings_files("test_collision_au", "characters", chunks_a)
    repo.index_settings_files("test_collision_au", "characters", chunks_b)

    coll = repo._get_collection("characters")
    au_items = coll.get(where={"au_id": "test_collision_au"}, include=["metadatas"])
    # 两个文件 × 2 chunks = 4 条
    assert len(au_items["ids"]) == 4

    connor_ids = [id_ for id_, m in zip(au_items["ids"], au_items["metadatas"]) if m.get("source_file") == "Connor.md"]
    hank_ids = [id_ for id_, m in zip(au_items["ids"], au_items["metadatas"]) if m.get("source_file") == "Hank.md"]
    assert len(connor_ids) == 2
    assert len(hank_ids) == 2


def test_settings_files_upsert_replaces_old_chunks():
    """修改文件时，旧 chunks 被删除，新 chunks 替代。"""
    import chromadb
    client = chromadb.Client()
    embed = _mock_embedding_provider()
    repo = LocalChromaVectorRepository(client, embed)

    # 第一次：2 chunks
    chunks_v1 = _make_settings_chunks("Connor.md", n=2)
    repo.index_settings_files("test_upsert_au", "characters", chunks_v1)

    # 第二次：3 chunks（模拟修改后内容变多）
    chunks_v2 = _make_settings_chunks("Connor.md", n=3)
    repo.index_settings_files("test_upsert_au", "characters", chunks_v2)

    coll = repo._get_collection("characters")
    au_items = coll.get(where={"au_id": "test_upsert_au"}, include=["metadatas"])
    connor_ids = [id_ for id_, m in zip(au_items["ids"], au_items["metadatas"]) if m.get("source_file") == "Connor.md"]
    # 应只有 3 条（v2），不是 5 条（v1+v2）
    assert len(connor_ids) == 3


def test_settings_files_upsert_scoped_to_current_au():
    """同名文件在不同 AU 共存时，重建 AU1 不应删除 AU2 数据。"""
    import chromadb
    client = chromadb.Client()
    embed = _mock_embedding_provider()
    repo = LocalChromaVectorRepository(client, embed)

    repo.index_settings_files("au1", "characters", _make_settings_chunks("Connor.md", n=2))
    repo.index_settings_files("au2", "characters", _make_settings_chunks("Connor.md", n=2))

    repo.index_settings_files("au1", "characters", _make_settings_chunks("Connor.md", n=1))

    coll = repo._get_collection("characters")
    results = coll.get(where={"source_file": "Connor.md"}, include=["metadatas"])
    au1_count = sum(1 for m in results["metadatas"] if m.get("au_id") == "au1")
    au2_count = sum(1 for m in results["metadatas"] if m.get("au_id") == "au2")
    assert au1_count == 1
    assert au2_count == 2


def test_worker_delete_settings_chunks_only_deletes_current_au():
    """worker 删除同名文件时应仅删除当前 AU 的 chunks。"""
    import chromadb
    client = chromadb.Client()
    embed = _mock_embedding_provider()
    repo = LocalChromaVectorRepository(client, embed)

    repo.index_settings_files("del_au1", "characters", _make_settings_chunks("Connor.md", n=2))
    repo.index_settings_files("del_au2", "characters", _make_settings_chunks("Connor.md", n=2))

    info = TaskInfo(
        task_id="t1",
        task_type="delete_settings_chunks",
        au_id="del_au1",
        payload={"file_path": "characters/Connor.md", "collection": "characters"},
    )
    worker_delete_settings_chunks(info, {"vector_repo": repo})

    coll = repo._get_collection("characters")
    # del_au1 的已删除，del_au2 的保留
    au1_remaining = coll.get(where={"au_id": "del_au1"}, include=[])
    au2_remaining = coll.get(where={"au_id": "del_au2"}, include=[])
    assert len(au1_remaining["ids"]) == 0
    assert len(au2_remaining["ids"]) == 2


def test_settings_files_cleanup_handles_none_metadatas():
    """兼容部分 Chroma 返回 metadatas=None 的情况。"""
    client = MagicMock()
    collection = MagicMock()
    collection.get.return_value = {
        "ids": ["au1_characters_Connor_0", "au2_characters_Connor_0"],
        "metadatas": None,
    }
    client.get_or_create_collection.return_value = collection

    repo = LocalChromaVectorRepository(client, _mock_embedding_provider())
    repo.index_settings_files("au1", "characters", _make_settings_chunks("Connor.md", n=1))

    collection.delete.assert_called_once_with(ids=["au1_characters_Connor_0"])


def test_worker_delete_settings_chunks_handles_none_metadatas():
    """worker 在 metadatas=None 时仍应按 AU 前缀删除。"""
    collection = MagicMock()
    collection.get.return_value = {
        "ids": ["au1_characters_Connor_0", "au2_characters_Connor_0"],
        "metadatas": None,
    }
    vector_repo = MagicMock()
    vector_repo._get_collection.return_value = collection

    info = TaskInfo(
        task_id="t2",
        task_type="delete_settings_chunks",
        au_id="au1",
        payload={"file_path": "characters/Connor.md", "collection": "characters"},
    )
    worker_delete_settings_chunks(info, {"vector_repo": vector_repo})

    collection.delete.assert_called_once_with(ids=["au1_characters_Connor_0"])
