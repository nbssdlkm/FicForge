"""PyInstaller 打包脚本。

用法：cd src-python && python build_sidecar.py
产物：dist/fanfic-sidecar/

参见 PRD §2.6.7, D-0012。
"""

from __future__ import annotations

import platform
import subprocess
import sys


def _clean_user_data() -> None:
    """打包前清理用户数据，防止 API key 和测试数据泄露到安装包。"""
    from pathlib import Path
    import shutil

    fandoms_dir = Path("fandoms/fandoms")
    settings_file = Path("fandoms/settings.yaml")
    chromadb_dir = Path("fandoms/.chromadb")

    for p in [fandoms_dir, chromadb_dir]:
        if p.is_dir():
            shutil.rmtree(p)
            p.mkdir(parents=True, exist_ok=True)
            print(f"  Cleaned: {p}")

    if settings_file.exists():
        settings_file.unlink()
        print(f"  Cleaned: {settings_file}")


def build() -> None:
    """执行 PyInstaller 打包。"""
    print("Cleaning user data before build...")
    _clean_user_data()
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
        # ONNX Runtime（ChromaDB + fastembed 依赖）
        "--collect-all", "onnxruntime",
        # fastembed（本地 Embedding，BAAI/bge-small-zh）
        "--collect-all", "fastembed",
        "--hidden-import", "fastembed",
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
