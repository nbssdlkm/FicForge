"""FastAPI sidecar 入口。

Tauri 桌面端通过 sidecar 方式启动本进程。
Phase 1 仅提供基础健康检查端点，业务路由在后续任务中添加。
"""

import uvicorn
from fastapi import FastAPI

app = FastAPI(
    title="同人写作辅助系统 - Backend",
    version="0.1.0",
)


@app.get("/health")
async def health_check():
    """健康检查端点，用于 Tauri sidecar 启动握手（T-003 实现）。"""
    return {"status": "ok"}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8765)
