import io
import json
import zipfile
from decimal import Decimal

from fastapi import UploadFile
import cv2
import numpy as np
from PIL import Image, ImageDraw

from app import processing
from app.database import SessionLocal
from app.main import _ensure_line_items, _merge_vendor_profile_payload, _sanitize_line_item_description, enrich_line_item_payload
from app.processing import (
    _extract_qr_line_items,
    _guess_vendor_name_from_text,
    _has_invoice_markers,
    _lookup_vendor_profile_from_nif,
    _resolve_vendor_profile_from_nif,
    precheck_invoice_candidate,
    _should_attempt_qr_scan,
    parse_portuguese_qr_payload,
)
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


def test_extract_qr_line_items_uses_qr_text_fields() -> None:
    payload = "A:123456789*D:FT*S:Item Alpha;Item Beta*T:Serviço Gamma"
    qr_data = parse_portuguese_qr_payload(payload)

    result = _extract_qr_line_items(qr_data)

    assert [item["description"] for item in result] == ["Item Alpha", "Item Beta", "Serviço Gamma"]


def test_extract_qr_line_items_skips_numeric_extra_fields() -> None:
    payload = "A:501496912*D:FT*F:20251022*G:FT V002.03/25084250*I5:588.36*I6:76.49*N:76.49*O:664.85"
    qr_data = parse_portuguese_qr_payload(payload)

    assert _extract_qr_line_items(qr_data) == []


def test_guess_vendor_name_from_text_uses_header_line() -> None:
    assert _guess_vendor_name_from_text("Exemplo Lda\nFatura\nTotal 123.45") == "Exemplo Lda"


def test_sanitize_line_item_description_rejects_value_only_text() -> None:
    assert _sanitize_line_item_description("588.36") is None
    assert _sanitize_line_item_description("2025-10-22") is None
    assert _sanitize_line_item_description("Item Alpha") == "Item Alpha"


def test_lookup_vendor_profile_from_nif_extracts_contacts(monkeypatch) -> None:
    processing._lookup_vendor_profile_from_nif.cache_clear()

    class FakeResponse:
        def json(self):
            return {
                "result": "success",
                "records": {
                    "501496912": {
                        "title": "Acme Lda",
                        "address": "Rua da Lionesa Nº 446",
                        "city": "Leça do Balio",
                        "contacts": {
                            "email": "info@acme.pt",
                            "phone": "220198228",
                            "website": "www.acme.pt",
                            "fax": "224905459",
                        },
                    }
                },
            }

    monkeypatch.setattr("app.processing.settings.nif_lookup_key", "dummy-key")
    monkeypatch.setattr("app.processing.requests.get", lambda *args, **kwargs: FakeResponse())

    result = _lookup_vendor_profile_from_nif("501496912")

    assert result["name"] == "Acme Lda"
    assert result["address"] == "Rua da Lionesa Nº 446, Leça do Balio"
    assert result["contact"] == "email: info@acme.pt, phone: 220198228, website: www.acme.pt, fax: 224905459"


def test_resolve_vendor_profile_uses_learned_profile_before_api(monkeypatch) -> None:
    session = SessionLocal()
    try:
        session.query(VendorProfile).filter(VendorProfile.tenant_id == "qa-local-learning", VendorProfile.supplier_nif == "501496912").delete()
        session.add(
            VendorProfile(
                tenant_id="qa-local-learning",
                supplier_nif="501496912",
                vendor_name="Local Vendor Lda",
                payload='{"vendor":"Local Vendor Lda","vendor_address":"Rua Local 1","vendor_contact":"email: local@example.com"}',
            )
        )
        session.commit()

        monkeypatch.setattr(
            "app.processing.requests.get",
            lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("nif.pt API should not be called when learned vendor profile exists")),
        )

        result = _resolve_vendor_profile_from_nif("501496912", tenant_id="qa-local-learning")

        assert result["name"] == "Local Vendor Lda"
        assert result["address"] == "Rua Local 1"
        assert result["contact"] == "email: local@example.com"
        assert result["source"] == "learned"
    finally:
        session.query(VendorProfile).filter(VendorProfile.tenant_id == "qa-local-learning", VendorProfile.supplier_nif == "501496912").delete()
        session.commit()
        session.close()


