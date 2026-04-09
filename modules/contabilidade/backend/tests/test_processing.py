import io
import zipfile
from decimal import Decimal

from fastapi import UploadFile

from app.processing import _has_invoice_markers, _should_attempt_qr_scan, parse_portuguese_qr_payload
from app.main import expand_zip_upload


def test_parse_portuguese_qr_payload_extracts_core_fields() -> None:
    payload = "A:123456789*B:987654321*D:FT*F:20260404*G:FT 2026/15*N:23.45*O:123.45*Q:HASH123"

    result = parse_portuguese_qr_payload(payload)

    assert result["supplier_nif"] == "123456789"
    assert result["customer_nif"] == "987654321"
    assert result["document_type"] == "FT"
    assert result["invoice_date"] == "2026-04-04"
    assert result["invoice_number"] == "FT 2026/15"
    assert result["tax"] == Decimal("23.45")
    assert result["total"] == Decimal("123.45")
    assert result["hash_fragment"] == "HASH123"


def test_parse_portuguese_qr_payload_accepts_newline_and_commas() -> None:
    payload = """A:504302543
D:FT
F:20260404
G:FT VDF/123
N:23,45
O:123,45
Q:ABCD1234"""

    result = parse_portuguese_qr_payload(payload)

    assert result["supplier_nif"] == "504302543"
    assert result["document_type"] == "FT"
    assert result["invoice_number"] == "FT VDF/123"
    assert result["tax"] == Decimal("23.45")
    assert result["total"] == Decimal("123.45")


def test_has_invoice_markers_handles_spaced_caps_text() -> None:
    assert _has_invoice_markers("I n v o i c e # 4423199") is True


def test_should_attempt_qr_scan_skips_long_non_pt_invoice_text() -> None:
    text = "Invoice #4423199 GreenGeeks LLC total USD 69.95 due date 2026-03-06 " * 8
    assert _should_attempt_qr_scan(text) is False


def test_should_attempt_qr_scan_does_not_trigger_only_on_nif_word() -> None:
    text = "Invoice #4423199 customer NIF 512052794 total USD 69.95 due date 2026-03-06 " * 8
    assert _should_attempt_qr_scan(text) is False


def test_expand_zip_upload_returns_inner_files() -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("nested/invoice-a.txt", "alpha")
        archive.writestr("invoice-b.txt", "beta")
    buffer.seek(0)

    upload = UploadFile(filename="batch.zip", file=io.BytesIO(buffer.getvalue()))
    expanded = expand_zip_upload(upload)

    assert [item.filename for item in expanded] == ["invoice-a.txt", "invoice-b.txt"]
    assert [item.file.read().decode("utf-8") for item in expanded] == ["alpha", "beta"]
