"""PyInstaller 打包脚本。

用法：cd src-python && python build_sidecar.py
产物：dist/fanfic-sidecar/

参见 PRD §2.6.7, D-0012。
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
        # ChromaDB — C++ 扩展 + 数据文件
        "--collect-all", "chromadb",
        "--collect-all", "chroma_hnswlib",
        # tiktoken — tokenizer 数据文件
        "--collect-all", "tiktoken",
        "--collect-all", "tiktoken_ext",
        "--hidden-import", "tiktoken_ext.openai_public",
        "--hidden-import", "tiktoken_ext",
        # ONNX Runtime（ChromaDB embedding 依赖）
        "--collect-all", "onnxruntime",
        # OpenAI / httpx
        "--hidden-import", "openai",
        "--hidden-import", "httpx",
        "--hidden-import", "httpx._transports",
        "--hidden-import", "httpx._transports.default",
        # python-frontmatter（数据文件）
        "--collect-all", "frontmatter",
        # python-docx（模板 + 数据）
        "--collect-all", "docx",
        # pyyaml（C 扩展 + 数据）
        "--collect-all", "yaml",
        # pydantic
        "--hidden-import", "pydantic",
        "--collect-all", "pydantic",
        # uvicorn workers
        "--hidden-import", "uvicorn.logging",
        "--hidden-import", "uvicorn.protocols.http.auto",
        "--hidden-import", "uvicorn.protocols.websockets.auto",
        "--hidden-import", "uvicorn.lifespan.on",
        # python-multipart（FastAPI UploadFile）
        "--hidden-import", "multipart",
        "--collect-all", "multipart",
        # 入口
        "main.py",
    ]

    print(f"Building sidecar for {platform.system()} {platform.machine()}")
    print(f"Command: {' '.join(cmd[:8])}...")
    result = subprocess.run(cmd, check=False)
    if result.returncode != 0:
        print(f"PyInstaller failed with code {result.returncode}")
        sys.exit(result.returncode)
    print("Build complete: dist/fanfic-sidecar/")


if __name__ == "__main__":
    build()
