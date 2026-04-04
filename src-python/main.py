"""FastAPI sidecar 入口。

Tauri 桌面端通过 sidecar 方式启动本进程。
启动后向 stdout 输出 [SIDECAR_PORT_READY:{port}] 握手信号。
参见 PRD §2.6.7。
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from infra.logging_config import setup_logging

from api.routes.chapters import router as chapters_router
from api.routes.drafts import router as drafts_router
from api.routes.facts import router as facts_router
from api.routes.fandoms import router as fandoms_router
from api.routes.generate import router as generate_router
from api.routes.project import router as project_router
from api.routes.settings import router as settings_router
from api.routes.state import router as state_router
from api.routes.lore import router as lore_router
from api.routes.import_export import router as import_export_router
from api.routes.trash import router as trash_router
from api.routes.settings_chat import router as settings_chat_router

# ---------------------------------------------------------------------------
# 动态端口（启动后通过 stdout 通知 Tauri）
# ---------------------------------------------------------------------------
_sidecar_port: int = 0


def _get_free_port() -> int:
    """开发模式默认绑定 54284 方便前端调试。生产环境使用随机可用端口。"""
    v = os.environ.get("PORT", "")
    if v:
        return int(v)
    if getattr(sys, "frozen", False):
        # 生产环境：让 OS 分配空闲端口
        import socket
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(("127.0.0.1", 0))
            return s.getsockname()[1]
    return 54284  # 开发模式固定端口


# ---------------------------------------------------------------------------
# App 工厂
# ---------------------------------------------------------------------------
def create_app() -> FastAPI:
    """创建 FastAPI 应用实例。"""

    application = FastAPI(
        title="FicForge Backend",
        version="0.1.2",
    )

    # CORS —— 本地模式 allow_origins=["*"]
    application.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # -----------------------------------------------------------------------
    # 统一错误响应中间件（D-0019）
    # 格式: {"error_code": "...", "message": "...", "actions": [...]}
    # -----------------------------------------------------------------------
    _log = logging.getLogger("api.error")

    @application.exception_handler(Exception)
    async def _general_exception_handler(
        request: Request, exc: Exception
    ) -> JSONResponse:
        _log.exception("Unhandled error: %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content={
                "error_code": "INTERNAL_ERROR",
                "message": "服务器内部错误",
                "actions": [],
            },
        )

    from starlette.exceptions import HTTPException as StarletteHTTPException

    @application.exception_handler(StarletteHTTPException)
    async def _http_exception_handler(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error_code": f"HTTP_{exc.status_code}",
                "message": str(exc.detail),
                "actions": [],
            },
        )

    from fastapi.exceptions import RequestValidationError

    @application.exception_handler(RequestValidationError)
    async def _validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "error_code": "VALIDATION_ERROR",
                "message": str(exc),
                "actions": [],
            },
        )

    # -----------------------------------------------------------------------
    # 路由
    # -----------------------------------------------------------------------
    @application.get("/health")
    async def health_check() -> dict[str, str]:
        """健康检查端点，用于 Tauri sidecar 启动握手。"""
        return {"status": "ok"}

    application.include_router(generate_router)
    application.include_router(chapters_router)
    application.include_router(drafts_router)
    application.include_router(facts_router)
    application.include_router(fandoms_router)
    application.include_router(project_router)
    application.include_router(settings_router)
    application.include_router(state_router)
    application.include_router(lore_router)
    application.include_router(import_export_router)
    application.include_router(trash_router)
    application.include_router(settings_chat_router)

    return application


app = create_app()


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    # 清除代理环境变量：sidecar 直连 LLM API，不走系统代理
    for _pv in ("ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy",
                "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy"):
        os.environ.pop(_pv, None)

    # 日志初始化（文件 + 终端）
    # PyInstaller: sys.executable 指向二进制本体，__file__ 指向 _internal/ 内部
    # 开发模式: sys.executable 是 python3，__file__ 指向 main.py
    if getattr(sys, "frozen", False):
        _app_dir = Path(sys.executable).resolve().parent
        # 生产模式：将 CWD 设为 sidecar 所在目录，确保 ./fandoms 等相对路径正确
        os.chdir(_app_dir)
    else:
        _app_dir = Path(__file__).resolve().parent
    _default_data = _app_dir / "fandoms"
    data_dir = Path(os.environ.get("FANFIC_DATA_DIR", str(_default_data)))
    setup_logging(data_dir)

    logger = logging.getLogger(__name__)

    _sidecar_port = _get_free_port()

    # PRD §2.6.7: 启动后向 stdout 打印握手信号
    # PYTHONUNBUFFERED=1 + flush=True 双保险确保无缓冲
    print(f"[SIDECAR_PORT_READY:{_sidecar_port}]", flush=True)

    logger.info("Sidecar starting on port %d", _sidecar_port)

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=_sidecar_port,
        log_level="warning",
    )
