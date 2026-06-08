"""AI provider 可切换（DeepSeek / MiMo / 自定义）相关测试。"""

import json

import pytest

from app import ai_analyzer
from app.models import SystemConfig
from app.routers.calls import _resolve_ai_engine


class TestChatEndpoint:
    def test_base_with_v1_not_doubled(self):
        assert (
            ai_analyzer._chat_endpoint("https://token-plan-sgp.xiaomimimo.com/v1")
            == "https://token-plan-sgp.xiaomimimo.com/v1/chat/completions"
        )

    def test_base_without_v1_gets_v1(self):
        assert (
            ai_analyzer._chat_endpoint("https://api.deepseek.com")
            == "https://api.deepseek.com/v1/chat/completions"
        )

    def test_trailing_slash_stripped(self):
        assert (
            ai_analyzer._chat_endpoint("https://x.com/v1/")
            == "https://x.com/v1/chat/completions"
        )

    def test_empty_base_defaults_to_deepseek(self):
        assert ai_analyzer._chat_endpoint("").endswith("/v1/chat/completions")


class _FakeAsyncClient:
    """Mock httpx.AsyncClient — captures the request and returns a canned response."""
    def __init__(self, content: str, captured: dict, timeout=None):
        self._content = content
        self._captured = captured
        self._timeout = timeout

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None, headers=None, **kw):
        self._captured["url"] = url
        self._captured["body"] = json
        self._captured["headers"] = headers or {}
        body = {"choices": [{"message": {"content": self._content}}]}

        class _Resp:
            def raise_for_status(self):
                pass

            def json(self):
                return body

        return _Resp()


@pytest.mark.asyncio
class TestCallLlm:
    async def test_builds_request_with_base_model_key(self, monkeypatch):
        captured = {}

        def fake_client(timeout=None, **kw):
            return _FakeAsyncClient(
                '{"intent":"A","confidence":0.9,"summary":"s","reasons":"r"}',
                captured,
                timeout=timeout,
            )

        monkeypatch.setattr(ai_analyzer.httpx, "AsyncClient", fake_client)
        out = await ai_analyzer._call_llm(
            "prompt",
            base="https://token-plan-sgp.xiaomimimo.com/v1",
            model="mimo-v2.5-pro",
            api_key="tp-secret",
        )
        assert captured["url"] == "https://token-plan-sgp.xiaomimimo.com/v1/chat/completions"
        assert captured["body"]["model"] == "mimo-v2.5-pro"
        assert captured["headers"]["Authorization"] == "Bearer tp-secret"
        assert out["ai_intent"] == "A"

    async def test_strips_markdown_fence(self, monkeypatch):
        fenced = '```json\n{"intent":"B","confidence":0.5,"summary":"x","reasons":"y"}\n```'
        captured = {}

        def fake_client(timeout=None, **kw):
            return _FakeAsyncClient(fenced, captured, timeout=timeout)

        monkeypatch.setattr(ai_analyzer.httpx, "AsyncClient", fake_client)
        out = await ai_analyzer._call_llm("p", base="https://x/v1", model="m", api_key="k")
        assert out["ai_intent"] == "B"


@pytest.mark.asyncio
class TestAnalyzeTranscript:
    async def test_no_key_falls_back_to_keyword(self, monkeypatch):
        # 没 key 不应发起网络请求
        async def boom(*a, **k):
            raise AssertionError("不应调用网络")

        monkeypatch.setattr(ai_analyzer, "_call_llm", boom)
        monkeypatch.setattr(ai_analyzer, "DEEPSEEK_API_KEY", "")
        out = await ai_analyzer.analyze_transcript("我想报名", api_key="")
        assert out["ai_intent"] in ("A", "B", "C", "无")

    async def test_uses_provided_base_model(self, monkeypatch):
        captured = {}

        async def fake_call_llm(prompt, base, model, api_key):
            captured["base"] = base
            captured["model"] = model
            return {"ai_intent": "A", "ai_confidence": 0.8, "ai_summary": "s", "ai_reasons": "r"}

        monkeypatch.setattr(ai_analyzer, "_call_llm", fake_call_llm)
        out = await ai_analyzer.analyze_transcript(
            "想了解报名", api_key="k", base="https://mimo.test/v1", model="mimo-v2.5-pro"
        )
        assert captured["base"] == "https://mimo.test/v1"
        assert captured["model"] == "mimo-v2.5-pro"
        assert out["ai_intent"] == "A"


@pytest.mark.asyncio
class TestResolveEngine:
    async def test_default_is_deepseek(self, db, monkeypatch):
        monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-env")
        base, model, key = await _resolve_ai_engine(db)
        assert base is None and model is None
        assert key == "sk-env"

    async def test_mimo_provider(self, db):
        db.add(SystemConfig(key="ai_provider", value="mimo"))
        db.add(SystemConfig(key="mimo_api_key", value="tp-xxx"))
        db.add(SystemConfig(key="mimo_base", value="https://token-plan-sgp.xiaomimimo.com/v1"))
        db.add(SystemConfig(key="mimo_model", value="mimo-v2.5-pro"))
        await db.commit()
        base, model, key = await _resolve_ai_engine(db)
        assert base == "https://token-plan-sgp.xiaomimimo.com/v1"
        assert model == "mimo-v2.5-pro"
        assert key == "tp-xxx"

    async def test_custom_provider(self, db):
        db.add(SystemConfig(key="ai_provider", value="custom"))
        db.add(SystemConfig(key="ai_custom_api_key", value="ck"))
        db.add(SystemConfig(key="ai_custom_base", value="https://api.example.com/v1"))
        db.add(SystemConfig(key="ai_custom_model", value="my-model"))
        await db.commit()
        base, model, key = await _resolve_ai_engine(db)
        assert base == "https://api.example.com/v1"
        assert model == "my-model"
        assert key == "ck"


@pytest.mark.asyncio
class TestConfigValidation:
    async def test_provider_enum_accepts_mimo(self, client, admin_headers):
        resp = await client.put(
            "/api/admin/config", json={"key": "ai_provider", "value": "mimo"}, headers=admin_headers
        )
        assert resp.json()["code"] == 0

    async def test_provider_enum_rejects_unknown(self, client, admin_headers):
        resp = await client.put(
            "/api/admin/config", json={"key": "ai_provider", "value": "gpt"}, headers=admin_headers
        )
        assert resp.json()["code"] == 1

    async def test_mimo_base_must_be_http(self, client, admin_headers):
        bad = await client.put(
            "/api/admin/config", json={"key": "mimo_base", "value": "ftp://x"}, headers=admin_headers
        )
        assert bad.json()["code"] == 1
        ok = await client.put(
            "/api/admin/config",
            json={"key": "mimo_base", "value": "https://token-plan-sgp.xiaomimimo.com/v1"},
            headers=admin_headers,
        )
        assert ok.json()["code"] == 0

    async def test_mimo_key_not_requiring_sk_prefix(self, client, admin_headers):
        resp = await client.put(
            "/api/admin/config",
            json={"key": "mimo_api_key", "value": "tp-svgunva9znazhi"},
            headers=admin_headers,
        )
        assert resp.json()["code"] == 0

    async def test_mimo_key_is_masked(self, client, admin_headers):
        await client.put(
            "/api/admin/config",
            json={"key": "mimo_api_key", "value": "tp-abcdefgh1234"},
            headers=admin_headers,
        )
        resp = await client.get("/api/admin/config", headers=admin_headers)
        data = resp.json()["data"]
        assert data["mimo_api_key"].startswith("****")
        assert data["mimo_api_key"].endswith("1234")
