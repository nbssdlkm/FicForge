"""ChromaDB 客户端初始化。D-0013: 必须开启 WAL 模式。"""

from __future__ import annotations

import logging
import sqlite3
from pathlib import Path
from typing import Any

import chromadb
from chromadb.config import Settings as ChromaSettings

logger = logging.getLogger(__name__)


def _enable_wal(persist_dir: Path) -> None:
    """D-0013: 显式将 ChromaDB 底层 SQLite 设为 WAL 模式。

    WAL 模式允许后台重建索引时用户仍可正常执行 RAG 检索（并发读不阻塞写）。
    """
    db_path = persist_dir / "chroma.sqlite3"
    if not db_path.exists():
        return
    try:
        conn = sqlite3.connect(str(db_path))
        conn.execute("PRAGMA journal_mode=WAL")
        conn.close()
    except Exception as exc:
        logger.warning("无法设置 ChromaDB WAL 模式: %s", exc)


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
    # D-0013: 初始化后显式启用 WAL 模式
    _enable_wal(persist_dir)
    return client
