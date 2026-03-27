"""Tokenizer 路由 + LRU Cache。参见 PRD §2.4。

三种模式：
- api / ollama → tiktoken cl100k_base
- local → tokenizer.json（若存在）→ tiktoken 降级

fallback：tiktoken 加载失败 → char_mul1.5 估算。
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Token 计数结果
# ---------------------------------------------------------------------------

@dataclass
class TokenCount:
    """count_tokens 的返回值。

    is_estimate=True 表示使用了 char_mul1.5 降级估算，
    T-012 组装器据此在 Context 可视化面板标注 `(预估)`。
    """

    count: int
    is_estimate: bool = False


# ---------------------------------------------------------------------------
# Tokenizer 实例缓存（LRU maxsize=3）
# ---------------------------------------------------------------------------

@lru_cache(maxsize=3)
def _get_tiktoken_encoding(encoding_name: str) -> Any:
    """缓存 tiktoken encoding 实例。"""
    import tiktoken
    return tiktoken.get_encoding(encoding_name)


@lru_cache(maxsize=3)
def _get_local_tokenizer(model_path: str) -> Any:
    """缓存本地 tokenizer 实例（从 tokenizer.json 加载）。"""
    tokenizer_json = Path(model_path) / "tokenizer.json"
    if not tokenizer_json.exists():
        return None

    try:
        from tokenizers import Tokenizer  # noqa: F811
        return Tokenizer.from_file(str(tokenizer_json))
    except ImportError:
        logger.warning("tokenizers 库未安装，local 模式降级为 tiktoken")
        return None
    except Exception as e:
        logger.warning("加载 tokenizer.json 失败: %s，降级为 tiktoken", e)
        return None


def clear_tokenizer_cache() -> None:
    """清空 tokenizer 缓存。"""
    _get_tiktoken_encoding.cache_clear()
    _get_local_tokenizer.cache_clear()


# ---------------------------------------------------------------------------
# 公共 API
# ---------------------------------------------------------------------------

def count_tokens(text: str, llm_config: Any) -> TokenCount:
    """分词器路由（PRD §2.4）。

    Args:
        text: 要计算 token 数的文本。
        llm_config: LLMConfig 或类似对象，需要 mode / model / local_model_path 属性。

    Returns:
        TokenCount(count=N, is_estimate=False/True)。
    """
    if not text:
        return TokenCount(count=0)

    mode = getattr(llm_config, "mode", "api")
    # 枚举值 → 字符串
    if hasattr(mode, "value"):
        mode = mode.value

    # --- local 模式：尝试 tokenizer.json ---
    if mode == "local":
        model_path = getattr(llm_config, "local_model_path", "")
        if model_path:
            tokenizer = _get_local_tokenizer(model_path)
            if tokenizer is not None:
                try:
                    encoded = tokenizer.encode(text)
                    return TokenCount(count=len(encoded.ids))
                except Exception:
                    pass  # 降级到 tiktoken

    # --- api / ollama / local 降级：tiktoken cl100k_base ---
    try:
        enc = _get_tiktoken_encoding("cl100k_base")
        return TokenCount(count=len(enc.encode(text)))
    except Exception:
        pass

    # --- 最终 fallback：char_mul1.5 ---
    return TokenCount(count=int(len(text) * 1.5), is_estimate=True)
