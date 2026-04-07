# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""Embedding 适配层。"""

from infra.embeddings.provider import EmbeddingProvider, OpenAICompatibleEmbeddingProvider

__all__ = [
    "EmbeddingProvider",
    "OpenAICompatibleEmbeddingProvider",
]
