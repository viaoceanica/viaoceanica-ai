import importlib
import os

import pytest
from fastapi.testclient import TestClient

os.environ["DATABASE_URL"] = "sqlite+pysqlite:///:memory:"
os.environ["ALLOW_DEMO_TENANT"] = "false"

import main


@pytest.fixture(autouse=True)
def reset_db():
    main.Base.metadata.drop_all(bind=main.engine)
    main.Base.metadata.create_all(bind=main.engine)
    yield
    main.Base.metadata.drop_all(bind=main.engine)


@pytest.fixture
def client():
    return TestClient(main.app)


HEADERS = {
    "x-viao-tenant-id": "tenant-a",
    "x-viao-user-id": "user-1",
    "x-viao-session-id": "session-1",
    "x-viao-company-role": "admin",
    "x-viao-platform-roles": "user",
    "x-viao-request-id": "test-1",
}

OTHER_HEADERS = {**HEADERS, "x-viao-tenant-id": "tenant-b", "x-viao-user-id": "user-2"}


def create_brand(client):
    res = client.post("/api/v1/brands", headers=HEADERS, json={
        "name": "Marca QA",
        "sector": "Turismo",
        "description": "Operador turístico premium",
        "audience": "Viajantes que valorizam experiências organizadas",
        "tone": "profissional e próximo",
        "preferred_words": ["experiência", "confiança"],
        "forbidden_words": ["barato"],
    })
    assert res.status_code == 201, res.text
    return res.json()["data"]


def test_health_ready_and_missing_context(client):
    assert client.get("/health").json()["status"] == "ok"
    assert client.get("/ready").json()["status"] == "ready"
    missing = client.get("/api/v1/context")
    assert missing.status_code == 401
    assert missing.json()["error"]["code"] == "MISSING_VIAO_CONTEXT"
    ctx = client.get("/api/v1/context", headers=HEADERS)
    assert ctx.status_code == 200
    assert ctx.json()["data"]["tenant_id"] == "tenant-a"


def test_brand_campaign_post_approval_and_export_flow(client):
    brand = create_brand(client)
    campaign = client.post("/api/v1/campaigns", headers=HEADERS, json={
        "brand_id": brand["id"],
        "name": "Campanha Primavera",
        "goal": "vendas",
        "channels": ["instagram", "linkedin"],
        "central_message": "Reservas antecipadas",
        "brief": "Promover experiências de primavera",
    }).json()["data"]
    post_res = client.post("/api/v1/posts", headers=HEADERS, json={
        "brand_id": brand["id"],
        "campaign_id": campaign["id"],
        "platform": "instagram",
        "format": "feed",
        "body": "Uma experiência barata mas cuidada para a primavera.",
        "cta": "Fale connosco",
        "hashtags": ["#viagens", "#primavera"],
        "scheduled_at": "2026-06-01T10:00:00Z",
    })
    assert post_res.status_code == 201, post_res.text
    post = post_res.json()["data"]
    assert post["quality_check"]["warnings"]
    assert "barato" in post["quality_check"]["warnings"][0]
    assert client.post(f"/api/v1/posts/{post['id']}/submit-review", headers=HEADERS).json()["data"]["status"] == "in_review"
    approved = client.post(f"/api/v1/posts/{post['id']}/approve", headers=HEADERS, json={"comment": "Aprovado"})
    assert approved.status_code == 200, approved.text
    assert approved.json()["data"]["status"] == "approved"
    exported = client.get("/api/v1/exports/csv", headers=HEADERS)
    assert exported.status_code == 200
    assert "publicacoes-aprovadas.csv" in exported.headers["content-disposition"]
    assert "Uma experiência" in exported.text
    assert "notas_publicas" in exported.text
    assert "internal" not in exported.text.lower()


def test_tenant_isolation_for_nested_resources(client):
    brand = create_brand(client)
    other = client.post("/api/v1/campaigns", headers=OTHER_HEADERS, json={
        "brand_id": brand["id"],
        "name": "Campanha Inválida",
    })
    assert other.status_code == 404
    assert other.json()["error"]["code"] == "BRAND_NOT_FOUND"


def test_request_changes_requires_comment_and_role(client):
    brand = create_brand(client)
    post = client.post("/api/v1/posts", headers=HEADERS, json={
        "brand_id": brand["id"],
        "platform": "linkedin",
        "format": "texto",
        "body": "Conteúdo para revisão.",
        "cta": "Contacte-nos",
    }).json()["data"]
    no_comment = client.post(f"/api/v1/posts/{post['id']}/request-changes", headers=HEADERS, json={"comment": ""})
    assert no_comment.status_code == 400
    member_headers = {**HEADERS, "x-viao-company-role": "member"}
    forbidden = client.post(f"/api/v1/posts/{post['id']}/approve", headers=member_headers, json={"comment": "ok"})
    assert forbidden.status_code == 403


def test_ai_generation_uses_audit_and_fallback(client):
    brand = create_brand(client)
    res = client.post("/api/v1/ai/ideas", headers=HEADERS, json={
        "brand_id": brand["id"],
        "topic": "roteiros de fim de semana",
        "platform": "instagram",
        "number": 3,
    })
    assert res.status_code == 200, res.text
    data = res.json()["data"]
    assert data["reply"]
    assert data["generation"]["action"] == "ideas"
    generations = client.get("/api/v1/ai/generations", headers=HEADERS).json()["data"]
    assert len(generations) == 1
    assert "português de Portugal" in generations[0]["prompt"]


def test_csv_formula_values_are_escaped(client):
    brand = create_brand(client)
    post = client.post("/api/v1/posts", headers=HEADERS, json={
        "brand_id": brand["id"],
        "platform": "linkedin",
        "format": "texto",
        "body": "=HYPERLINK(\"http://bad\")",
        "cta": "+351 contacte-nos",
    }).json()["data"]
    client.post(f"/api/v1/posts/{post['id']}/approve", headers=HEADERS, json={"comment": "ok"})
    exported = client.get("/api/v1/exports/csv", headers=HEADERS)
    assert "'=HYPERLINK" in exported.text
    assert "'+351" in exported.text
