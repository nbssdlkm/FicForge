"""Local Embedding Provider 骨架。Phase 1 不实现。"""

from __future__ import annotations

from infra.embeddings.provider import EmbeddingProvider


class LocalEmbeddingProvider(EmbeddingProvider):
    """本地 Embedding（Phase 1 不实现）。"""

    def embed(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError("Local Embedding Provider 尚未实现（Phase 1）")
