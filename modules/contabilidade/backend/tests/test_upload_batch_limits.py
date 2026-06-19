import os
from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

os.environ.setdefault("SKIP_DB_INIT", "true")

from fastapi.testclient import TestClient

from app import main


class FakeQuery:
    def options(self, *args, **kwargs):
        return self

    def filter_by(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        return self

    def all(self):
        return []


class FakeSession:
    def commit(self) -> None:
        pass

    def rollback(self) -> None:
        pass

    def query(self, *args, **kwargs):
        return FakeQuery()


def test_invoice_refresh_flushes_more_than_ten_queued_uploads(monkeypatch) -> None:
    flush_limits: list[int] = []

    def fake_flush_storage_upload_queue(session, *, limit=10):
        flush_limits.append(limit)
        return {"attempted": limit, "uploaded": limit, "failed": 0}

    monkeypatch.setattr(main, "_flush_storage_upload_queue", fake_flush_storage_upload_queue)

    response = main.list_invoices("test-tenant", session=FakeSession())

    assert response == {"items": []}
    assert flush_limits == [50]


def test_ingest_accepts_more_than_ten_files(monkeypatch) -> None:
    processed_filenames: list[str] = []

    def fake_process_upload_for_ingest(*, tenant_id, upload, session, source="upload"):
        processed_filenames.append(upload.filename)
        invoice = SimpleNamespace(
            id=uuid4(),
            tenant_id=tenant_id,
            filename=upload.filename,
            storage_object_key=None,
            vendor="Fornecedor Teste",
            vendor_address=None,
            vendor_contact=None,
            category="teste",
            subtotal=None,
            tax=None,
            total=None,
            supplier_nif=None,
            customer_name=None,
            customer_nif=None,
            invoice_number=None,
            invoice_date=None,
            due_date=None,
            currency="EUR",
            raw_text="",
            ai_payload=None,
            extraction_model=None,
            token_input=0,
            token_output=0,
            token_total=0,
            confidence_score=None,
            requires_review=False,
            notes=None,
            line_items=[],
            learning_debug=None,
            status="processed",
            created_at=datetime.utcnow(),
        )
        return invoice, None

    monkeypatch.setattr(main, "_flush_storage_upload_queue", lambda *args, **kwargs: None)
    monkeypatch.setattr(main, "_mirror_to_storage_or_queue", lambda *args, **kwargs: ("queued", None))
    monkeypatch.setattr(main, "_process_upload_for_ingest", fake_process_upload_for_ingest)
    main.app.dependency_overrides[main.get_session] = lambda: FakeSession()

    client = TestClient(main.app)
    files = [
        ("files", (f"invoice-{index:02d}.txt", b"fake invoice bytes", "text/plain"))
        for index in range(12)
    ]

    try:
        response = client.post("/api/tenants/test-tenant/ingest", files=files)
    finally:
        main.app.dependency_overrides.clear()

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["ingested"]) == 12
    assert processed_filenames == [f"invoice-{index:02d}.txt" for index in range(12)]
    assert payload["rejected"] == []
