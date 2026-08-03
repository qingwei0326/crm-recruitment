import pytest

from app.assistant_config_service import AssistantRuntimeConfig
from app.assistant_provider import (
    AssistantProviderError,
    call_openai_chat_completions,
)
from app.assistant_provider import (
    test_openai_tool_call as run_tool_call_test,
)
from app.assistant_security import sign_assistant_approval, verify_assistant_approval
from app.utils import utcnow


class FakeResponse:
    def __init__(self, body, status_code=200):
        self._body = body
        self.status_code = status_code
        self.headers = {"x-request-id": "header-request"}

    def json(self):
        return self._body


class FakeClient:
    def __init__(self, response, captured, **_kwargs):
        self.response = response
        self.captured = captured

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def post(self, url, *, headers, json):
        self.captured.update({"url": url, "headers": headers, "json": json})
        return self.response


def runtime():
    return AssistantRuntimeConfig(
        enabled=True,
        base_url="https://provider.example/v1",
        endpoint="https://provider.example/v1/chat/completions",
        model="tool-model",
        api_key="private-key",
    )


@pytest.mark.asyncio
async def test_openai_provider_sends_bearer_tools_and_parses_usage(monkeypatch):
    captured = {}
    response = FakeResponse(
        {
            "id": "request-body-id",
            "choices": [{"message": {"role": "assistant", "content": "ok"}}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 4},
        }
    )
    monkeypatch.setattr(
        "app.assistant_provider.httpx.AsyncClient",
        lambda **kwargs: FakeClient(response, captured, **kwargs),
    )
    result = await call_openai_chat_completions(
        runtime(),
        messages=[{"role": "user", "content": "hello"}],
        tools=[{"type": "function", "function": {"name": "check"}}],
    )
    assert captured["url"] == "https://provider.example/v1/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer private-key"
    assert captured["json"]["tool_choice"] == "auto"
    assert result.request_id == "request-body-id"
    assert result.prompt_tokens == 12
    assert result.completion_tokens == 4


@pytest.mark.asyncio
async def test_openai_provider_error_does_not_expose_key(monkeypatch):
    captured = {}
    response = FakeResponse(
        {"error": {"message": "invalid credential private-key"}},
        status_code=401,
    )
    monkeypatch.setattr(
        "app.assistant_provider.httpx.AsyncClient",
        lambda **kwargs: FakeClient(response, captured, **kwargs),
    )
    with pytest.raises(AssistantProviderError) as exc:
        await call_openai_chat_completions(runtime(), messages=[])
    assert "HTTP 401" in str(exc.value)
    assert "private-key" not in str(exc.value)


@pytest.mark.asyncio
async def test_openai_provider_rejects_invalid_usage(monkeypatch):
    captured = {}
    response = FakeResponse(
        {
            "choices": [{"message": {"role": "assistant", "content": "ok"}}],
            "usage": {"prompt_tokens": "not-a-number"},
        }
    )
    monkeypatch.setattr(
        "app.assistant_provider.httpx.AsyncClient",
        lambda **kwargs: FakeClient(response, captured, **kwargs),
    )

    with pytest.raises(AssistantProviderError, match="usage"):
        await call_openai_chat_completions(runtime(), messages=[])


@pytest.mark.asyncio
async def test_tool_call_connection_check_rejects_plain_text_model(monkeypatch):
    captured = {}
    response = FakeResponse(
        {"choices": [{"message": {"role": "assistant", "content": "connected"}}]}
    )
    monkeypatch.setattr(
        "app.assistant_provider.httpx.AsyncClient",
        lambda **kwargs: FakeClient(response, captured, **kwargs),
    )
    with pytest.raises(AssistantProviderError, match="Tool Calling"):
        await run_tool_call_test(runtime())


def test_assistant_approval_token_is_bound_to_user_call_and_preview():
    expires_at = utcnow().replace(microsecond=0)
    token = sign_assistant_approval(
        tool_call_id="call-1",
        operator_id=7,
        preview_hash="a" * 64,
        expires_at=expires_at,
    )
    assert verify_assistant_approval(
        token,
        tool_call_id="call-1",
        operator_id=7,
        preview_hash="a" * 64,
        now=expires_at,
    )
    assert not verify_assistant_approval(
        token,
        tool_call_id="call-1",
        operator_id=8,
        preview_hash="a" * 64,
        now=expires_at,
    )