def test_resolve_vendor_profile_ignores_placeholder_vendor_names(monkeypatch) -> None:
    session = SessionLocal()
    try:
        session.query(VendorProfile).filter(VendorProfile.tenant_id == "qa-local-learning", VendorProfile.supplier_nif == "501496912").delete()
        session.add(
            VendorProfile(
                tenant_id="qa-local-learning",
                supplier_nif="501496912",
                vendor_name="WhatsApp Image 2026-04-22 at 15.12.04 (1)",
                payload='{"vendor":"WhatsApp Image 2026-04-22 at 15.12.04 (1)","vendor_address":null,"vendor_contact":null}',
            )
        )
        session.commit()

        class FakeResponse:
            def json(self):
                return {
                    "result": "success",
                    "records": {
                        "501496912": {
                            "title": "Garrafeira Soares-Comercio de Bebidas S.a",
                            "address": "Urbz Comercial do Vale de Stª Maria, Lt 20",
                            "city": "Albufeira",
                            "contacts": {
                                "email": "nfrancisco@garrafeirasoares.pt",
                                "phone": "289510460",
                                "website": "www.garrafeirasoares.pt",
                            },
                        }
                    },
                }

        monkeypatch.setattr("app.processing.requests.get", lambda *args, **kwargs: FakeResponse())

        result = _resolve_vendor_profile_from_nif("501496912", tenant_id="qa-local-learning")

        assert result["name"] == "Garrafeira Soares-Comercio de Bebidas S.a"
        assert result.get("source") != "learned"
    finally:
        session.query(VendorProfile).filter(VendorProfile.tenant_id == "qa-local-learning", VendorProfile.supplier_nif == "501496912").delete()
        session.commit()
        session.close()


def test_merge_vendor_profile_payload_preserves_existing_values_on_blank_invoice() -> None:
    class InvoiceStub:
        tenant_id = "1"
        filename = "invoice.pdf"
        raw_text = ""
        vendor = None
        vendor_address = None
        vendor_contact = None
        supplier_nif = "501496912"
        category = None
        currency = None
        customer_name = None
        customer_nif = None
        notes = None
        invoice_number = None
        invoice_date = None
        due_date = None
        subtotal = None
        tax = None
        total = None
        line_items = []

    existing_payload = '{"vendor":"Acme Lda","vendor_address":"Rua da Lionesa Nº 446","vendor_contact":"email: info@acme.pt","supplier_nif":"501496912","cues":{"ignore_customer_values":["CLIENTE"],"invoice_number_prefix":"FT"}}'
    merged = _merge_vendor_profile_payload(existing_payload, InvoiceStub())

    assert merged["vendor"] == "Acme Lda"
    assert merged["vendor_address"] == "Rua da Lionesa Nº 446"
    assert merged["vendor_contact"] == "email: info@acme.pt"
    assert merged["supplier_nif"] == "501496912"
    assert merged["cues"]["invoice_number_prefix"] == "FT"
    assert "CLIENTE" in merged["cues"]["ignore_customer_values"]


def test_precheck_invoice_candidate_accepts_image_with_qr(monkeypatch) -> None:
    class FakeUpload:
        filename = "WhatsApp Image 2026-04-22 at 15.12.03 (2).jpeg"
        content_type = "image/jpeg"

        def __init__(self):
            self.file = io.BytesIO(b"raw-bytes")

    monkeypatch.setattr("app.processing.extract_text_from_upload", lambda upload: ("", b"raw-bytes", {"input": 0, "output": 0, "total": 0}))
    monkeypatch.setattr("app.processing._extract_qr_payload_from_image", lambda raw: "A:123456789*D:FT*F:20260425*G:2026 001*O:123.45*N:23.00*S:Item Alpha")

    should_process, detected_type, reason, _, _, _ = precheck_invoice_candidate(FakeUpload())

    assert should_process is True
    assert detected_type == "invoice"
    assert "QR" in reason or "score" in reason.lower()


