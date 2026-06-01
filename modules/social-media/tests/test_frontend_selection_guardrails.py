from pathlib import Path

FRONTEND = Path(__file__).resolve().parents[1] / "frontend" / "app" / "page.tsx"


def source():
    return FRONTEND.read_text()


def test_selected_campaign_never_falls_back_to_any_global_campaign():
    text = source()
    assert "|| campaigns[0]" not in text
    assert "campaign.brand_id === selectedBrand.id" in text
    assert "campaign.id === selectedCampaignId" in text


def test_brand_changes_clear_or_recalculate_campaign_and_post_selection():
    text = source()
    assert "function chooseBrand" in text
    assert "setSelectedCampaignId(firstCampaign?.id || '')" in text
    assert "setSelectedPostId(firstPost?.id || '')" in text
    assert "return { brandId: result.data.id, campaignId: '', postId: '' }" in text


def test_load_all_validates_campaign_belongs_to_selected_brand():
    text = source()
    assert "campaign.id === selectedCampaignId && campaign.brand_id === nextBrandId" in text
    assert "post.id === selectedPostId && post.campaign_id === nextCampaignId" in text
