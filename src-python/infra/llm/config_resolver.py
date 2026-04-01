"""LLM 配置解析 + 参数加载链 + Provider 工厂。参见 PRD §2.3.1。"""

from __future__ import annotations

import os
from typing import Any, Optional

from infra.llm.local_provider import LocalLLMProvider
from infra.llm.ollama_provider import OllamaProvider
from infra.llm.openai_compatible import OpenAICompatibleProvider
from infra.llm.provider import LLMProvider


# ---------------------------------------------------------------------------
# resolve_llm_config（三层模型配置）
# ---------------------------------------------------------------------------

def resolve_llm_config(
    session_llm: Optional[dict[str, Any]],
    project: Any,
    settings: Any,
) -> dict[str, str]:
    """解析 LLM 配置（PRD §2.3.1 三层优先级）。

    优先级：session_llm > project.llm > settings.default_llm。
    API Key：环境变量 > 配置字段 > 空。

    Returns:
        {"mode": str, "model": str, "api_base": str, "api_key": str}
    """
    # 第 1 层：session_llm
    if session_llm and session_llm.get("model"):
        cfg = dict(session_llm)
    else:
        # 第 2 层：project.llm
        p_llm = getattr(project, "llm", None)
        if p_llm and getattr(p_llm, "model", ""):
            cfg = _llm_obj_to_dict(p_llm)
        else:
            # 第 3 层：settings.default_llm
            s_llm = getattr(settings, "default_llm", None)
            cfg = _llm_obj_to_dict(s_llm) if s_llm else {}

    # 确保必要字段
    cfg.setdefault("mode", "api")
    cfg.setdefault("model", "")
    cfg.setdefault("api_base", "")
    cfg.setdefault("api_key", "")

    # 枚举值 → 字符串
    mode = cfg["mode"]
    if hasattr(mode, "value"):
        cfg["mode"] = mode.value

    # 掩码 api_key 防御：前端 GET 返回的 key 形如 ****xxxx，
    # 如果被误传入 session_llm，回退到 settings 的真实 key。
    api_key = cfg.get("api_key", "")
    if api_key.startswith("****") or not api_key:
        s_llm = getattr(settings, "default_llm", None)
        real_key = getattr(s_llm, "api_key", "") if s_llm else ""
        if real_key and not real_key.startswith("****"):
            cfg["api_key"] = real_key

    # API Key 优先级：环境变量 > 配置字段
    env_key = os.environ.get("FANFIC_LLM_API_KEY", "")
    if env_key:
        cfg["api_key"] = env_key

    return cfg


def _llm_obj_to_dict(llm: Any) -> dict[str, str]:
    """将 LLMConfig 领域对象转为 dict。"""
    mode = getattr(llm, "mode", "api")
    if hasattr(mode, "value"):
        mode = mode.value
    return {
        "mode": str(mode),
        "model": getattr(llm, "model", "") or "",
        "api_base": getattr(llm, "api_base", "") or "",
        "api_key": getattr(llm, "api_key", "") or "",
    }


# ---------------------------------------------------------------------------
# resolve_llm_params（四层参数加载链）
# ---------------------------------------------------------------------------

def resolve_llm_params(
    model_name: str,
    session_params: Optional[dict[str, Any]],
    project: Any,
    settings: Any,
) -> dict[str, float]:
    """解析 LLM 参数（PRD §2.3.1 参数加载链）。

    优先级：session_params > project.model_params_override > settings.model_params > 硬编码默认。

    Returns:
        {"temperature": float, "top_p": float}
    """
    defaults: dict[str, float] = {"temperature": 1.0, "top_p": 0.95}

    # 第 1 层：session_params
    if session_params:
        return {
            "temperature": float(session_params.get("temperature", defaults["temperature"])),
            "top_p": float(session_params.get("top_p", defaults["top_p"])),
        }

    # 第 2 层：project.model_params_override
    overrides = getattr(project, "model_params_override", {}) or {}
    if model_name in overrides:
        o = overrides[model_name]
        if isinstance(o, dict):
            return {
                "temperature": float(o.get("temperature", defaults["temperature"])),
                "top_p": float(o.get("top_p", defaults["top_p"])),
            }

    # 第 3 层：settings.model_params
    model_params = getattr(settings, "model_params", {}) or {}
    if model_name in model_params:
        mp = model_params[model_name]
        t = getattr(mp, "temperature", None) or defaults["temperature"]
        p = getattr(mp, "top_p", None) or defaults["top_p"]
        if isinstance(mp, dict):
            t = mp.get("temperature", defaults["temperature"])
            p = mp.get("top_p", defaults["top_p"])
        return {"temperature": float(t), "top_p": float(p)}

    # 第 4 层：硬编码默认
    return dict(defaults)


# ---------------------------------------------------------------------------
# create_provider（工厂函数）
# ---------------------------------------------------------------------------

def create_provider(llm_config: dict[str, str]) -> LLMProvider:
    """根据 mode 创建对应的 LLMProvider。"""
    mode = llm_config.get("mode", "api")

    if mode == "api":
        return OpenAICompatibleProvider(
            api_base=llm_config.get("api_base", ""),
            api_key=llm_config.get("api_key", ""),
            model=llm_config.get("model", ""),
        )
    elif mode == "local":
        return LocalLLMProvider()
    elif mode == "ollama":
        return OllamaProvider()
    else:
        raise ValueError(f"不支持的 LLM mode: {mode}")
