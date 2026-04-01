"""设定模式 AI 对话端点。参见 D-0024、D-0029。"""

from __future__ import annotations

import logging
from typing import Any, Literal, Optional

from fastapi import APIRouter
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from api import error_response, validate_path
from infra.llm.provider import LLMError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["settings-chat"])


class SettingsChatRequest(BaseModel):
    base_path: str
    mode: Literal["au", "fandom"]
    messages: list[dict[str, Any]]
    fandom_path: Optional[str] = None
    session_llm: Optional[dict[str, Any]] = None


class ToolCallResponse(BaseModel):
    id: str
    type: str
    function: dict[str, str]


class SettingsChatResponse(BaseModel):
    content: str
    tool_calls: list[dict[str, Any]]


@router.post("/settings-chat", response_model=SettingsChatResponse)
async def settings_chat(request: SettingsChatRequest) -> Any:
    """设定模式 AI 对话端点（非流式）。

    AI 返回自然语言说明 + tool_calls 列表。
    后端不执行 tool_calls，原样返回给前端。
    """
    if not validate_path(request.base_path):
        return error_response(400, "INVALID_PATH", "路径不合法", [])
    if request.fandom_path and not validate_path(request.fandom_path):
        return error_response(400, "INVALID_PATH", "Fandom 路径不合法", [])

    try:
        from core.domain.settings_tools import get_tools_for_mode
        from core.services.settings_chat import build_settings_context, call_settings_llm

        # 1. 组装上下文
        assembled = await run_in_threadpool(
            build_settings_context,
            request.mode,
            request.base_path,
            request.fandom_path,
            request.messages,
        )

        # 2. 获取 tool 集合
        tools = get_tools_for_mode(request.mode)

        # 3. 解析 LLM 配置
        llm_config = _resolve_settings_llm(request)

        if not llm_config.get("model"):
            return error_response(400, "NO_MODEL_CONFIGURED", "未配置 LLM 模型", ["check_settings"])

        # 4. 调用 LLM
        result = await run_in_threadpool(
            call_settings_llm, assembled, tools, llm_config
        )

        return result

    except LLMError as e:
        logger.exception("Settings chat LLM error: %s", e.error_code)
        return error_response(
            e.status_code or 500, e.error_code, e.message, e.actions
        )
    except Exception as e:
        logger.exception("Settings chat failed")
        return error_response(500, "SETTINGS_CHAT_FAILED", str(e), [])


def _resolve_settings_llm(request: SettingsChatRequest) -> dict[str, str]:
    """解析设定模式的 LLM 配置。

    优先级：session_llm > project.llm > settings.default_llm
    """
    if request.session_llm and request.session_llm.get("model"):
        api_key = str(request.session_llm.get("api_key", ""))
        # 掩码 api_key 防御：前端 GET 返回 ****xxxx，不能用来调 API
        if api_key.startswith("****") or not api_key:
            from api import build_settings_repository
            try:
                _s = build_settings_repository().get()
                _k = getattr(getattr(_s, "default_llm", None), "api_key", "")
                if _k and not _k.startswith("****"):
                    api_key = _k
            except Exception:
                pass
        return {
            "mode": str(request.session_llm.get("mode", "api")),
            "model": str(request.session_llm.get("model", "")),
            "api_base": str(request.session_llm.get("api_base", "")),
            "api_key": api_key,
        }

    # fallback: 读 project.yaml
    import yaml
    from pathlib import Path

    project_yaml = Path(request.base_path) / "project.yaml"
    if project_yaml.is_file():
        try:
            raw = yaml.safe_load(project_yaml.read_text(encoding="utf-8")) or {}
            llm = raw.get("llm", {})
            if llm.get("model"):
                return {
                    "mode": str(llm.get("mode", "api")),
                    "model": str(llm.get("model", "")),
                    "api_base": str(llm.get("api_base", "")),
                    "api_key": str(llm.get("api_key", "")),
                }
        except Exception:
            pass

    # fallback: 读 settings.yaml
    from api import build_settings_repository
    try:
        settings = build_settings_repository().get()
        s_llm = getattr(settings, "default_llm", None)
        if s_llm and getattr(s_llm, "model", ""):
            return {
                "mode": str(getattr(s_llm, "mode", "api")),
                "model": str(getattr(s_llm, "model", "")),
                "api_base": str(getattr(s_llm, "api_base", "")),
                "api_key": str(getattr(s_llm, "api_key", "")),
            }
    except Exception:
        pass

    return {"mode": "api", "model": "", "api_base": "", "api_key": ""}
