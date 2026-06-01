import pytest
from fastapi.testclient import TestClient

from test_contract import HEADERS, client, create_brand, reset_db
import main


class FakeResponse:
    status_code = 200
    def raise_for_status(self):
        return None
    def json(self):
        return {"success": True, "data": {"reply": "Ideia 1: Conteúdo útil\nIdeia 2: Prova social", "model": "fake-model"}}


class FakeAsyncClient:
    def __init__(self, *args, **kwargs):
        self.kwargs = kwargs
    async def __aenter__(self):
        return self
    async def __aexit__(self, exc_type, exc, tb):
        return False
    async def post(self, url, **kwargs):
        return FakeResponse()


def test_ai_service_has_configured_model_and_real_success_metadata(monkeypatch):
    monkeypatch.setattr(main.httpx, "AsyncClient", FakeAsyncClient)
    ctx = main.ModuleContext(tenant_id="1", user_id="2", session_id="", platform_roles=[], company_role="admin", request_id="req")
    import asyncio
    reply, model, metadata = asyncio.run(main.call_ai_service(ctx, "Prompt", "ideas"))
    assert "Ideia 1" in reply
    assert model == "fake-model"
    assert metadata["fallback"] is False


def test_ai_ideas_can_persist_visible_ideas(client, monkeypatch):
    monkeypatch.setattr(main.httpx, "AsyncClient", FakeAsyncClient)
    brand = create_brand(client)
    response = client.post("/api/v1/ai/ideas", headers=HEADERS, json={
        "brand_id": brand["id"],
        "topic": "redes sociais",
        "platform": "instagram",
        "number": 2,
        "persist": True,
    })
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["generation"]["model"] == "fake-model"
    assert len(data["created_ideas"]) == 2
    ideas = client.get("/api/v1/ideas", headers=HEADERS).json()["data"]
    assert [idea["title"] for idea in ideas][:2] == ["Prova social", "Conteúdo útil"]


def test_export_download_token_allows_browser_link_without_custom_headers(client):
    token = client.post("/api/v1/exports/token", headers=HEADERS).json()["data"]["token"]
    response = client.get(f"/api/v1/exports/csv?download_token={token}")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")


def test_parse_ai_ideas_handles_markdown_headings():
    reply = """### Ideia 1: Testemunhos de Sucesso

**Objetivo:** Promover confiança.

---

### Ideia 2: Dicas Práticas para Empresas

**Objetivo:** Partilhar conhecimento.
"""
    parsed = main.parse_ai_ideas(reply, 2)
    assert parsed[0][0] == "Testemunhos de Sucesso"
    assert "Promover confiança" in parsed[0][1]
    assert parsed[1][0] == "Dicas Práticas para Empresas"


def test_parse_ai_ideas_skips_preface_and_numbered_markdown():
    reply = """Claro! Aqui estão duas propostas de publicações para Instagram.

1. **Segurança Digital para PMEs**
Explique como proteger dados críticos.

2. **Confiança no Atendimento**
Mostre um caso de acompanhamento próximo.
"""
    parsed = main.parse_ai_ideas(reply, 2)
    assert parsed[0][0] == "Segurança Digital para PMEs"
    assert "proteger dados" in parsed[0][1]
    assert parsed[1][0] == "Confiança no Atendimento"


class FailingAsyncClient:
    def __init__(self, *args, **kwargs):
        pass
    async def __aenter__(self):
        return self
    async def __aexit__(self, exc_type, exc, tb):
        return False
    async def post(self, url, **kwargs):
        raise TimeoutError("simulated slow AI service")


def test_ai_ideas_failure_creates_meaningful_local_ideas_not_generic_message(client, monkeypatch):
    monkeypatch.setattr(main.httpx, "AsyncClient", FailingAsyncClient)
    brand = create_brand(client)
    response = client.post("/api/v1/ai/ideas", headers=HEADERS, json={
        "brand_id": brand["id"],
        "topic": "serviços cloud para PMEs",
        "platform": "instagram",
        "number": 3,
        "persist": True,
    })
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["generation"]["metadata_json"]["fallback"] is True
    assert "Sugestão gerada localmente: crie uma publicação clara" not in data["reply"]
    assert "serviços cloud para PMEs" in data["reply"]
    assert len(data["created_ideas"]) == 3
    assert all("serviços cloud para PMEs" in idea["description"] or "PMEs" in idea["title"] for idea in data["created_ideas"])
