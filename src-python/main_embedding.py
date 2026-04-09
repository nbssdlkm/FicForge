#!/usr/bin/env python3
# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.

"""精简版 Sidecar — 仅提供本地 Embedding 服务。

所有业务逻辑已迁移到 TypeScript 引擎（src-engine/）。
Python sidecar 仅保留本地 embedding 功能（fastembed + BAAI/bge-small-zh）。

Tauri 桌面端通过 sidecar 方式启动本进程。
启动后向 stdout 输出 [SIDECAR_PORT_READY:{port}] 握手信号。
"""

from __future__ import annotations

import logging
import os
import sys
from typing import Optional

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    stream=sys.stderr,
)
logger = logging.getLogger("ficforge-embedding")

# ---------------------------------------------------------------------------
# Embedding Provider
# ---------------------------------------------------------------------------

class EmbeddingProvider:
    """基于 fastembed 的本地 Embedding。CPU 即可运行。"""

    def __init__(self, model_name: str = "BAAI/bge-small-zh-v1.5") -> None:
        self._model_name = model_name
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

    @property
    def model_name(self) -> str:
        return self._model_name

    @property
    def dimension(self) -> int:
        # bge-small-zh: 384 dimensions
        return 384


# ---------------------------------------------------------------------------
# FastAPI App
# ---------------------------------------------------------------------------

app = FastAPI(title="FicForge Embedding Sidecar", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

provider: Optional[EmbeddingProvider] = None


def get_provider() -> EmbeddingProvider:
    global provider
    if provider is None:
        provider = EmbeddingProvider()
    return provider


# ---------------------------------------------------------------------------
# Request / Response Models
# ---------------------------------------------------------------------------

class EmbedRequest(BaseModel):
    texts: list[str]


class EmbedResponse(BaseModel):
    vectors: list[list[float]]
    model: str
    dimension: int


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
async def health():
    return {"status": "ok", "mode": "embedding-only", "version": "0.2.0"}


@app.post("/embed", response_model=EmbedResponse)
async def embed(request: EmbedRequest):
    p = get_provider()
    vectors = p.embed(request.texts)
    return EmbedResponse(
        vectors=vectors,
        model=p.model_name,
        dimension=p.dimension,
    )


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

def main():
    port = int(os.environ.get("SIDECAR_PORT", "54284"))

    # Tauri 握手信号
    print(f"[SIDECAR_PORT_READY:{port}]", flush=True)
    logger.info("Embedding sidecar starting on port %d", port)

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
