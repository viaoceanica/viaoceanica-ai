from pathlib import Path

import pytest

import main
from test_contract import HEADERS


def test_compose_attaches_backend_to_main_ai_network():
    text = Path("docker-compose.yml").read_text()
    service_block = text.split("  mod-social-media:", 1)[1].split("  social-media-frontend:", 1)[0]
    assert "AI_SERVICE_URL: ${AI_SERVICE_URL:-http://ai-service:4010}" in service_block
    assert "networks:" in service_block
    assert "- default" in service_block
    assert "- viaoceanica-ai-live" in service_block
    assert "viaoceanica-ai-live:" in text
    assert "name: viaoceanica-ai-live_default" in text
    assert "external: true" in text


@pytest.mark.anyio
async def test_ai_client_calls_central_service_with_configured_litellm_model(monkeypatch):
    captured = {}

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {
                "success": True,
                "data": {
                    "reply": "Resposta real via LiteLLM",
                    "model": "ollama/qwen2.5:14b-instruct",
                },
            }

    class FakeAsyncClient:
        def __init__(self, timeout):
            captured["timeout"] = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def post(self, url, headers, json):
            captured["url"] = url
            captured["headers"] = headers
            captured["json"] = json
            return FakeResponse()

    monkeypatch.setattr(main.httpx, "AsyncClient", FakeAsyncClient)
    monkeypatch.setattr(main, "AI_SERVICE_URL", "http://ai-service:4010")
    monkeypatch.setattr(main, "AI_MODEL", "ollama/qwen2.5:14b-instruct", raising=False)
    ctx = main.ModuleContext(
        tenant_id=HEADERS["x-viao-tenant-id"],
        user_id=HEADERS["x-viao-user-id"],
        company_role="admin",
        platform_roles=["user"],
        request_id="req-ai-test",
    )

    reply, model, meta = await main.call_ai_service(ctx, "Gera uma ideia", "ideas")

    assert reply == "Resposta real via LiteLLM"
    assert model == "ollama/qwen2.5:14b-instruct"
    assert meta == {"fallback": False}
    assert captured["url"] == "http://ai-service:4010/api/v1/chat/completions"
    assert captured["json"]["model"] == "ollama/qwen2.5:14b-instruct"
    assert captured["headers"]["X-Viao-Module-Key"] == main.MODULE_KEY
