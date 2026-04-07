# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""Local Embedding Provider — fastembed + BAAI/bge-small-zh-v1.5。

零配置开箱即用：首次调用时自动下载 ONNX 模型（~24MB）到本地缓存。
"""

from __future__ import annotations

import logging
from typing import Optional

from infra.embeddings.provider import EmbeddingProvider

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "BAAI/bge-small-zh-v1.5"


class LocalEmbeddingProvider(EmbeddingProvider):
    """基于 fastembed 的本地 Embedding。CPU 即可运行，无需 GPU。"""

    def __init__(self, model_name: Optional[str] = None) -> None:
        self._model_name = model_name or DEFAULT_MODEL
        self._model = None  # lazy init

    def _get_model(self):
        if self._model is None:
            from fastembed import TextEmbedding

            logger.info("Loading embedding model: %s", self._model_name)
            self._model = TextEmbedding(self._model_name)
            logger.info("Embedding model loaded successfully")
        return self._model

    def embed(self, texts: list[str]) -> list[list[float]]:
        model = self._get_model()
        results = list(model.embed(texts))
        return [r.tolist() for r in results]
