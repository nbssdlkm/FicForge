"""生成流式端点。D-0018: SSE 流式传输。"""

from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

router = APIRouter(prefix="/api/v1", tags=["generate"])


class GenerateRequest(BaseModel):
    """生成请求体。"""

    au_path: str
    chapter_num: int
    user_input: str = ""
    input_type: str = "continue"  # "continue" | "instruction"
    session_llm: Optional[dict[str, Any]] = None
    session_params: Optional[dict[str, Any]] = None


@router.post("/generate/stream")
async def generate_stream(request: GenerateRequest) -> StreamingResponse:
    """SSE 流式生成端点。

    调用 GenerationService 的同步 generator，通过 SSE 推送到前端。
    实际的 project/state/settings/facts/repos 需要在 API 层组装后传入。
    Phase 1 此端点仅作为集成点，完整的依赖注入在后续 API 层任务中完成。
    """

    async def _event_generator() -> Any:
        # Phase 1 占位：完整的依赖注入（读取 project/state/settings/facts/repos）
        # 将在后续 API 路由任务中实现。此处先返回一个提示事件。
        yield f"event: error\ndata: {json.dumps({'error_code': 'NOT_CONFIGURED', 'message': '生成端点尚未完成依赖注入配置'})}\n\n"

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )
