from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from app.assistant_config_service import AssistantRuntimeConfig

ASSISTANT_PROVIDER_TIMEOUT_SECONDS = 90.0


class AssistantProviderError(RuntimeError):
    pass


@dataclass(frozen=True)
class AssistantProviderResponse:
    request_id: str
    message: dict[str, Any]
    prompt_tokens: int
    completion_tokens: int


async def call_openai_chat_completions(
    config: AssistantRuntimeConfig,
    *,
    messages: list[dict[str, Any]],
    tools: list[dict[str, Any]] | None = None,
    tool_choice: str | dict[str, Any] | None = None,
    timeout_seconds: float = ASSISTANT_PROVIDER_TIMEOUT_SECONDS,
) -> AssistantProviderResponse:
    payload: dict[str, Any] = {
        "model": config.model,
        "messages": messages,
        "temperature": 0.1,
    }
    if tools:
        payload["tools"] = tools
        payload["tool_choice"] = tool_choice or "auto"
    headers = {
        "Authorization": f"Bearer {config.api_key}",
        "Content-Type": "application/json",
    }
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds),
            follow_redirects=False,
        ) as client:
            response = await client.post(config.endpoint, headers=headers, json=payload)
    except (httpx.TimeoutException, httpx.NetworkError) as exc:
        raise AssistantProviderError("AI 服务连接失败或响应超时") from exc
    if response.status_code >= 400:
        detail = ""
        try:
            body = response.json()
            detail = str(body.get("error", {}).get("message") or body.get("message") or "")
        except (ValueError, AttributeError):
            detail = ""
        if config.api_key:
            detail = detail.replace(config.api_key, "[redacted]")
        suffix = f"：{detail[:160]}" if detail else ""
        raise AssistantProviderError(f"AI 服务返回 HTTP {response.status_code}{suffix}")
    try:
        body = response.json()
        message = body["choices"][0]["message"]
    except (ValueError, KeyError, IndexError, TypeError) as exc:
        raise AssistantProviderError("AI 服务返回了不兼容的 OpenAI 响应") from exc
    if not isinstance(message, dict):
        raise AssistantProviderError("AI 服务响应中的 message 格式无效")
    usage = body.get("usage") or {}
    try:
        prompt_tokens = int(usage.get("prompt_tokens") or 0)
        completion_tokens = int(usage.get("completion_tokens") or 0)
    except (AttributeError, TypeError, ValueError) as exc:
        raise AssistantProviderError("AI 服务返回了无效的 usage 字段") from exc
    return AssistantProviderResponse(
        request_id=str(body.get("id") or response.headers.get("x-request-id") or ""),
        message=message,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
    )


async def test_openai_tool_call(config: AssistantRuntimeConfig) -> dict[str, object]:
    tool_name = "assistant_connection_check"
    tools = [
        {
            "type": "function",
            "function": {
                "name": tool_name,
                "description": "Return a successful connection check.",
                "parameters": {
                    "type": "object",
                    "properties": {"ok": {"type": "boolean"}},
                    "required": ["ok"],
                    "additionalProperties": False,
                },
            },
        }
    ]
    response = await call_openai_chat_completions(
        config,
        messages=[
            {"role": "system", "content": "Call the requested tool exactly once."},
            {"role": "user", "content": "Run the connection check."},
        ],
        tools=tools,
        tool_choice={"type": "function", "function": {"name": tool_name}},
        timeout_seconds=30.0,
    )
    calls = response.message.get("tool_calls") or []
    supports_tools = any(
        isinstance(call, dict)
        and isinstance(call.get("function"), dict)
        and call["function"].get("name") == tool_name
        for call in calls
    )
    if not supports_tools:
        raise AssistantProviderError("模型连接成功，但没有按 OpenAI 格式返回 Tool Calling")
    return {
        "ok": True,
        "model": config.model,
        "endpoint": config.endpoint,
        "tool_calling": True,
        "request_id": response.request_id,
    }