def test_extract_invoice_data_qr_first_image_sets_invoice_flags(monkeypatch) -> None:
    from app.processing import extract_invoice_data

    class FakeUpload:
        filename = "WhatsApp Image 2026-04-22 at 15.12.04 (1).jpeg"
        content_type = "image/jpeg"

        def __init__(self):
            self.file = io.BytesIO(b"raw-bytes")

    qr_payload = "A:501496912*B:518051030*C:PT*D:FT*E:N*F:20251022*G:FT V002.03/25084250*H:JJB88JFD-25084250*N:76.49*O:664.85"
    monkeypatch.setattr("app.processing.extract_text_from_upload", lambda upload: ("", b"raw-bytes", {"input": 0, "output": 0, "total": 0}))
    monkeypatch.setattr("app.processing._extract_qr_payload_from_image", lambda raw: qr_payload)
    monkeypatch.setattr(
        "app.processing._lookup_vendor_profile_from_nif",
        lambda nif: {
            "name": "Acme Lda",
            "address": "Rua da Lionesa Nº 446, Leça do Balio",
            "contact": "email: info@acme.pt, phone: 220198228",
        } if nif == "501496912" else {},
    )
    ai_calls = {"count": 0}

    def fake_build_extraction_from_text(*args, **kwargs):
        ai_calls["count"] += 1
        line_items = [{"description": "Serviço Alpha", "quantity": "2", "unit_price": "294.18", "subtotal": "588.36", "tax_amount": "76.49", "total": "664.85"}]
        return {
            "vendor": None,
            "vendor_address": None,
            "vendor_contact": None,
            "category": "servicos",
            "subtotal": Decimal("588.36"),
            "tax": Decimal("76.49"),
            "total": Decimal("664.85"),
            "supplier_nif": None,
            "customer_name": None,
            "customer_nif": None,
            "invoice_number": None,
            "invoice_date": None,
            "due_date": None,
            "currency": "EUR",
            "raw_text": kwargs.get("text", ""),
            "ai_payload": json.dumps({"line_items": line_items}),
            "extraction_model": "test-model",
            "token_input": 11,
            "token_output": 7,
            "token_total": 18,
            "notes": "OCR/vision extracted table",
            "line_items": line_items,
        }

    monkeypatch.setattr("app.processing.build_extraction_from_text", fake_build_extraction_from_text)

    result = extract_invoice_data(FakeUpload())

    assert ai_calls["count"] == 1
    assert result["is_invoice"] is True
    assert result["detected_type"] == "invoice"
    assert result["supplier_nif"] == "501496912"
    assert result["vendor"] == "Acme Lda"
    assert result["vendor_address"] == "Rua da Lionesa Nº 446, Leça do Balio"
    assert result["vendor_contact"] == "email: info@acme.pt, phone: 220198228"
    assert result["invoice_number"] == "FT V002.03/25084250"
    assert result["line_items"][0]["description"] == "Serviço Alpha"
    assert result["line_items"][0]["quantity"] == Decimal("2")
    assert result["line_items"][0]["line_total"] == Decimal("664.85")


