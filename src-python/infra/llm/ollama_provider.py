"""Ollama Provider 骨架。Phase 1 不实现。"""

from __future__ import annotations

from typing import Iterator, Union

from infra.llm.provider import LLMChunk, LLMProvider, LLMResponse


class OllamaProvider(LLMProvider):
    """Ollama Provider（Phase 1 不实现）。"""

    def generate(
        self,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float,
        top_p: float,
        stream: bool = False,
    ) -> Union[LLMResponse, Iterator[LLMChunk]]:
        raise NotImplementedError("Ollama Provider 尚未实现（Phase 1）")
