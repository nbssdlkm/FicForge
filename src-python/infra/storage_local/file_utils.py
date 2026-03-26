"""文件操作工具函数。

提供原子写入、时间戳生成、content_hash 计算等公共能力。
"""

from __future__ import annotations

import dataclasses
import hashlib
import tempfile
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any


def now_utc() -> str:
    """返回当前 UTC 时间的 ISO 8601 字符串。"""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def compute_content_hash(content: str) -> str:
    """计算正文的 SHA-256 哈希（D-0011）。

    content 应为剥离 frontmatter 后的纯正文。
    此方法必须暴露给 Service 层调用（confirm/import/dirty resolve 三个路径都需要）。
    """
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def atomic_write(path: Path, content: str) -> None:
    """原子写入文件——先写临时文件再 rename（防半写损坏）。"""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_path_str = tempfile.mkstemp(
        dir=str(path.parent), suffix=".tmp", prefix=f".{path.stem}_"
    )
    tmp_path = Path(tmp_path_str)
    try:
        with open(fd, "w", encoding="utf-8") as f:
            f.write(content)
        tmp_path.replace(path)
    except BaseException:
        tmp_path.unlink(missing_ok=True)
        raise


def dc_to_dict(obj: Any) -> Any:
    """递归将 dataclass 转为纯 dict，处理 Enum → value。

    适用于 YAML 序列化前的转换。
    """
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        result: dict[str, Any] = {}
        for f in dataclasses.fields(obj):
            val = getattr(obj, f.name)
            result[f.name] = dc_to_dict(val)
        return result
    if isinstance(obj, Enum):
        return obj.value
    if isinstance(obj, dict):
        return {k: dc_to_dict(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [dc_to_dict(v) for v in obj]
    return obj
