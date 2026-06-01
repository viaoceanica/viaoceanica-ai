from fastapi.testclient import TestClient

import main
from test_contract import HEADERS, OTHER_HEADERS, client, create_brand, reset_db


def create_post(client: TestClient, brand_id: str, **overrides):
    payload = {
        "brand_id": brand_id,
        "platform": "linkedin",
        "format": "texto",
        "body": "Conteúdo base para duplicação e planeamento.",
        "cta": "Fale connosco",
        "hashtags": ["#conteudo"],
        "scheduled_at": "2026-06-01T09:00:00Z",
    }
    payload.update(overrides)
    response = client.post("/api/v1/posts", headers=HEADERS, json=payload)
    assert response.status_code == 201, response.text
    return response.json()["data"]


def test_ideas_can_be_created_listed_and_converted_to_post(client):
    brand = create_brand(client)
    create = client.post("/api/v1/ideas", headers=HEADERS, json={
        "brand_id": brand["id"],
        "title": "Dica da semana",
        "description": "Explicar uma vantagem concreta para clientes empresariais.",
        "source": "manual",
    })
    assert create.status_code == 201, create.text
    idea = create.json()["data"]
    listed = client.get("/api/v1/ideas", headers=HEADERS)
    assert listed.status_code == 200
    assert listed.json()["data"][0]["title"] == "Dica da semana"
    converted = client.post(f"/api/v1/ideas/{idea['id']}/convert-to-post", headers=HEADERS, json={
        "platform": "linkedin",
        "format": "texto",
        "cta": "Agende uma conversa",
        "scheduled_at": "2026-06-03T10:00:00Z",
    })
    assert converted.status_code == 201, converted.text
    post = converted.json()["data"]
    assert post["body"].startswith("Dica da semana")
    assert post["status"] == "draft"
    idea_after = client.get("/api/v1/ideas", headers=HEADERS).json()["data"][0]
    assert idea_after["status"] == "converted"


def test_library_search_combines_ideas_posts_and_ctas(client):
    brand = create_brand(client)
    client.post("/api/v1/ideas", headers=HEADERS, json={"brand_id": brand["id"], "title": "Prova social", "description": "Testemunho de cliente"})
    create_post(client, brand["id"], body="Publicação sobre confiança no serviço", cta="Peça uma proposta")
    library = client.get("/api/v1/library?query=confiança", headers=HEADERS)
    assert library.status_code == 200
    types = {item["type"] for item in library.json()["data"]}
    assert "post" in types
    assert "cta" in types


def test_duplicate_post_copies_content_and_resets_workflow_state(client):
    brand = create_brand(client)
    original = create_post(client, brand["id"], body="Texto original", cta="Contacte-nos")
    client.post(f"/api/v1/posts/{original['id']}/approve", headers=HEADERS, json={"comment": "ok"})
    duplicate = client.post(f"/api/v1/posts/{original['id']}/duplicate", headers=HEADERS, json={
        "scheduled_at": "2026-06-10T10:00:00Z",
        "platform": "instagram",
    })
    assert duplicate.status_code == 201, duplicate.text
    data = duplicate.json()["data"]
    assert data["id"] != original["id"]
    assert data["body"] == "Texto original"
    assert data["platform"] == "instagram"
    assert data["status"] == "draft"
    assert data["approved_by"] is None


def test_export_can_filter_by_campaign_and_platform(client):
    brand = create_brand(client)
    campaign = client.post("/api/v1/campaigns", headers=HEADERS, json={"brand_id": brand["id"], "name": "Campanha A"}).json()["data"]
    keep = create_post(client, brand["id"], campaign_id=campaign["id"], platform="linkedin", body="Manter no CSV")
    skip = create_post(client, brand["id"], platform="instagram", body="Não exportar")
    client.post(f"/api/v1/posts/{keep['id']}/approve", headers=HEADERS, json={"comment": "ok"})
    client.post(f"/api/v1/posts/{skip['id']}/approve", headers=HEADERS, json={"comment": "ok"})
    exported = client.get(f"/api/v1/exports/csv?campaign_id={campaign['id']}&platform=linkedin", headers=HEADERS)
    assert exported.status_code == 200
    assert "Manter no CSV" in exported.text
    assert "Não exportar" not in exported.text


def test_metrics_summary_groups_by_platform_and_blocks_cross_tenant(client):
    brand = create_brand(client)
    post = create_post(client, brand["id"], platform="linkedin")
    metric = client.post("/api/v1/reports/manual", headers=HEADERS, json={
        "post_id": post["id"],
        "reach": 100,
        "impressions": 150,
        "likes": 12,
        "comments_count": 3,
        "shares": 2,
        "clicks": 5,
        "leads": 1,
    })
    assert metric.status_code == 201, metric.text
    blocked = client.post("/api/v1/reports/manual", headers=OTHER_HEADERS, json={"post_id": post["id"], "reach": 1})
    assert blocked.status_code == 404
    summary = client.get("/api/v1/reports/summary?group_by=platform", headers=HEADERS)
    assert summary.status_code == 200
    data = summary.json()["data"]
    assert data["totals"]["reach"] == 100
    assert data["by_platform"]["linkedin"]["leads"] == 1
