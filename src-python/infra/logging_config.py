# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""日志配置。

同时输出到终端和文件，日志文件按天轮转，保留 30 天。
"""

from __future__ import annotations

import logging
import sys
import threading
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

_lock = threading.Lock()
_initialized = False


def setup_logging(data_dir: Path, level: str = "INFO") -> None:
    """配置全局日志。

    - 终端输出：INFO 及以上
    - 文件输出：{data_dir}/logs/app.log，按天轮转，保留 30 天
    - 幂等 + 线程安全：重复调用不会叠加 handler
    """
    global _initialized
    with _lock:
        if _initialized:
            return
        _initialized = True

        fmt = logging.Formatter(
            "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

        root = logging.getLogger()
        root.setLevel(getattr(logging, level.upper(), logging.INFO))

        # 终端 handler
        console = logging.StreamHandler(sys.stderr)
        console.setLevel(logging.INFO)
        console.setFormatter(fmt)
        root.addHandler(console)

        # 文件 handler — 按天轮转，保留 30 份
        try:
            log_dir = data_dir / "logs"
            log_dir.mkdir(parents=True, exist_ok=True)
            log_file = log_dir / "app.log"

            file_handler = TimedRotatingFileHandler(
                log_file,
                when="midnight",
                interval=1,
                backupCount=30,
                encoding="utf-8",
            )
            file_handler.suffix = "%Y-%m-%d"
            file_handler.setLevel(logging.DEBUG)
            file_handler.setFormatter(fmt)
            root.addHandler(file_handler)
        except OSError as exc:
            print(f"[WARNING] 无法创建日志文件: {exc}", file=sys.stderr)

        # 降低第三方噪声
        for name in ("uvicorn", "uvicorn.access", "chromadb", "httpx", "openai"):
            logging.getLogger(name).setLevel(logging.WARNING)
