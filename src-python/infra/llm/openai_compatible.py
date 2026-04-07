# Copyright (c) 2026 FicForge Contributors
# Licensed under the GNU Affero General Public License v3.0.
# See LICENSE file in the project root for full license text.

"""OpenAI 兼容接口 Provider。适配 DeepSeek / OpenAI / Claude 中转站等。

使用 httpx 库直接打 HTTP 请求（不依赖 openai SDK）。
支持非流式和 SSE 流式两种模式。
"""

from __future__ import annotations

import json
import logging
import time
from typing import Any, Iterator, Union

import httpx

from infra.llm.provider import LLMChunk, LLMError, LLMProvider, LLMResponse

logger = logging.getLogger(__name__)

# 超时设置
_CONNECT_TIMEOUT = 10.0   # 连接超时 10s
_READ_TIMEOUT = 120.0     # 读取超时 120s（长文生成可能很慢）


class OpenAICompatibleProvider(LLMProvider):
    """OpenAI 兼容接口 Provider（Phase 1 核心实现）。"""

    def __init__(self, api_base: str, api_key: str, model: str) -> None:
        self._api_base = api_base.rstrip("/")
        self._api_key = api_key
        self._model = model

    def generate(
        self,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float,
        top_p: float,
        stream: bool = False,
    ) -> Union[LLMResponse, Iterator[LLMChunk]]:
        if stream:
            return self._stream(messages, max_tokens, temperature, top_p)
        return self._non_stream(messages, max_tokens, temperature, top_p)

    # ------------------------------------------------------------------
    # 非流式
    # ------------------------------------------------------------------

    def _non_stream(
        self,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float,
        top_p: float,
    ) -> LLMResponse:
        body: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_p": top_p,
            "stream": False,
        }

        data = self._request_with_retry(body)

        content = ""
        finish_reason = "stop"
        choices = data.get("choices", [])
        if choices:
            choice = choices[0]
            msg = choice.get("message", {})
            content = msg.get("content", "")
            finish_reason = choice.get("finish_reason", "stop") or "stop"

        usage = data.get("usage", {})
        return LLMResponse(
            content=content,
            model=data.get("model", self._model),
            input_tokens=usage.get("prompt_tokens"),
            output_tokens=usage.get("completion_tokens"),
            finish_reason=finish_reason,
            raw_response=data,
        )

    # ------------------------------------------------------------------
    # 流式
    # ------------------------------------------------------------------

    def _stream(
        self,
        messages: list[dict[str, str]],
        max_tokens: int,
        temperature: float,
        top_p: float,
    ) -> Iterator[LLMChunk]:
        body: dict[str, Any] = {
            "model": self._model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_p": top_p,
            "stream": True,
            "stream_options": {"include_usage": True},
        }

        url = f"{self._api_base}/v1/chat/completions"
        headers = self._headers()
        timeout = httpx.Timeout(connect=_CONNECT_TIMEOUT, read=_READ_TIMEOUT,
                                write=_READ_TIMEOUT, pool=_READ_TIMEOUT)

        with httpx.Client(timeout=timeout) as client:
            with client.stream("POST", url, json=body, headers=headers) as resp:
                if resp.status_code != 200:
                    resp.read()
                    self._handle_error(resp.status_code, resp.text)

                for line in resp.iter_lines():
                    if not line.startswith("data: "):
                        continue
                    payload = line[6:]
                    if payload.strip() == "[DONE]":
                        return

                    try:
                        chunk_data = json.loads(payload)
                    except json.JSONDecodeError:
                        continue

                    choices = chunk_data.get("choices", [])
                    delta_text = ""
                    finish = None
                    if choices:
                        delta = choices[0].get("delta", {})
                        delta_text = delta.get("content", "") or ""
                        finish = choices[0].get("finish_reason")

                    usage = chunk_data.get("usage")
                    in_tok = usage.get("prompt_tokens") if usage else None
                    out_tok = usage.get("completion_tokens") if usage else None

                    yield LLMChunk(
                        delta=delta_text,
                        is_final=finish is not None,
                        input_tokens=in_tok,
                        output_tokens=out_tok,
                        finish_reason=finish,
                    )

    # ------------------------------------------------------------------
    # HTTP 请求 + 重试
    # ------------------------------------------------------------------

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }

    def _request_with_retry(self, body: dict[str, Any]) -> dict[str, Any]:
        """非流式请求，内置重试逻辑。

        - 网络超时/5xx：自动重试 1 次
        - 429 限流：自动重试最多 3 次，间隔 1s/2s/4s
        """
        url = f"{self._api_base}/v1/chat/completions"
        headers = self._headers()
        timeout = httpx.Timeout(connect=_CONNECT_TIMEOUT, read=_READ_TIMEOUT,
                                write=_READ_TIMEOUT, pool=_READ_TIMEOUT)

        # 第一次尝试 + 5xx/timeout 重试
        for attempt in range(2):
            try:
                with httpx.Client(timeout=timeout) as client:
                    resp = client.post(url, json=body, headers=headers)

                if resp.status_code == 200:
                    return resp.json()  # type: ignore[no-any-return]

                if resp.status_code == 429:
                    return self._retry_429(url, headers, body, timeout)

                self._handle_error(resp.status_code, resp.text)

            except httpx.TimeoutException:
                if attempt == 0:
                    logger.warning("LLM 请求超时，重试中...")
                    continue
                raise LLMError(
                    error_code="network_error",
                    message="网络异常，请检查连接后重试",
                    actions=["retry"],
                )
            except httpx.HTTPError:
                if attempt == 0:
                    logger.warning("LLM 网络错误，重试中...")
                    continue
                raise LLMError(
                    error_code="network_error",
                    message="网络异常，请检查连接后重试",
                    actions=["retry"],
                )

        # 不应到达这里
        raise LLMError(
            error_code="network_error",
            message="网络异常，请检查连接后重试",
            actions=["retry"],
        )

    def _retry_429(
        self,
        url: str,
        headers: dict[str, str],
        body: dict[str, Any],
        timeout: httpx.Timeout,
    ) -> dict[str, Any]:
        """429 限流重试：最多 3 次，间隔 1s/2s/4s。"""
        delays = [1, 2, 4]
        for i, delay in enumerate(delays):
            logger.warning("429 限流，%ds 后重试 (%d/%d)...", delay, i + 1, len(delays))
            time.sleep(delay)
            try:
                with httpx.Client(timeout=timeout) as client:
                    resp = client.post(url, json=body, headers=headers)
                if resp.status_code == 200:
                    return resp.json()  # type: ignore[no-any-return]
                if resp.status_code != 429:
                    self._handle_error(resp.status_code, resp.text)
            except (httpx.TimeoutException, httpx.HTTPError):
                continue

        raise LLMError(
            error_code="rate_limited",
            message="请求过于频繁",
            actions=["retry", "switch_model"],
            status_code=429,
        )

    # ------------------------------------------------------------------
    # 错误分类（PRD §4.2 错误表）
    # ------------------------------------------------------------------

    @staticmethod
    def _handle_error(status_code: int, body_text: str) -> None:
        """根据 HTTP 状态码 + body 关键词分类错误。"""
        lower = body_text.lower()

        if status_code == 401:
            raise LLMError(
                error_code="invalid_api_key",
                message="API 密钥无效或已过期",
                actions=["check_settings"],
                status_code=401,
            )

        if status_code == 429:
            raise LLMError(
                error_code="rate_limited",
                message="请求过于频繁",
                actions=["retry", "switch_model"],
                status_code=429,
            )

        if status_code in (402, 403):
            if any(kw in lower for kw in ("billing", "quota", "insufficient", "balance")):
                raise LLMError(
                    error_code="insufficient_balance",
                    message="API 余额不足",
                    actions=["recharge", "switch_model", "change_key"],
                    status_code=status_code,
                )
            if any(kw in lower for kw in ("safety", "flagged", "content_filter", "moderation")):
                raise LLMError(
                    error_code="content_filtered",
                    message="生成被模型安全策略拦截",
                    actions=["modify_input", "switch_model"],
                    status_code=status_code,
                )

        if status_code == 400:
            if any(kw in lower for kw in ("length", "context_length", "too long", "token")):
                raise LLMError(
                    error_code="context_length_exceeded",
                    message="输入超出模型最大处理能力",
                    actions=["reduce_input", "switch_model"],
                    status_code=400,
                )
            if any(kw in lower for kw in ("safety", "flagged", "content_filter")):
                raise LLMError(
                    error_code="content_filtered",
                    message="生成被模型安全策略拦截",
                    actions=["modify_input", "switch_model"],
                    status_code=status_code,
                )

        if status_code >= 500:
            raise LLMError(
                error_code="network_error",
                message="网络异常，请检查连接后重试",
                actions=["retry"],
                status_code=status_code,
            )

        # 其他未知错误
        raise LLMError(
            error_code="network_error",
            message=f"LLM 调用失败 (HTTP {status_code})",
            actions=["retry"],
            status_code=status_code,
        )
