"""LLM Provider 单元测试。"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

import pytest

from infra.llm.openai_compatible import OpenAICompatibleProvider
from infra.llm.provider import LLMChunk, LLMError, LLMResponse


def _mock_response(status_code=200, json_data=None, text=""):
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = json_data or {}
    resp.text = text or json.dumps(json_data or {})
    return resp


def _success_json():
    return {
        "choices": [{"message": {"content": "生成的文本"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 100, "completion_tokens": 50},
        "model": "deepseek-chat",
    }


# ===== 非流式 =====

def test_non_stream_success():
    """非流式成功 → LLMResponse 正确。"""
    provider = OpenAICompatibleProvider("https://api.test.com", "sk-test", "test-model")

    with patch("infra.llm.openai_compatible.httpx.Client") as MockClient:
        mock_client = MagicMock()
        MockClient.return_value.__enter__ = MagicMock(return_value=mock_client)
        MockClient.return_value.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = _mock_response(200, _success_json())

        result = provider.generate(
            [{"role": "user", "content": "test"}],
            max_tokens=1000, temperature=1.0, top_p=0.95,
        )

    assert isinstance(result, LLMResponse)
    assert result.content == "生成的文本"
    assert result.input_tokens == 100
    assert result.output_tokens == 50
    assert result.finish_reason == "stop"


# ===== 错误处理 =====

def test_401_invalid_key():
    """401 → LLMError(invalid_api_key)。"""
    provider = OpenAICompatibleProvider("https://api.test.com", "bad-key", "model")

    with patch("infra.llm.openai_compatible.httpx.Client") as MockClient:
        mock_client = MagicMock()
        MockClient.return_value.__enter__ = MagicMock(return_value=mock_client)
        MockClient.return_value.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = _mock_response(401, text="Unauthorized")

        with pytest.raises(LLMError) as exc_info:
            provider.generate([{"role": "user", "content": "x"}], 100, 1.0, 0.95)

        assert exc_info.value.error_code == "invalid_api_key"


def test_400_length_error():
    """400 含 length → context_length_exceeded。"""
    provider = OpenAICompatibleProvider("https://api.test.com", "sk", "model")

    with patch("infra.llm.openai_compatible.httpx.Client") as MockClient:
        mock_client = MagicMock()
        MockClient.return_value.__enter__ = MagicMock(return_value=mock_client)
        MockClient.return_value.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = _mock_response(400, text='{"error": "context_length_exceeded"}')

        with pytest.raises(LLMError) as exc_info:
            provider.generate([{"role": "user", "content": "x"}], 100, 1.0, 0.95)

        assert exc_info.value.error_code == "context_length_exceeded"


def test_timeout_retries_once():
    """timeout → 重试 1 次。"""
    import httpx as _httpx
    provider = OpenAICompatibleProvider("https://api.test.com", "sk", "model")

    with patch("infra.llm.openai_compatible.httpx.Client") as MockClient:
        mock_client = MagicMock()
        MockClient.return_value.__enter__ = MagicMock(return_value=mock_client)
        MockClient.return_value.__exit__ = MagicMock(return_value=False)
        mock_client.post.side_effect = _httpx.TimeoutException("timeout")

        with pytest.raises(LLMError) as exc_info:
            provider.generate([{"role": "user", "content": "x"}], 100, 1.0, 0.95)

        assert exc_info.value.error_code == "network_error"
        assert mock_client.post.call_count == 2  # 1 + 1 retry


def test_429_retries_three_times():
    """429 → 重试最多 3 次。"""
    provider = OpenAICompatibleProvider("https://api.test.com", "sk", "model")

    with patch("infra.llm.openai_compatible.httpx.Client") as MockClient:
        mock_client = MagicMock()
        MockClient.return_value.__enter__ = MagicMock(return_value=mock_client)
        MockClient.return_value.__exit__ = MagicMock(return_value=False)
        mock_client.post.return_value = _mock_response(429, text="rate limited")

        with patch("infra.llm.openai_compatible.time.sleep"):  # skip actual sleep
            with pytest.raises(LLMError) as exc_info:
                provider.generate([{"role": "user", "content": "x"}], 100, 1.0, 0.95)

        assert exc_info.value.error_code == "rate_limited"
