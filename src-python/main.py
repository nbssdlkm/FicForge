"""FastAPI sidecar 入口。

Tauri 桌面端通过 sidecar 方式启动本进程。
启动后向 stdout 输出 [SIDECAR_PORT_READY:{port}] 握手信号。
参见 PRD §2.6.7。
"""

from __future__ import annotations

import os
import socket
import sys

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from api.routes.chapters import router as chapters_router
from api.routes.drafts import router as drafts_router
from api.routes.facts import router as facts_router
from api.routes.fandoms import router as fandoms_router
from api.routes.generate import router as generate_router
from api.routes.project import router as project_router
from api.routes.settings import router as settings_router
from api.routes.state import router as state_router
from api.routes.lore import router as lore_router

# ---------------------------------------------------------------------------
# 动态端口（启动后通过 stdout 通知 Tauri）
# ---------------------------------------------------------------------------
_sidecar_port: int = 0


def _get_free_port() -> int:
    """开发模式默认绑定 54284 方便前端调试。生产环境可恢复为 0"""
    v = os.environ.get("PORT", "54284")
    return int(v)


# ---------------------------------------------------------------------------
# App 工厂
# ---------------------------------------------------------------------------
def create_app() -> FastAPI:
    """创建 FastAPI 应用实例。"""

    application = FastAPI(
        title="同人写作辅助系统 - Backend",
        version="0.1.0",
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
    @application.exception_handler(Exception)
    async def _general_exception_handler(
        request: Request, exc: Exception
    ) -> JSONResponse:
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

    return application


app = create_app()


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    _sidecar_port = _get_free_port()

    # PRD §2.6.7: 启动后向 stdout 打印握手信号
    # PYTHONUNBUFFERED=1 + flush=True 双保险确保无缓冲
    print(f"[SIDECAR_PORT_READY:{_sidecar_port}]", flush=True)

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=_sidecar_port,
        log_level="warning",
    )
