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


@router.post("/generate/stream")
async def generate_stream(request: GenerateRequest) -> StreamingResponse:
    """SSE 流式生成端点。"""

    async def _event_generator() -> Any:
        try:
            au_dir = Path(request.au_path)
            
            # Build repositories
            project_repo = build_project_repository()
            state_repo = build_state_repository()
            settings_repo = build_settings_repository()
            fact_repo = build_fact_repository()
            chapter_repo = build_chapter_repository()
            draft_repo = build_draft_repository()
            
            # Load entities
            au_id = str(au_dir)
            project = await run_in_threadpool(project_repo.get, au_id)
            state = await run_in_threadpool(state_repo.get, au_id)
            settings = await run_in_threadpool(settings_repo.get)
            facts = await run_in_threadpool(fact_repo.list_all, au_id)
            
            # Execute generation service (should be run in background, but the generator yields chunk by chunk)
            # The generation inner loop uses provider.generate(stream=True) which blocks per chunk.
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
            
            for event in stream:
                yield f"event: {event['event']}\ndata: {json.dumps(event['data'], ensure_ascii=False)}\n\n"
                
        except Exception as e:
            error_data = {"error_code": "GENERATION_FAILED", "message": str(e), "actions": []}
            yield f"event: error\ndata: {json.dumps(error_data, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
