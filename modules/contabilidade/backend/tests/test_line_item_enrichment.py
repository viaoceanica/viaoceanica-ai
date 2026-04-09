from decimal import Decimal

from app.main import (
    _format_review_reasons,
    _repair_line_item_values,
    infer_default_tax_rate,
    infer_line_type,
    normalize_catalog_lookup_label,
)


def test_repair_line_item_autofills_subtotal_and_total() -> None:
    quantity, unit_price, line_subtotal, line_tax_amount, line_total, issues = _repair_line_item_values(
        quantity=Decimal("2"),
        unit_price=Decimal("3.50"),
        line_subtotal=None,
        line_tax_amount=None,
        line_total=None,
    )

    assert quantity == Decimal("2")
    assert unit_price == Decimal("3.50")
    assert line_subtotal == Decimal("7.00")
    assert line_total == Decimal("7.00")
    assert issues == []


def test_repair_line_item_detects_subtotal_mismatch() -> None:
    _, _, _, _, _, issues = _repair_line_item_values(
        quantity=Decimal("2"),
        unit_price=Decimal("3.00"),
        line_subtotal=Decimal("9.00"),
        line_tax_amount=Decimal("0.00"),
        line_total=Decimal("9.00"),
    )

    assert "subtotal_mismatch" in issues


def test_infer_line_type_discount_and_fee() -> None:
    assert infer_line_type("Desconto promocional") == ("discount", "adjustments/discount")
    assert infer_line_type("Service fee") == ("fee", "services/fees")


def test_format_review_reasons_human_readable() -> None:
    formatted = _format_review_reasons(["missing_description", "subtotal_mismatch"])
    assert formatted is not None
    assert "descrição em falta" in formatted
    assert "subtotal inconsistente" in formatted


def test_infer_default_tax_rate_calculates_percentage() -> None:
    rate = infer_default_tax_rate(Decimal("100.00"), Decimal("23.00"))
    assert rate == Decimal("23.00")


def test_normalize_catalog_lookup_label_removes_noise_tokens() -> None:
    raw = "Invoice RH-80 (EUROPE) - azoreslife.com (2026-03-06 - 2026-04-05) USD"
    normalized = normalize_catalog_lookup_label(raw)
    assert "invoice" not in normalized
    assert "usd" not in normalized
    assert "rh" in normalized
