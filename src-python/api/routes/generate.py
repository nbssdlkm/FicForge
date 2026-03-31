"""生成流式端点。D-0018: SSE 流式传输。"""

from __future__ import annotations

import json
from typing import Any, Optional

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from api import clear_generating, mark_generating, validate_path

router = APIRouter(prefix="/api/v1", tags=["generate"])


class GenerateRequest(BaseModel):
    """生成请求体。"""

    au_path: str
    chapter_num: int
    user_input: str = ""
    input_type: str = "continue"  # "continue" | "instruction"
    session_llm: Optional[dict[str, Any]] = None
    session_params: Optional[dict[str, Any]] = None


from api import (
    build_chapter_repository,
    build_draft_repository,
    build_fact_repository,
    build_project_repository,
    build_settings_repository,
    build_state_repository,
)
from core.services.generation import generate_chapter
from pathlib import Path

import logging

logger = logging.getLogger(__name__)


@router.post("/generate/stream")
async def generate_stream(request: GenerateRequest) -> StreamingResponse:
    """SSE 流式生成端点。"""
    logger.info("Generate stream: au=%s ch=%d type=%s", request.au_path, request.chapter_num, request.input_type)
    if not validate_path(request.au_path):
        async def _error_gen():
            yield 'event: error\ndata: {"error_code": "INVALID_PATH", "message": "路径不合法", "actions": []}\n\n'
        return StreamingResponse(_error_gen(), media_type="text/event-stream")

    async def _event_generator() -> Any:
        au_id = request.au_path
        mark_generating(au_id)
        try:
            au_dir = Path(au_id)

            # Build repositories
            project_repo = build_project_repository()
            state_repo = build_state_repository()
            settings_repo = build_settings_repository()
            fact_repo = build_fact_repository()
            chapter_repo = build_chapter_repository()
            draft_repo = build_draft_repository()

            # Load entities
            project = await run_in_threadpool(project_repo.get, au_id)
            state = await run_in_threadpool(state_repo.get, au_id)
            settings = await run_in_threadpool(settings_repo.get)
            facts = await run_in_threadpool(fact_repo.list_all, au_id)

            stream = generate_chapter(
                au_path=au_dir,
                chapter_num=request.chapter_num,
                user_input=request.user_input,
                input_type=request.input_type,
                session_llm=request.session_llm,
                session_params=request.session_params,
                project=project,
                state=state,
                settings=settings,
                facts=facts,
                chapter_repo=chapter_repo,
                draft_repo=draft_repo,
            )

            # 将同步迭代器的阻塞 next() 放到线程池，防止卡住事件循环
            it = iter(stream)
            while True:
                event = await run_in_threadpool(next, it, None)
                if event is None:
                    break
                yield f"event: {event['event']}\ndata: {json.dumps(event['data'], ensure_ascii=False)}\n\n"

        except Exception as e:
            logger.exception("Generate stream failed: au=%s ch=%d", request.au_path, request.chapter_num)
            error_data = {"error_code": "GENERATION_FAILED", "message": str(e), "actions": []}
            yield f"event: error\ndata: {json.dumps(error_data, ensure_ascii=False)}\n\n"
        finally:
            clear_generating(au_id)

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
