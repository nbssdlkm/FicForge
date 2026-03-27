"""向量索引基础设施。"""

from infra.vector_index.chromadb_client import init_chromadb
from infra.vector_index.chunker import ChunkData, split_chapter_into_chunks
from infra.vector_index.task_queue import BackgroundTaskQueue, TaskInfo, TaskStatus
from infra.vector_index.vectorize import vectorize_chapter

__all__ = [
    "BackgroundTaskQueue",
    "ChunkData",
    "TaskInfo",
    "TaskStatus",
    "init_chromadb",
    "split_chapter_into_chunks",
    "vectorize_chapter",
]
