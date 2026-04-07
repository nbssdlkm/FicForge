# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""模型 Context Window 映射 + 输出上限查询。参见 PRD §2.5、§4.1。"""

from __future__ import annotations

from typing import Any

# ---------------------------------------------------------------------------
# Context Window 映射表（PRD §2.5）
# ---------------------------------------------------------------------------

MODEL_CONTEXT_MAP: dict[str, int] = {
    "deepseek-chat": 65_536,
    "deepseek-reasoner": 65_536,
    "claude-3-5-sonnet": 200_000,
    "claude-3-7-sonnet": 200_000,
    "claude-sonnet-4-6": 200_000,
    "gpt-4o": 128_000,
    "gpt-4-turbo": 128_000,
    "gemini-1.5-pro": 1_000_000,
    "gemini-2.0-flash": 1_000_000,
    "qwen-long": 1_000_000,
    "qwen-max": 32_768,
    "llama3": 131_072,
    "llama3.1": 131_072,
}

DEFAULT_CONTEXT_WINDOW: int = 32_000  # 未知模型的保守默认值

# ---------------------------------------------------------------------------
# 模型输出上限映射表（PRD §4.1）
# ---------------------------------------------------------------------------

MODEL_MAX_OUTPUT: dict[str, int] = {
    "deepseek-chat": 8_192,
    "deepseek-reasoner": 8_192,
    "claude-3-5-sonnet": 8_192,
    "claude-3-7-sonnet": 8_192,
    "claude-sonnet-4-6": 8_192,
    "gpt-4o": 4_096,
    "gpt-4-turbo": 4_096,
    "qwen-max": 8_192,
}

DEFAULT_MAX_OUTPUT: int = 4_096  # 未知模型保守默认值


# ---------------------------------------------------------------------------
# 模糊匹配辅助
# ---------------------------------------------------------------------------

def _fuzzy_lookup(model_name: str, table: dict[str, int], default: int) -> int:
    """优先精确匹配，然后尝试前缀匹配（如 "deepseek-chat-v2" → "deepseek-chat"）。"""
    if model_name in table:
        return table[model_name]

    # 前缀匹配：按 key 长度降序（最长前缀优先）
    for key in sorted(table, key=len, reverse=True):
        if model_name.startswith(key):
            return table[key]

    return default


# ---------------------------------------------------------------------------
# 公共 API
# ---------------------------------------------------------------------------

def get_context_window(project: Any) -> int:
    """获取 context window 大小（PRD §2.5 三层优先级）。

    1. project.llm.context_window 手动填写（> 0）
    2. MODEL_CONTEXT_MAP 根据 model 名称查找（支持模糊匹配）
    3. DEFAULT_CONTEXT_WINDOW (32000)
    """
    # 第 1 层：手动填写
    cw = getattr(getattr(project, "llm", None), "context_window", 0)
    if isinstance(cw, int) and cw > 0:
        return cw

    # 第 2 层：映射表
    model = getattr(getattr(project, "llm", None), "model", "")
    if isinstance(model, str) and model:
        return _fuzzy_lookup(model, MODEL_CONTEXT_MAP, DEFAULT_CONTEXT_WINDOW)

    # 第 3 层：默认值
    return DEFAULT_CONTEXT_WINDOW


def get_model_max_output(model_name: str) -> int:
    """获取模型单次输出 token 上限（PRD §4.1）。"""
    return _fuzzy_lookup(model_name, MODEL_MAX_OUTPUT, DEFAULT_MAX_OUTPUT)
