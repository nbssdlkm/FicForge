# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""Ollama Embedding Provider 骨架。Phase 1 不实现。"""

from __future__ import annotations

from infra.embeddings.provider import EmbeddingProvider


class OllamaEmbeddingProvider(EmbeddingProvider):
    """Ollama Embedding（Phase 1 不实现）。"""

    def embed(self, texts: list[str]) -> list[list[float]]:
        raise NotImplementedError("Ollama Embedding Provider 尚未实现（Phase 1）")
