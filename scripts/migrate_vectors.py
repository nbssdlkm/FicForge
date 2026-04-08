#!/usr/bin/env python3
# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.

"""ChromaDB → JSON 分片迁移脚本。

将现有 .chromadb/ 目录中的向量数据导出为 .vectors/ JSON 分片格式，
供 TypeScript 向量引擎加载。

用法：
    python scripts/migrate_vectors.py --au-path /path/to/au

输出目录：
    {au-path}/.vectors/
        chapters/ch0001_0.json, ...
        characters/Connor_0.json, ...
        worldbuilding/...
        index.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path


def migrate_au(au_path: str) -> None:
    """迁移单个 AU 的向量数据。"""
    au_dir = Path(au_path)
    chromadb_dir = au_dir / ".chromadb"

    if not chromadb_dir.exists():
        print(f"[SKIP] No .chromadb/ found in {au_path}")
        return

    # 初始化 ChromaDB 客户端
    try:
        import chromadb
    except ImportError:
        print("ERROR: chromadb package not installed. Run: pip install chromadb")
        sys.exit(1)

    client = chromadb.PersistentClient(path=str(chromadb_dir))

    vectors_dir = au_dir / ".vectors"
    vectors_dir.mkdir(exist_ok=True)

    collections = ["chapters", "characters", "worldbuilding"]
    index_entries: list[dict] = []
    total_chunks = 0
    dimension = 0

    for coll_name in collections:
        try:
            collection = client.get_collection(coll_name)
        except Exception:
            print(f"  [SKIP] Collection '{coll_name}' not found")
            continue

        # 获取所有数据
        result = collection.get(include=["documents", "embeddings", "metadatas"])
        if not result["ids"]:
            continue

        coll_dir = vectors_dir / coll_name
        coll_dir.mkdir(exist_ok=True)

        ids = result["ids"]
        docs = result["documents"] or [""] * len(ids)
        embeddings = result["embeddings"] or [[] for _ in ids]
        metadatas = result["metadatas"] or [{} for _ in ids]

        for i, chunk_id in enumerate(ids):
            embedding = embeddings[i] if embeddings[i] is not None else []
            metadata = metadatas[i] if metadatas[i] is not None else {}

            if dimension == 0 and len(embedding) > 0:
                dimension = len(embedding)

            # 构建 JSON chunk
            chunk_data = {
                "id": chunk_id,
                "collection": coll_name,
                "content": docs[i] if docs[i] else "",
                "embedding": embedding,
                "metadata": {
                    "au_id": metadata.get("au_id", ""),
                    "chapter": metadata.get("chapter"),
                    "chunk_index": metadata.get("chunk_index", i),
                    "branch_id": metadata.get("branch_id", "main"),
                    "characters": metadata.get("characters", ""),
                    "source_file": metadata.get("source_file", ""),
                },
            }

            # 安全文件名
            safe_id = chunk_id.replace("/", "_").replace("\\", "_")
            filename = f"{safe_id}.json"
            filepath = coll_dir / filename
            filepath.write_text(
                json.dumps(chunk_data, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            index_entries.append({
                "id": chunk_id,
                "file": f"{coll_name}/{filename}",
                "chapter": metadata.get("chapter"),
                "characters": (
                    [c.strip() for c in metadata.get("characters", "").split(",") if c.strip()]
                    if metadata.get("characters")
                    else []
                ),
            })
            total_chunks += 1

        print(f"  [{coll_name}] Exported {len(ids)} chunks")

    # 写入 index.json
    index = {
        "model": "",
        "dimension": dimension,
        "total_chunks": total_chunks,
        "chunks": index_entries,
    }
    index_path = vectors_dir / "index.json"
    index_path.write_text(
        json.dumps(index, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"\n[DONE] Migrated {total_chunks} chunks (dimension={dimension})")
    print(f"       Output: {vectors_dir}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Migrate ChromaDB vectors to JSON shard format"
    )
    parser.add_argument(
        "--au-path",
        required=True,
        help="Path to the AU directory containing .chromadb/",
    )
    args = parser.parse_args()
    migrate_au(args.au_path)


if __name__ == "__main__":
    main()
