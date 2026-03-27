"""LLM Provider 抽象接口 + 数据结构。参见 PRD §2.3、§4.2。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Iterator, Optional, Union


# ---------------------------------------------------------------------------
# 数据结构
# ---------------------------------------------------------------------------

@dataclass
class LLMResponse:
    """非流式生成结果。"""

    content: str
    model: str
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    finish_reason: str = "stop"
    raw_response: Optional[dict[str, object]] = None


@dataclass
class LLMChunk:
    """流式生成的单个增量片段。"""

    delta: str
    is_final: bool = False
    input_tokens: Optional[int] = None
    output_tokens: Optional[int] = None
    finish_reason: Optional[str] = None


# ---------------------------------------------------------------------------
# 错误
# ---------------------------------------------------------------------------

@dataclass
class LLMError(Exception):
    """LLM 调用错误（PRD §4.2 错误表，D-0019 统一格式）。"""

    error_code: str
    message: str
    actions: list[str] = field(default_factory=list)
    status_code: Optional[int] = None

    def __str__(self) -> str:
        return f"[{self.error_code}] {self.message}"


# ---------------------------------------------------------------------------
# 抽象接口
# ---------------------------------------------------------------------------

class LLMProvider(ABC):
    """LLM 提供者抽象接口。"""

    @abstractmethod
    def generate(
        self,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float,
        top_p: float,
        stream: bool = False,
    ) -> Union[LLMResponse, Iterator[LLMChunk]]:
        """调用大模型生成。

        非流式：返回 LLMResponse。
        流式：返回 Iterator[LLMChunk]（Python generator）。
        """
        ...