def test_extract_invoice_data_qr_first_does_not_use_filename_as_vendor_when_nif_known(monkeypatch) -> None:
    from app.processing import extract_invoice_data

    class FakeUpload:
        filename = "WhatsApp Image 2026-04-22 at 15.12.04 (1).jpeg"
        content_type = "image/jpeg"

        def __init__(self):
            self.file = io.BytesIO(b"raw-bytes")

    qr_payload = "A:501496912*B:518051030*C:PT*D:FT*E:N*F:20251022*G:FT V002.03/25084250*H:JJB88JFD-25084250*N:76.49*O:664.85"
    monkeypatch.setattr("app.processing.extract_text_from_upload", lambda upload: ("", b"raw-bytes", {"input": 0, "output": 0, "total": 0}))
    monkeypatch.setattr("app.processing._extract_qr_payload_from_image", lambda raw: qr_payload)
    monkeypatch.setattr("app.processing._lookup_vendor_profile_from_nif", lambda nif: {})
    ai_calls = {"count": 0}

    def fake_build_extraction_from_text(*args, **kwargs):
        ai_calls["count"] += 1
        line_items = [{"description": "Linha Alpha", "quantity": "1", "subtotal": "588.36", "total": "664.85"}]
        return {
            "vendor": None,
            "vendor_address": None,
            "vendor_contact": None,
            "category": "servicos",
            "subtotal": Decimal("588.36"),
            "tax": Decimal("76.49"),
            "total": Decimal("664.85"),
            "supplier_nif": None,
            "customer_name": None,
            "customer_nif": None,
            "invoice_number": None,
            "invoice_date": None,
            "due_date": None,
            "currency": "EUR",
            "raw_text": kwargs.get("text", ""),
            "ai_payload": json.dumps({"line_items": line_items}),
            "extraction_model": "test-model",
            "token_input": 9,
            "token_output": 6,
            "token_total": 15,
            "notes": "OCR/vision extracted table",
            "line_items": line_items,
        }

    monkeypatch.setattr("app.processing.build_extraction_from_text", fake_build_extraction_from_text)

    result = extract_invoice_data(FakeUpload())

    assert ai_calls["count"] == 1
    assert result["is_invoice"] is True
    assert result["supplier_nif"] == "501496912"
    assert result["vendor"] is None


def test_extract_invoice_data_uses_learned_vendor_profile_without_api(monkeypatch) -> None:
    session = SessionLocal()
    try:
        session.query(VendorProfile).filter(VendorProfile.tenant_id == "qa-local-learning", VendorProfile.supplier_nif == "501496912").delete()
        session.add(
            VendorProfile(
                tenant_id="qa-local-learning",
                supplier_nif="501496912",
                vendor_name="Local Vendor Lda",
                payload='{"vendor":"Local Vendor Lda","vendor_address":"Rua Local 1","vendor_contact":"email: local@example.com"}',
            )
        )
        session.commit()

        class FakeUpload:
            filename = "WhatsApp Image 2026-04-22 at 15.12.04 (1).jpeg"
            content_type = "image/jpeg"

            def __init__(self):
                self.file = io.BytesIO(b"raw-bytes")

        qr_payload = "A:501496912*B:518051030*C:PT*D:FT*E:N*F:20251022*G:FT V002.03/25084250*H:JJB88JFD-25084250*N:76.49*O:664.85"
        monkeypatch.setattr("app.processing.extract_text_from_upload", lambda upload: ("", b"raw-bytes", {"input": 0, "output": 0, "total": 0}))
        monkeypatch.setattr("app.processing._extract_qr_payload_from_image", lambda raw: qr_payload)
        monkeypatch.setattr(
            "app.processing.requests.get",
            lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("nif.pt API should not be called")),
        )

        result = processing.extract_invoice_data(FakeUpload(), context_headers={"X-Viao-Tenant-Id": "qa-local-learning"})

        assert result["vendor"] == "Local Vendor Lda"
        assert result["vendor_address"] == "Rua Local 1"
        assert result["vendor_contact"] == "email: local@example.com"
    finally:
        session.query(VendorProfile).filter(VendorProfile.tenant_id == "qa-local-learning", VendorProfile.supplier_nif == "501496912").delete()
        session.commit()
        session.close()


