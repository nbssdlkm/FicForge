# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""Embedding Provider 抽象接口 + OpenAI 兼容实现。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

import httpx


class EmbeddingProvider(ABC):
    """Embedding 提供者抽象接口。"""

    @abstractmethod
    def embed(self, texts: list[str]) -> list[list[float]]:
        """批量文本 → 向量列表。"""
        ...


class OpenAICompatibleEmbeddingProvider(EmbeddingProvider):
    """OpenAI 兼容 Embedding API。"""

    def __init__(self, api_base: str, api_key: str, model: str) -> None:
        self._api_base = api_base.rstrip("/")
        self._api_key = api_key
        self._model = model

    def embed(self, texts: list[str]) -> list[list[float]]:
        url = f"{self._api_base}/v1/embeddings"
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        body: dict[str, Any] = {
            "model": self._model,
            "input": texts,
        }

        timeout = httpx.Timeout(connect=10.0, read=60.0, write=60.0, pool=60.0)
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(url, json=body, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        # data.data[i].embedding
        embeddings: list[dict[str, Any]] = data.get("data", [])
        return [item["embedding"] for item in sorted(embeddings, key=lambda x: x.get("index", 0))]
