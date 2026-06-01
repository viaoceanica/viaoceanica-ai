from pathlib import Path


def test_frontend_guides_business_owner_workflow():
    page = Path("frontend/app/page.tsx").read_text(encoding="utf-8")
    assert "Comece aqui" in page
    assert "1. Empresa" in page
    assert "2. Campanha" in page
    assert "3. Gerar post" in page
    assert "4. Rever e usar" in page
    assert "O que está a acontecer" in page
    assert "Pronto para gerar" in page
    assert "confirm(" in page


def test_post_review_is_promoted_over_dense_admin_lists():
    styles = Path("frontend/app/styles.css").read_text(encoding="utf-8")
    assert ".guided-flow" in styles
    assert ".workspace-bar" in styles
    assert ".post-review-grid" in styles
    assert ".primary-action" in styles


def test_frontend_hides_advanced_tools_until_requested():
    page = Path("frontend/app/page.tsx").read_text(encoding="utf-8")
    assert "showAdvanced" in page
    assert "Mostrar biblioteca, resultados e calendário" in page
    assert "Ocultar ferramentas avançadas" in page
    assert "statusLabel" in page
    assert "Rascunho" in page


def test_frontend_uses_platform_tenant_for_ai_metering():
    page = Path("frontend/app/page.tsx").read_text(encoding="utf-8")
    assert "'x-viao-tenant-id': '1'" in page
    assert "'x-viao-user-id': '1'" in page
    assert "'x-viao-tenant-id': 'demo'" not in page
