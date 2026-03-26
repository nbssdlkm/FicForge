"""生成流式端点骨架。

D-0018: 流式传输使用 SSE（Server-Sent Events）。
实际生成逻辑不在本任务范围内。
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/api/v1", tags=["generate"])


@router.get("/generate/stream")
async def generate_stream() -> StreamingResponse:
    """SSE 流式生成端点骨架。

    Phase 1 占位实现，不包含实际 LLM 调用逻辑。
    """

    async def _event_generator():
        yield "data: {\"type\": \"placeholder\", \"content\": \"SSE endpoint not implemented\"}\n\n"

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        },
    )
