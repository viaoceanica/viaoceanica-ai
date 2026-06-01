from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[1] / "frontend" / "app" / "page.tsx"


def source() -> str:
    return FRONTEND.read_text()


def test_initial_render_shows_loading_not_empty_state():
    text = source()
    assert "useState('A carregar dados da rede social…')" in text
    assert "const [isLoading, setIsLoading] = useState(true)" in text
    assert "isLoading ? 'A carregar dados'" in text
    assert "isLoading ? 'A carregar…'" in text
    assert "isLoading ? '…' : value" in text


def test_loading_state_is_cleared_after_api_refresh_finishes():
    text = source()
    assert "finally {" in text
    assert "setIsLoading(false);" in text
    assert "setIsLoading(true); loadAll();" in text
    assert "Boolean(selectedBrand && selectedCampaign && !isLoading)" in text
