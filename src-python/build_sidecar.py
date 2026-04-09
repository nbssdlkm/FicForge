"""PyInstaller 打包脚本（精简版 — 仅 embedding 服务）。

用法：cd src-python && python build_sidecar.py
产物：dist/fanfic-sidecar/
"""

from __future__ import annotations

import platform
import subprocess
import sys


def build() -> None:
    """执行 PyInstaller 打包。"""
    cmd = [
        sys.executable, "-m", "PyInstaller",
        "--onedir",
        "--name", "fanfic-sidecar",
        "--noconfirm",
        "--clean",
        # fastembed（本地 Embedding，BAAI/bge-small-zh）
        "--collect-all", "fastembed",
        "--hidden-import", "fastembed",
        # ONNX Runtime（fastembed 依赖）
        "--collect-all", "onnxruntime",
        # pydantic
        "--hidden-import", "pydantic",
        "--collect-all", "pydantic",
        # uvicorn workers
        "--hidden-import", "uvicorn.logging",
        "--hidden-import", "uvicorn.protocols.http.auto",
        "--hidden-import", "uvicorn.protocols.websockets.auto",
        "--hidden-import", "uvicorn.lifespan.on",
        # 入口
        "main_embedding.py",
    ]

    print(f"Building embedding sidecar for {platform.system()} {platform.machine()}")
    print(f"Command: {' '.join(cmd[:8])}...")
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        print(f"PyInstaller failed with code {result.returncode}")
        sys.exit(result.returncode)
    print("Build complete: dist/fanfic-sidecar/")


if __name__ == "__main__":
    build()
