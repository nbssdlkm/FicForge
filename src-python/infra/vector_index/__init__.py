# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

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
