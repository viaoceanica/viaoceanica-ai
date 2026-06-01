import asyncio
import base64
import importlib.util
import json
import sys
import types
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import main
import pytest
from test_contract import HEADERS, client, create_brand


@pytest.fixture(autouse=True)
def reset_db_for_guardrail_tests():
    main.Base.metadata.drop_all(bind=main.engine)
    main.Base.metadata.create_all(bind=main.engine)
    yield
    main.Base.metadata.drop_all(bind=main.engine)


def test_image_prompt_guardrails_remove_ai_slop_risks():
    unsafe = "Photorealistic owner holding a sign with readable text 'SALE'. Visible hands, fingers, feet and toes in foreground."

    guarded = main.apply_image_prompt_guardrails(unsafe)
    lowered = guarded.lower()

    assert "hands" not in lowered
    assert "fingers" not in lowered
    assert "feet" not in lowered
    assert "toes" not in lowered
    assert "readable text" not in lowered
    assert "'sale'" not in lowered
    assert "sem mãos visíveis" in lowered
    assert "sem pés visíveis" in lowered
    assert "sem texto" in lowered
    assert "evitar artefactos típicos de ia" in lowered


def test_full_post_generation_sends_guardrailed_prompt_to_image_service(client, monkeypatch):
    async def fake_ai_service(ctx, prompt, action):
        if action == "full_post":
            return json.dumps({
                "title": "Serviço cloud claro",
                "hook": "Menos complicação para a sua empresa.",
                "body": "Uma publicação completa sobre cloud para PMEs.",
                "cta": "Fale connosco.",
                "hashtags": ["#cloud", "#pme"],
                "reference_links": [],
            }), "fake-text", {"fallback": False}
        return json.dumps({
            "image_prompt": "Photorealistic business owner holding a poster with readable text CLOUD, visible hands and feet, detailed fingers.",
            "alt_text": "Imagem de cloud para PME.",
        }), "fake-image-prompt", {"fallback": False}

    captured = {}

    async def fake_image_service(ctx, prompt):
        captured["prompt"] = prompt
        return "data:image/jpeg;base64," + base64.b64encode(b"fake").decode("ascii"), "fake-image", {"provider": "fake"}

    monkeypatch.setattr(main, "call_ai_service", fake_ai_service)
    monkeypatch.setattr(main, "call_image_service", fake_image_service)

    brand = create_brand(client)
    campaign = client.post("/api/v1/campaigns", headers=HEADERS, json={
        "brand_id": brand["id"],
        "name": "Cloud simples",
        "goal": "Gerar contactos",
        "central_message": "Cloud sem complicações",
        "brief": "Mostrar benefícios para PMEs",
    }).json()["data"]

    response = client.post(f"/api/v1/campaigns/{campaign['id']}/generate-full-post", headers=HEADERS, json={
        "brand_id": brand["id"],
        "platform": "instagram",
        "format": "post",
        "topic": "cloud para PMEs",
        "generate_image": True,
    })

    assert response.status_code == 201, response.text
    lowered = captured["prompt"].lower()
    assert "hands" not in lowered
    assert "feet" not in lowered
    assert "fingers" not in lowered
    assert "readable text" not in lowered
    assert "sem texto" in lowered
    assert "evitar artefactos típicos de ia" in lowered


def load_proxy_module(monkeypatch):
    fake_litellm = types.SimpleNamespace(completion=lambda **kwargs: None, embedding=lambda **kwargs: None)
    monkeypatch.setitem(sys.modules, "litellm", fake_litellm)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-openrouter-key")
    monkeypatch.setenv("OPENROUTER_IMAGE_MODEL", "google/gemini-2.5-flash-image-preview")
    path = Path("/root/projects/viaoceanica-ai-live/services/litellm-proxy/app/main.py")
    spec = importlib.util.spec_from_file_location("litellm_proxy_for_tests", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_image_proxy_prefers_openrouter_nanobanana_when_configured(monkeypatch):
    proxy = load_proxy_module(monkeypatch)
    calls = []

    class FakeOpenRouterResponse:
        ok = True
        status_code = 200
        text = "ok"
        def json(self):
            return {
                "choices": [{
                    "message": {
                        "images": [{"image_url": {"url": "data:image/png;base64," + base64.b64encode(b"png").decode("ascii")}}]
                    }
                }]
            }

    def fake_post(url, json=None, headers=None, timeout=None):
        calls.append({"url": url, "json": json, "headers": headers})
        return FakeOpenRouterResponse()

    monkeypatch.setattr(proxy.requests, "post", fake_post)

    class FakeRequest:
        async def json(self):
            return {"model": "dall-e-3", "prompt": "abstract cloud dashboard, no text", "n": 1, "size": "1024x1024"}

    result = asyncio.run(proxy.images_generations(FakeRequest()))
    payload = json.loads(result.body.decode("utf-8"))

    assert calls[0]["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert calls[0]["json"]["model"] == "google/gemini-2.5-flash-image-preview"
    assert payload["provider"] == "openrouter-nanobanana"
    assert payload["model"] == "google/gemini-2.5-flash-image-preview"
    assert payload["data"][0]["mime_type"] == "image/png"