def test_extract_invoice_data_qr_backed_image_prefers_ai_line_items_with_values(monkeypatch) -> None:
    from app.processing import extract_invoice_data

    class FakeUpload:
        filename = "WhatsApp Image 2026-04-22 at 15.12.04 (1).jpeg"
        content_type = "image/jpeg"

        def __init__(self):
            self.file = io.BytesIO(b"raw-bytes")

    qr_payload = "A:501496912*D:FT*F:20251022*G:FT V002.03/25084250*N:76.49*O:664.85*S:Serviço Alpha"
    monkeypatch.setattr("app.processing.extract_text_from_upload", lambda upload: ("", b"raw-bytes", {"input": 0, "output": 0, "total": 0}))
    monkeypatch.setattr("app.processing._extract_qr_payload_from_image", lambda raw: qr_payload)
    monkeypatch.setattr("app.processing._lookup_vendor_profile_from_nif", lambda nif: {})

    def fake_build_extraction_from_text(*args, **kwargs):
        line_items = [{"description": "Serviço Alpha", "quantity": "3", "unit_price": "196.12", "subtotal": "588.36", "tax_amount": "76.49", "total": "664.85"}]
        return {
            "vendor": None,
            "vendor_address": None,
            "vendor_contact": None,
            "category": "servicos",
            "subtotal": Decimal("588.36"),
            "tax": Decimal("76.49"),
            "total": Decimal("664.85"),
            "supplier_nif": None,
            "customer_name": None,
            "customer_nif": None,
            "invoice_number": None,
            "invoice_date": None,
            "due_date": None,
            "currency": "EUR",
            "raw_text": kwargs.get("text", ""),
            "ai_payload": json.dumps({"line_items": line_items}),
            "extraction_model": "test-model",
            "token_input": 9,
            "token_output": 6,
            "token_total": 15,
            "notes": "OCR/vision extracted table",
            "line_items": line_items,
        }

    monkeypatch.setattr("app.processing.build_extraction_from_text", fake_build_extraction_from_text)

    result = extract_invoice_data(FakeUpload())

    assert len(result["line_items"]) == 1
    assert result["line_items"][0]["description"] == "Serviço Alpha"
    assert result["line_items"][0]["quantity"] == Decimal("3")
    assert result["line_items"][0]["unit_price"] == Decimal("196.12")
    assert result["line_items"][0]["line_subtotal"] == Decimal("588.36")
    assert result["line_items"][0]["line_tax_amount"] == Decimal("76.49")
    assert result["line_items"][0]["line_total"] == Decimal("664.85")


def test_ensure_line_items_returns_empty_for_qr_backed_invoice_without_real_items() -> None:
    assert _ensure_line_items({"qr_data": {"supplier_nif": "501496912"}, "line_items": []}, "WhatsApp Image 2026-04-22 at 15.12.04 (1).jpeg") == []


def test_enrich_line_item_payload_rejects_numeric_description() -> None:
    session = SessionLocal()
    try:
        enriched = enrich_line_item_payload(
            {
                "description": "588.36",
                "quantity": None,
                "unit_price": None,
                "line_subtotal": None,
                "line_tax_amount": None,
                "line_total": None,
                "tax_rate": None,
            },
            tenant_id="1",
            session=session,
        )
        assert enriched["normalized_description"] is None
        assert enriched["needs_review"] is True
        assert "descrição" in (enriched["review_reason"] or "").lower()
    finally:
        session.close()


def test_extract_qr_payload_from_image_finds_bottom_qr() -> None:
    from app.processing import _extract_qr_payload_from_image

    payload = "A:123456789*D:FT*F:20260425*G:2026 001*O:123.45*N:23.00*S:Item Alpha"
    params = cv2.QRCodeEncoder_Params()
    params.version = 0
    params.correction_level = cv2.QRCodeEncoder_CORRECT_LEVEL_M
    params.mode = cv2.QRCodeEncoder_MODE_AUTO
    params.structure_number = 1
    encoder = cv2.QRCodeEncoder_create(params)
    qr = encoder.encode(payload)
    qr = cv2.resize(qr, (260, 260), interpolation=cv2.INTER_NEAREST)
    qr_rgb = cv2.cvtColor(qr, cv2.COLOR_GRAY2RGB)

    canvas = Image.new("RGB", (1200, 1600), "white")
    canvas.paste(Image.fromarray(qr_rgb), (860, 1260))
    draw = ImageDraw.Draw(canvas)
    draw.text((70, 80), "FATURA", fill="black")
    draw.text((70, 140), "Exemplo Lda", fill="black")
    raw = io.BytesIO()
    canvas.save(raw, format="PNG")

    result = _extract_qr_payload_from_image(raw.getvalue())

    assert result == payload


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
