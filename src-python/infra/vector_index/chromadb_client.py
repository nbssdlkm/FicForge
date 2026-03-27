"""ChromaDB 客户端初始化。D-0013: 必须开启 WAL 模式。"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import chromadb
from chromadb.config import Settings as ChromaSettings


def init_chromadb(persist_dir: Path) -> Any:
    """初始化 ChromaDB 持久化客户端。

    Args:
        persist_dir: 持久化目录路径。

    Returns:
        chromadb.ClientAPI 实例。
    """
    persist_dir.mkdir(parents=True, exist_ok=True)
    client: Any = chromadb.PersistentClient(
        path=str(persist_dir),
        settings=ChromaSettings(anonymized_telemetry=False),
    )
    return client
