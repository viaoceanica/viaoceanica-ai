from __future__ import annotations

from contextlib import asynccontextmanager
import logging
import time
import re
import unicodedata
import threading
from collections import deque
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, List
from urllib.parse import quote, urlparse
from uuid import UUID, uuid4

import boto3
import io
import json
import os
import zipfile
from botocore.config import Config as BotocoreConfig
from botocore.exceptions import ClientError

from fastapi import BackgroundTasks, Depends, FastAPI, File, Header, HTTPException, UploadFile
from openai import OpenAI
from starlette.datastructures import Headers
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session, joinedload, selectinload

from .config import get_settings
from .database import engine, get_session, SessionLocal
from .embeddings import search_invoice_embeddings, upsert_invoice_embedding
from .models import Base, CatalogAlias, CatalogItem, FailedImport, Invoice, InvoiceCorrection, InvoiceLineItem, InvoiceTemplate, StorageUploadQueue, VendorProfile, TenantProfile
from .processing import (
    _lookup_vendor_name_from_nif,
    _lookup_vendor_profile_from_nif,
    build_extraction_from_text,
    extract_invoice_data,
    precheck_invoice_candidate,
    InvalidDocumentError,
)
from .schemas import (
    CostTrendPoint,
    CostTrendResponse,
    CostTrendSummary,
    InvoiceBase,
    InvoiceCorrectionListResponse,
    InvoiceCorrectionRequest,
    ChatRequest,
    ChatResponse,
    AutomationBlockerListResponse,
    AutomationBlockerRow,
    FailedImportBase,
    FailedImportListResponse,
    IngestResponse,
    InvoiceLineItemBase,
    LineItemReviewListResponse,
    LineItemLabelRequest,
    LineItemBulkLabelResponse,
    LineItemSuggestion,
    LineItemSuggestionListResponse,
    LineItemQualitySummary,
    LineItemReviewRow,
    InvoiceListResponse,
    InvoiceUpdateRequest,
    RejectedDocument,
    TenantProfileRequest,
    TenantProfileResponse,
    StorageUploadCompleteRequest,
    StorageUploadInitRequest,
    StorageUploadInitResponse,
    UploadTelemetryEventRequest,
    UploadTelemetryFunnelResponse,
    UploadTelemetryStepSummary,
)

logger = logging.getLogger(__name__)
settings = get_settings()

WATCHTOWER_LOCK = threading.Lock()
WATCHTOWER_ACTIVE: dict[str, dict[str, Any]] = {}
WATCHTOWER_RECENT: deque[dict[str, Any]] = deque(maxlen=500)

UPLOAD_TELEMETRY_LOCK = threading.Lock()
UPLOAD_TELEMETRY_EVENTS: deque[dict[str, Any]] = deque(maxlen=10000)

STORAGE_QUEUE_STOP = threading.Event()


def _watchtower_start(task_id: str, tenant_id: str, filename: str) -> None:
    with WATCHTOWER_LOCK:
        WATCHTOWER_ACTIVE[task_id] = {
            "task_id": task_id,
            "tenant_id": tenant_id,
            "filename": filename,
            "stage": "queued",
            "started_at": datetime.utcnow().isoformat(),
            "updated_at": datetime.utcnow().isoformat(),
            "status": "running",
            "reason": None,
            "duration_seconds": 0.0,
        }


def _watchtower_stage(task_id: str, stage: str) -> None:
    with WATCHTOWER_LOCK:
        payload = WATCHTOWER_ACTIVE.get(task_id)
        if not payload:
            return
        payload["stage"] = stage
        payload["updated_at"] = datetime.utcnow().isoformat()


def _watchtower_finish(task_id: str, status: str, reason: str | None = None) -> None:
    with WATCHTOWER_LOCK:
        payload = WATCHTOWER_ACTIVE.pop(task_id, None)
        if not payload:
            return
        started = datetime.fromisoformat(payload["started_at"])
        payload["updated_at"] = datetime.utcnow().isoformat()
        payload["status"] = status
        payload["reason"] = reason
        payload["duration_seconds"] = round((datetime.utcnow() - started).total_seconds(), 2)
        WATCHTOWER_RECENT.appendleft(payload)


def _watchtower_snapshot() -> dict[str, Any]:
    now = datetime.utcnow()
    with WATCHTOWER_LOCK:
        active = []
        for payload in WATCHTOWER_ACTIVE.values():
            started = datetime.fromisoformat(payload["started_at"])
            active_payload = dict(payload)
            active_payload["duration_seconds"] = round((now - started).total_seconds(), 2)
            active.append(active_payload)
        recent = list(WATCHTOWER_RECENT)
    return {"active": active, "recent": recent}


def _record_upload_telemetry_event(tenant_id: str, payload: UploadTelemetryEventRequest) -> None:
    if payload.timestamp is None:
        event_timestamp = datetime.now(timezone.utc)
    elif payload.timestamp.tzinfo is None:
        event_timestamp = payload.timestamp.replace(tzinfo=timezone.utc)
    else:
        event_timestamp = payload.timestamp.astimezone(timezone.utc)

    event = {
        "tenant_id": tenant_id,
        "step": payload.step,
        "status": payload.status,
        "session_id": payload.session_id,
        "context": payload.context,
        "timestamp": event_timestamp,
    }
    with UPLOAD_TELEMETRY_LOCK:
        UPLOAD_TELEMETRY_EVENTS.appendleft(event)


def _summarize_upload_funnel(tenant_id: str, hours: int = 24) -> UploadTelemetryFunnelResponse:
    cutoff = datetime.now(timezone.utc) - timedelta(hours=max(1, min(hours, 168)))
    counters: dict[str, dict[str, int]] = {
        "validate": {"enter": 0, "success": 0, "failure": 0},
        "extract": {"enter": 0, "success": 0, "failure": 0},
        "review": {"enter": 0, "success": 0, "failure": 0},
        "save": {"enter": 0, "success": 0, "failure": 0},
    }
    total_events = 0

    with UPLOAD_TELEMETRY_LOCK:
        events = list(UPLOAD_TELEMETRY_EVENTS)

    for event in events:
        if event.get("tenant_id") != tenant_id:
            continue
        timestamp = event.get("timestamp")
        if not isinstance(timestamp, datetime) or timestamp < cutoff:
            continue

        step = str(event.get("step") or "").strip()
        status = str(event.get("status") or "").strip()
        if step not in counters or status not in counters[step]:
            continue
        counters[step][status] += 1
        total_events += 1

    steps = [
        UploadTelemetryStepSummary(step=step, **counts)
        for step, counts in counters.items()
    ]
    return UploadTelemetryFunnelResponse(
        tenant_id=tenant_id,
        total_events=total_events,
        steps=steps,
        generated_at=datetime.now(timezone.utc),
    )


MISSING_INVOICE_COLUMNS = {
    "storage_object_key": "ALTER TABLE invoices ADD COLUMN storage_object_key VARCHAR(1024)",
    "supplier_nif": "ALTER TABLE invoices ADD COLUMN supplier_nif VARCHAR(128)",
    "customer_name": "ALTER TABLE invoices ADD COLUMN customer_name VARCHAR(255)",
    "customer_nif": "ALTER TABLE invoices ADD COLUMN customer_nif VARCHAR(128)",
    "invoice_number": "ALTER TABLE invoices ADD COLUMN invoice_number VARCHAR(128)",
    "invoice_date": "ALTER TABLE invoices ADD COLUMN invoice_date VARCHAR(32)",
    "due_date": "ALTER TABLE invoices ADD COLUMN due_date VARCHAR(32)",
    "currency": "ALTER TABLE invoices ADD COLUMN currency VARCHAR(16)",
    "raw_text": "ALTER TABLE invoices ADD COLUMN raw_text TEXT",
    "ai_payload": "ALTER TABLE invoices ADD COLUMN ai_payload TEXT",
    "extraction_model": "ALTER TABLE invoices ADD COLUMN extraction_model VARCHAR(128)",
    "token_input": "ALTER TABLE invoices ADD COLUMN token_input INTEGER",
    "token_output": "ALTER TABLE invoices ADD COLUMN token_output INTEGER",
    "token_total": "ALTER TABLE invoices ADD COLUMN token_total INTEGER",
    "confidence_score": "ALTER TABLE invoices ADD COLUMN confidence_score NUMERIC(5, 2)",
    "requires_review": "ALTER TABLE invoices ADD COLUMN requires_review BOOLEAN DEFAULT FALSE",
    "learning_debug": "ALTER TABLE invoices ADD COLUMN learning_debug TEXT",
}

MISSING_TENANT_PROFILE_COLUMNS = {
    "company_name": "ALTER TABLE tenant_profiles ADD COLUMN company_name VARCHAR(255)",
    "company_nif": "ALTER TABLE tenant_profiles ADD COLUMN company_nif VARCHAR(128)",
}

MISSING_CATALOG_ALIAS_COLUMNS = {
    "usage_confirmed_count": "ALTER TABLE catalog_aliases ADD COLUMN usage_confirmed_count INTEGER DEFAULT 0",
    "usage_auto_apply_count": "ALTER TABLE catalog_aliases ADD COLUMN usage_auto_apply_count INTEGER DEFAULT 0",
    "last_used_at": "ALTER TABLE catalog_aliases ADD COLUMN last_used_at TIMESTAMP",
}

COLUMN_LENGTH_REQUIREMENTS = {
    ("invoices", "supplier_nif"): 128,
    ("invoices", "customer_nif"): 128,
    ("invoice_templates", "supplier_nif"): 128,
    ("vendor_profiles", "supplier_nif"): 128,
    ("tenant_profiles", "company_nif"): 128,
}


TEXT_COLUMN_REQUIREMENTS = {
    ("invoice_line_items", "description"),
    ("invoice_line_items", "normalized_description"),
}


MISSING_LINE_ITEM_COLUMNS = {
    "code": "ALTER TABLE invoice_line_items ADD COLUMN code VARCHAR(128)",
    "line_subtotal": "ALTER TABLE invoice_line_items ADD COLUMN line_subtotal NUMERIC(12, 2)",
    "line_tax_amount": "ALTER TABLE invoice_line_items ADD COLUMN line_tax_amount NUMERIC(12, 2)",
    "tax_rate_source": "ALTER TABLE invoice_line_items ADD COLUMN tax_rate_source VARCHAR(32)",
    "normalized_description": "ALTER TABLE invoice_line_items ADD COLUMN normalized_description TEXT",
    "catalog_item_id": "ALTER TABLE invoice_line_items ADD COLUMN catalog_item_id UUID",
    "raw_unit": "ALTER TABLE invoice_line_items ADD COLUMN raw_unit VARCHAR(32)",
    "normalized_unit": "ALTER TABLE invoice_line_items ADD COLUMN normalized_unit VARCHAR(32)",
    "measurement_type": "ALTER TABLE invoice_line_items ADD COLUMN measurement_type VARCHAR(32)",
    "normalized_quantity": "ALTER TABLE invoice_line_items ADD COLUMN normalized_quantity NUMERIC(12, 3)",
    "normalized_unit_price": "ALTER TABLE invoice_line_items ADD COLUMN normalized_unit_price NUMERIC(12, 4)",
    "line_category": "ALTER TABLE invoice_line_items ADD COLUMN line_category VARCHAR(64)",
    "line_type": "ALTER TABLE invoice_line_items ADD COLUMN line_type VARCHAR(32)",
    "normalization_confidence": "ALTER TABLE invoice_line_items ADD COLUMN normalization_confidence NUMERIC(5, 2)",
    "needs_review": "ALTER TABLE invoice_line_items ADD COLUMN needs_review BOOLEAN DEFAULT FALSE",
    "review_reason": "ALTER TABLE invoice_line_items ADD COLUMN review_reason TEXT",
}


def ensure_invoice_columns() -> None:
    with engine.begin() as connection:
        invoice_columns = {
            row[0]
            for row in connection.execute(
                text(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name = 'invoices'
                    """
                )
            )
        }
        for column_name, ddl in MISSING_INVOICE_COLUMNS.items():
            if column_name not in invoice_columns:
                connection.execute(text(ddl))

        line_columns = {
            row[0]
            for row in connection.execute(
                text(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name = 'invoice_line_items'
                    """
                )
            )
        }
        for column_name, ddl in MISSING_LINE_ITEM_COLUMNS.items():
            if column_name not in line_columns:
                connection.execute(text(ddl))

        tenant_profile_columns = {
            row[0]
            for row in connection.execute(
                text(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name = 'tenant_profiles'
                    """
                )
            )
        }
        for column_name, ddl in MISSING_TENANT_PROFILE_COLUMNS.items():
            if column_name not in tenant_profile_columns:
                connection.execute(text(ddl))

        catalog_alias_columns = {
            row[0]
            for row in connection.execute(
                text(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_name = 'catalog_aliases'
                    """
                )
            )
        }
        for column_name, ddl in MISSING_CATALOG_ALIAS_COLUMNS.items():
            if column_name not in catalog_alias_columns:
                connection.execute(text(ddl))


def ensure_column_lengths() -> None:
    with engine.begin() as connection:
        column_lengths = {
            (row.table_name, row.column_name): row.character_maximum_length
            for row in connection.execute(
                text(
                    """
                    SELECT table_name, column_name, character_maximum_length
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                    """
                )
            )
        }
        for (table_name, column_name), required_length in COLUMN_LENGTH_REQUIREMENTS.items():
            current_length = column_lengths.get((table_name, column_name))
            if current_length is None:
                continue
            if current_length < required_length:
                connection.execute(
                    text(
                        f"ALTER TABLE {table_name} ALTER COLUMN {column_name} TYPE VARCHAR({required_length})"
                    )
                )


def ensure_text_columns() -> None:
    with engine.begin() as connection:
        column_types = {
            (row.table_name, row.column_name): row.data_type
            for row in connection.execute(
                text(
                    """
                    SELECT table_name, column_name, data_type
                    FROM information_schema.columns
                    WHERE table_schema = 'public'
                    """
                )
            )
        }
        for table_name, column_name in TEXT_COLUMN_REQUIREMENTS:
            current_type = column_types.get((table_name, column_name))
            if current_type is None or current_type == "text":
                continue
            connection.execute(
                text(
                    f"ALTER TABLE {table_name} ALTER COLUMN {column_name} TYPE TEXT"
                )
            )


def initialize_database() -> None:
    if settings.skip_db_init:
        logger.info("Skipping database initialization because SKIP_DB_INIT=true")
        return

    Base.metadata.create_all(bind=engine)
    ensure_invoice_columns()
    ensure_column_lengths()
    ensure_text_columns()


def enqueue_invoice_embedding_job(invoice_id: UUID) -> None:
    session = SessionLocal()
    try:
        invoice = session.get(
            Invoice,
            invoice_id,
            options=(selectinload(Invoice.line_items),),
        )
        if not invoice:
            return
        upsert_invoice_embedding(invoice)
    except Exception as exc:
        logger.warning("Falha ao processar embedding da fatura %s em background: %s", invoice_id, exc)
    finally:
        session.close()


def get_or_create_tenant_profile(tenant_id: str, session: Session) -> TenantProfile:
    profile = session.query(TenantProfile).filter(TenantProfile.tenant_id == tenant_id).one_or_none()
    if profile:
        return profile
    profile = TenantProfile(tenant_id=tenant_id)
    session.add(profile)
    session.flush()
    return profile


def apply_tenant_defaults_to_extraction(extraction: dict[str, Any], tenant_id: str, session: Session) -> dict[str, Any]:
    profile = get_or_create_tenant_profile(tenant_id, session)
    if profile.company_name:
        extraction["customer_name"] = profile.company_name
    else:
        extraction["customer_name"] = None
    if profile.company_nif:
        extraction["customer_nif"] = profile.company_nif
    else:
        extraction["customer_nif"] = None
    return extraction


def apply_counterparty_nif_heuristics(extraction: dict[str, Any], tenant_id: str, session: Session) -> dict[str, Any]:
    profile = get_or_create_tenant_profile(tenant_id, session)
    tenant_nif = normalize_digits(profile.company_nif)
    supplier_nif = normalize_digits(extraction.get("supplier_nif"))
    raw_text = str(extraction.get("raw_text") or "")

    if not tenant_nif or not raw_text:
        return extraction

    candidate_nifs = []
    for match in re.findall(r"\b\d{9}\b", raw_text):
        digits = normalize_digits(match)
        if digits and digits != tenant_nif and digits not in candidate_nifs:
            candidate_nifs.append(digits)

    if supplier_nif == tenant_nif and candidate_nifs:
        corrected_supplier_nif = candidate_nifs[0]
        extraction["supplier_nif"] = corrected_supplier_nif
        extraction["customer_nif"] = tenant_nif
        looked_up_vendor = _lookup_vendor_name_from_nif(corrected_supplier_nif)
        tenant_name = normalize_label(profile.company_name)
        current_vendor = normalize_label(extraction.get("vendor"))
        if looked_up_vendor and (not current_vendor or current_vendor == tenant_name):
            extraction["vendor"] = looked_up_vendor

    return extraction


def apply_vendor_profile_enrichment(extraction: dict[str, Any], tenant_id: str, session: Session) -> dict[str, Any]:
    supplier_nif = normalize_digits(extraction.get("supplier_nif"))
    if not supplier_nif:
        return extraction

    profile = _lookup_vendor_profile_from_nif(supplier_nif)
    if not profile:
        return extraction

    tenant_profile = get_or_create_tenant_profile(tenant_id, session)
    tenant_name = normalize_label(tenant_profile.company_name)
    current_vendor = normalize_label(extraction.get("vendor"))
    profile_name = str(profile.get("name") or "").strip()
    profile_address = str(profile.get("address") or "").strip() or None

    if profile_name and (not current_vendor or current_vendor == tenant_name):
        extraction["vendor"] = profile_name
    if profile_address and not str(extraction.get("vendor_address") or "").strip():
        extraction["vendor_address"] = profile_address

    if profile_name or profile_address:
        marker = "NIF_PROFILE_ENRICHED"
        existing_notes = str(extraction.get("notes") or "").strip()
        if marker not in existing_notes:
            extraction["notes"] = f"{existing_notes} | {marker}" if existing_notes else marker

    return extraction


def apply_extraction_to_invoice(invoice: Invoice, extraction: dict[str, Any], session: Session) -> None:
    invoice.vendor = extraction.get("vendor")
    invoice.vendor_address = extraction.get("vendor_address")
    invoice.vendor_contact = extraction.get("vendor_contact")
    invoice.category = extraction.get("category")
    invoice.subtotal = extraction.get("subtotal")
    invoice.tax = extraction.get("tax")
    invoice.total = extraction.get("total")
    invoice.supplier_nif = extraction.get("supplier_nif")
    invoice.customer_name = extraction.get("customer_name")
    invoice.customer_nif = extraction.get("customer_nif")
    invoice.invoice_number = extraction.get("invoice_number")
    invoice.invoice_date = extraction.get("invoice_date")
    invoice.due_date = extraction.get("due_date")
    invoice.currency = extraction.get("currency")
    invoice.raw_text = extraction.get("raw_text")
    invoice.ai_payload = extraction.get("ai_payload")
    invoice.extraction_model = extraction.get("extraction_model")
    invoice.token_input = extraction.get("token_input")
    invoice.token_output = extraction.get("token_output")
    invoice.token_total = extraction.get("token_total")
    invoice.confidence_score = extraction.get("confidence_score")
    invoice.requires_review = bool(extraction.get("requires_review", False))
    invoice.notes = extraction.get("notes")
    default_tax_rate = infer_default_tax_rate(invoice.subtotal, invoice.tax)

    session.query(InvoiceLineItem).filter(InvoiceLineItem.invoice_id == invoice.id).delete()
    for item in extraction.get("line_items", []):
        enriched = enrich_line_item_payload(
            item,
            tenant_id=invoice.tenant_id,
            session=session,
            default_tax_rate=default_tax_rate,
            vendor_name=invoice.vendor,
        )
        session.add(
            InvoiceLineItem(
                invoice_id=invoice.id,
                position=enriched.get("position"),
                code=enriched.get("code"),
                description=enriched.get("description"),
                normalized_description=enriched.get("normalized_description"),
                quantity=enriched.get("quantity"),
                unit_price=enriched.get("unit_price"),
                line_subtotal=enriched.get("line_subtotal"),
                line_tax_amount=enriched.get("line_tax_amount"),
                line_total=enriched.get("line_total"),
                tax_rate=enriched.get("tax_rate"),
                tax_rate_source=enriched.get("tax_rate_source"),
                catalog_item_id=enriched.get("catalog_item_id"),
                raw_unit=enriched.get("raw_unit"),
                normalized_unit=enriched.get("normalized_unit"),
                measurement_type=enriched.get("measurement_type"),
                normalized_quantity=enriched.get("normalized_quantity"),
                normalized_unit_price=enriched.get("normalized_unit_price"),
                line_category=enriched.get("line_category"),
                line_type=enriched.get("line_type"),
                normalization_confidence=enriched.get("normalization_confidence"),
                needs_review=bool(enriched.get("needs_review", False)),
                review_reason=enriched.get("review_reason"),
            )
        )


def normalize_identifier(value: str | None) -> str | None:
    if not value:
        return None
    normalized = unicodedata.normalize("NFKD", value)
    normalized = "".join(char for char in normalized if not unicodedata.combining(char))
    normalized = normalized.lower().strip()
    normalized = re.sub(r"[^a-z0-9]+", "", normalized)
    return normalized or None


def normalize_digits(value: str | None) -> str | None:
    if not value:
        return None
    digits = re.sub(r"\D+", "", value)
    return digits or None


def normalize_label(value: str | None) -> str:
    if not value:
        return ""
    lowered = unicodedata.normalize("NFKD", value)
    lowered = "".join(char for char in lowered if not unicodedata.combining(char))
    lowered = lowered.lower()
    lowered = re.sub(r"[^a-z0-9]+", " ", lowered)
    return re.sub(r"\s+", " ", lowered).strip()


CATALOG_NOISE_TOKENS = {
    "invoice",
    "fatura",
    "factura",
    "period",
    "periodo",
    "periodo",
    "from",
    "to",
    "de",
    "a",
    "usd",
    "eur",
    "iva",
    "tax",
}

GENERIC_CATALOG_TOKENS = {
    "item",
    "items",
    "produto",
    "product",
    "servico",
    "service",
    "mensalidade",
    "subscription",
    "linha",
}


def normalize_catalog_lookup_label(value: str | None) -> str:
    normalized = normalize_label(value)
    if not normalized:
        return ""
    filtered: list[str] = []
    for token in normalized.split():
        if token in CATALOG_NOISE_TOKENS:
            continue
        if re.fullmatch(r"\d+", token):
            continue
        if re.fullmatch(r"\d{4}\d{2}\d{2}", token):
            continue
        if len(token) <= 1:
            continue
        filtered.append(token)
    if not filtered:
        return normalized
    return " ".join(filtered[:8])


def infer_line_measurement(description: str, quantity: Decimal | None) -> tuple[str | None, str | None]:
    text_value = normalize_label(description)
    if re.search(r"\b(hora|horas|hour|hours|hr|hrs)\b", text_value):
        return "hour", "per_hour"
    if re.search(r"\b(kg|quilo|quilos|kilo|kilos)\b", text_value):
        return "kg", "per_kg"
    if re.search(r"\b(l|lt|litro|litros|liter|liters)\b", text_value):
        return "l", "per_liter"
    if quantity is not None:
        return "unit", "per_unit"
    return None, None


def infer_line_type(description: str) -> tuple[str, str | None]:
    normalized = normalize_label(description)
    if any(token in normalized for token in ["desconto", "discount", "rebate", "credito", "credit"]):
        return "discount", "adjustments/discount"
    if any(token in normalized for token in ["fee", "taxa", "comissao", "comissão", "surcharge"]):
        return "fee", "services/fees"
    if any(token in normalized for token in ["iva", "tax", "imposto"]):
        return "tax_only", "tax"
    if any(token in normalized for token in ["porte", "frete", "shipping", "transporte"]):
        return "shipping", "logistics"
    if any(token in normalized for token in ["mensal", "subscricao", "subscription", "license", "licenca"]):
        return "subscription", "services/subscription"
    if any(token in normalized for token in ["servico", "service", "assistencia", "consultoria", "manutencao"]):
        return "service", "services"
    return "product", "goods"


def infer_normalized_unit_price(
    quantity: Decimal | None,
    unit_price: Decimal | None,
    line_subtotal: Decimal | None,
    line_total: Decimal | None,
) -> Decimal | None:
    if unit_price is not None:
        return unit_price
    base = line_subtotal if line_subtotal is not None else line_total
    if base is None or quantity in (None, Decimal("0")):
        return None


def infer_default_tax_rate(subtotal: Decimal | None, tax: Decimal | None) -> Decimal | None:
    if subtotal in (None, Decimal("0")) or tax is None:
        return None
    try:
        rate = ((tax / subtotal) * Decimal("100")).quantize(Decimal("0.01"))
    except Exception:
        return None
    if rate < Decimal("0") or rate > Decimal("100"):
        return None
    return rate
    try:
        return (base / quantity).quantize(Decimal("0.0001"))
    except Exception:
        return None


def find_or_create_catalog_item(
    tenant_id: str,
    normalized_description: str,
    line_type: str,
    measurement_type: str | None,
    normalized_unit: str | None,
    vendor_name: str | None,
    session: Session,
) -> tuple[CatalogItem | None, Decimal]:
    def _token_similarity(left: str, right: str) -> Decimal:
        left_tokens = set(left.split())
        right_tokens = set(right.split())
        if not left_tokens or not right_tokens:
            return Decimal("0")
        inter = len(left_tokens & right_tokens)
        union = len(left_tokens | right_tokens)
        if union == 0:
            return Decimal("0")
        return (Decimal(inter) / Decimal(union)).quantize(Decimal("0.01"))

    if not normalized_description:
        return None, Decimal("0")

    normalized_vendor = normalize_label(vendor_name)

    def _vendor_preference_for_catalog_ids(catalog_ids: list[UUID]) -> dict[UUID, Decimal]:
        if not normalized_vendor or not catalog_ids:
            return {}
        rows = (
            session.query(InvoiceLineItem.catalog_item_id, func.count(InvoiceLineItem.id))
            .join(Invoice, InvoiceLineItem.invoice_id == Invoice.id)
            .filter(
                Invoice.tenant_id == tenant_id,
                InvoiceLineItem.catalog_item_id.in_(catalog_ids),
                func.lower(func.coalesce(Invoice.vendor, "")) == normalized_vendor,
            )
            .group_by(InvoiceLineItem.catalog_item_id)
            .all()
        )
        return {catalog_id: Decimal("0.10") for catalog_id, count in rows if catalog_id and count > 0}

    alias = (
        session.query(CatalogAlias)
        .join(CatalogItem, CatalogAlias.catalog_item_id == CatalogItem.id)
        .filter(CatalogAlias.tenant_id == tenant_id, CatalogAlias.normalized_label == normalized_description)
        .one_or_none()
    )
    if alias:
        return alias.catalog_item, Decimal("0.95")

    aliases = (
        session.query(CatalogAlias)
        .join(CatalogItem, CatalogAlias.catalog_item_id == CatalogItem.id)
        .filter(CatalogAlias.tenant_id == tenant_id)
        .all()
    )
    best_alias = None
    best_alias_score = Decimal("0")
    vendor_boost_by_alias_id = _vendor_preference_for_catalog_ids(
        [candidate.catalog_item_id for candidate in aliases if candidate.catalog_item_id]
    )
    for candidate in aliases:
        score = _token_similarity(normalized_description, candidate.normalized_label or "") + vendor_boost_by_alias_id.get(candidate.catalog_item_id, Decimal("0"))
        if score > best_alias_score:
            best_alias_score = score
            best_alias = candidate
    if best_alias and best_alias_score >= Decimal("0.75"):
        return best_alias.catalog_item, Decimal("0.85")

    canonical_name = " ".join(normalized_description.split()[:5]).strip()
    if not canonical_name:
        return None, Decimal("0")
    canonical_tokens = canonical_name.split()
    if len(canonical_tokens) < 2 or all(token in GENERIC_CATALOG_TOKENS for token in canonical_tokens):
        return None, Decimal("0.40")

    catalog_item = (
        session.query(CatalogItem)
        .filter(CatalogItem.tenant_id == tenant_id, CatalogItem.canonical_name == canonical_name)
        .one_or_none()
    )
    if not catalog_item:
        candidates = session.query(CatalogItem).filter(CatalogItem.tenant_id == tenant_id).all()
        best_catalog = None
        best_catalog_score = Decimal("0")
        vendor_boost_by_catalog = _vendor_preference_for_catalog_ids([candidate.id for candidate in candidates])
        for candidate in candidates:
            score = _token_similarity(normalized_description, normalize_label(candidate.canonical_name)) + vendor_boost_by_catalog.get(candidate.id, Decimal("0"))
            if score > best_catalog_score:
                best_catalog_score = score
                best_catalog = candidate
        if best_catalog and best_catalog_score >= Decimal("0.70"):
            alias = CatalogAlias(
                tenant_id=tenant_id,
                raw_label=normalized_description,
                normalized_label=normalized_description,
                catalog_item_id=best_catalog.id,
                confidence=best_catalog_score,
                source="auto-fuzzy",
            )
            session.add(alias)
            session.flush()
            return best_catalog, Decimal("0.78")

    if not catalog_item:
        catalog_item = CatalogItem(
            tenant_id=tenant_id,
            canonical_name=canonical_name,
            display_name=canonical_name.title(),
            category_path="services" if line_type == "service" else "goods",
            item_type=line_type,
            measurement_type=measurement_type,
            base_unit=normalized_unit,
        )
        session.add(catalog_item)
        session.flush()

    alias = CatalogAlias(
        tenant_id=tenant_id,
        raw_label=normalized_description,
        normalized_label=normalized_description,
        catalog_item_id=catalog_item.id,
        confidence=Decimal("0.60"),
        source="auto",
    )
    session.add(alias)
    session.flush()
    return catalog_item, Decimal("0.60")


def promote_manual_line_item_aliases(invoice: Invoice, session: Session) -> None:
    for line in invoice.line_items or []:
        if not line.catalog_item_id or not line.description:
            continue
        normalized_label = normalize_catalog_lookup_label(line.description)
        if not normalized_label:
            continue
        alias = (
            session.query(CatalogAlias)
            .filter(
                CatalogAlias.tenant_id == invoice.tenant_id,
                CatalogAlias.normalized_label == normalized_label,
            )
            .one_or_none()
        )
        if alias:
            alias.catalog_item_id = line.catalog_item_id
            alias.raw_label = line.description
            alias.confidence = Decimal("0.99")
            alias.source = "manual"
        else:
            session.add(
                CatalogAlias(
                    tenant_id=invoice.tenant_id,
                    raw_label=line.description,
                    normalized_label=normalized_label,
                    catalog_item_id=line.catalog_item_id,
                    confidence=Decimal("0.99"),
                    source="manual",
                )
            )


def _to_decimal_safe(value: Any, quant: str | None = None) -> Decimal | None:
    if value in (None, ""):
        return None
    try:
        normalized = str(value).replace("€", "").replace(" ", "").replace(",", ".")
        number = Decimal(normalized)
        if quant:
            number = number.quantize(Decimal(quant))
        return number
    except Exception:
        return None


def _repair_line_item_values(
    *,
    quantity: Decimal | None,
    unit_price: Decimal | None,
    line_subtotal: Decimal | None,
    line_tax_amount: Decimal | None,
    line_total: Decimal | None,
) -> tuple[Decimal | None, Decimal | None, Decimal | None, Decimal | None, Decimal | None, list[str]]:
    issues: list[str] = []

    if quantity is not None and quantity <= 0:
        issues.append("quantity_non_positive")
        quantity = None

    if line_subtotal is None and line_total is not None and line_tax_amount is not None:
        line_subtotal = (line_total - line_tax_amount).quantize(Decimal("0.01"))
    if line_total is None and line_subtotal is not None and line_tax_amount is not None:
        line_total = (line_subtotal + line_tax_amount).quantize(Decimal("0.01"))

    if line_subtotal is None and quantity not in (None, Decimal("0")) and unit_price is not None:
        line_subtotal = (quantity * unit_price).quantize(Decimal("0.01"))
    if unit_price is None and quantity not in (None, Decimal("0")) and line_subtotal is not None:
        unit_price = (line_subtotal / quantity).quantize(Decimal("0.0001"))
    if quantity is None and unit_price not in (None, Decimal("0")) and line_subtotal is not None:
        quantity = (line_subtotal / unit_price).quantize(Decimal("0.001"))

    if line_total is None and line_subtotal is not None:
        line_total = (line_subtotal + (line_tax_amount or Decimal("0"))).quantize(Decimal("0.01"))

    if quantity is not None and unit_price is not None and line_subtotal is not None:
        expected_subtotal = (quantity * unit_price).quantize(Decimal("0.01"))
        if abs(expected_subtotal - line_subtotal) > Decimal("0.03"):
            issues.append("subtotal_mismatch")

    if line_total is not None and line_subtotal is not None and line_tax_amount is not None:
        expected_total = (line_subtotal + line_tax_amount).quantize(Decimal("0.01"))
        if abs(expected_total - line_total) > Decimal("0.03"):
            issues.append("total_mismatch")

    return quantity, unit_price, line_subtotal, line_tax_amount, line_total, issues


def _format_review_reasons(issues: list[str]) -> str | None:
    if not issues:
        return None
    labels = {
        "quantity_non_positive": "quantidade inválida (<=0)",
        "subtotal_mismatch": "subtotal inconsistente com qtd × preço",
        "total_mismatch": "total inconsistente com subtotal + imposto",
        "missing_description": "descrição em falta",
        "missing_amounts": "valores de linha em falta",
        "low_confidence_match": "classificação com confiança baixa",
    }
    rendered = [labels.get(issue, issue) for issue in dict.fromkeys(issues)]
    return "; ".join(rendered)


def enrich_line_item_payload(
    item: dict[str, Any],
    tenant_id: str,
    session: Session,
    default_tax_rate: Decimal | None = None,
    vendor_name: str | None = None,
) -> dict[str, Any]:
    description = str(item.get("description") or "").strip()
    normalized_description = normalize_label(description)
    catalog_lookup_description = normalize_catalog_lookup_label(description)
    quantity = _to_decimal_safe(item.get("quantity"), quant="0.001")
    unit_price = _to_decimal_safe(item.get("unit_price"), quant="0.0001")
    line_subtotal = _to_decimal_safe(item.get("line_subtotal"), quant="0.01")
    line_tax_amount = _to_decimal_safe(item.get("line_tax_amount"), quant="0.01")
    line_total = _to_decimal_safe(item.get("line_total"), quant="0.01")
    tax_rate = _to_decimal_safe(item.get("tax_rate"), quant="0.01")
    tax_rate_source = "extracted" if tax_rate is not None else None

    quantity, unit_price, line_subtotal, line_tax_amount, line_total, issues = _repair_line_item_values(
        quantity=quantity,
        unit_price=unit_price,
        line_subtotal=line_subtotal,
        line_tax_amount=line_tax_amount,
        line_total=line_total,
    )
    if not normalized_description:
        issues.append("missing_description")
    if line_total is None and line_subtotal is None:
        issues.append("missing_amounts")

    if tax_rate is None:
        line_calculated = infer_default_tax_rate(line_subtotal, line_tax_amount)
        if line_calculated is not None:
            tax_rate = line_calculated
            tax_rate_source = "calculated_line"
        elif default_tax_rate is not None:
            tax_rate = default_tax_rate
            tax_rate_source = "calculated_invoice"

    normalized_unit, measurement_type = infer_line_measurement(description, quantity)
    line_type, line_category = infer_line_type(description)
    normalized_unit_price = infer_normalized_unit_price(quantity, unit_price, line_subtotal, line_total)
    catalog_item, confidence = find_or_create_catalog_item(
        tenant_id=tenant_id,
        normalized_description=catalog_lookup_description or normalized_description,
        line_type=line_type,
        measurement_type=measurement_type,
        normalized_unit=normalized_unit,
        vendor_name=vendor_name,
        session=session,
    )

    normalized_confidence = confidence
    if issues:
        penalty = Decimal("0.12") * Decimal(len(set(issues)))
        normalized_confidence = max(Decimal("0.20"), confidence - penalty).quantize(Decimal("0.01"))
    if normalized_confidence < Decimal("0.78") and "low_confidence_match" not in issues:
        issues.append("low_confidence_match")
    review_reason = _format_review_reasons(issues)

    return {
        **item,
        "quantity": quantity,
        "unit_price": unit_price,
        "line_subtotal": line_subtotal,
        "line_tax_amount": line_tax_amount,
        "line_total": line_total,
        "tax_rate": tax_rate,
        "tax_rate_source": tax_rate_source,
        "normalized_description": normalized_description or None,
        "catalog_item_id": catalog_item.id if catalog_item else None,
        "raw_unit": item.get("raw_unit") or normalized_unit,
        "normalized_unit": normalized_unit,
        "measurement_type": measurement_type,
        "normalized_quantity": quantity,
        "normalized_unit_price": normalized_unit_price,
        "line_category": line_category,
        "line_type": line_type,
        "normalization_confidence": normalized_confidence,
        "needs_review": normalized_confidence < Decimal("0.78") or bool(issues),
        "review_reason": review_reason,
    }


def looks_like_instruction_text(value: str | None) -> bool:
    if not value:
        return False
    lowered = value.lower().strip()
    instruction_markers = [
        "ao contrario",
        "ao contrário",
        "troca",
        "swap",
        "invert",
        "corrige",
        "correc",
        "correct",
        "cliente",
        "fornecedor",
        "vendor",
        "customer",
        "client",
        "nif",
        "data de vencimento",
    ]
    return any(marker in lowered for marker in instruction_markers) and len(lowered.split()) > 3


def sanitize_learned_value(value: str | None) -> str | None:
    if not value:
        return value
    cleaned = value.strip()
    if looks_like_instruction_text(cleaned):
        return None
    return cleaned


def build_vendor_profile_payload(invoice: Invoice) -> dict[str, Any]:
    raw_text = invoice.raw_text or ""
    upper_text = raw_text.upper()
    cues: dict[str, Any] = {
        "ignore_customer_values": [],
        "invoice_number_prefix": None,
    }

    if invoice.invoice_number:
        prefix_match = re.match(r"([A-Z]+)", invoice.invoice_number.upper())
        if prefix_match:
            cues["invoice_number_prefix"] = prefix_match.group(1)

    for bad_customer in ["EXMO(S)", "EXMO (S)", "EXMO(S) SR (S)", "EXMO(S) SENHOR(ES)", "CLIENTE"]:
        if bad_customer in upper_text:
            cues["ignore_customer_values"].append(bad_customer)

    return {
        "vendor": sanitize_learned_value(invoice.vendor),
        "vendor_address": sanitize_learned_value(invoice.vendor_address),
        "vendor_contact": sanitize_learned_value(invoice.vendor_contact),
        "supplier_nif": sanitize_learned_value(invoice.supplier_nif),
        "category": sanitize_learned_value(invoice.category),
        "currency": sanitize_learned_value(invoice.currency),
        "customer_name": None,
        "customer_nif": None,
        "notes": sanitize_learned_value(invoice.notes),
        "cues": cues,
    }


def init_learning_debug() -> dict[str, Any]:
    return {
        "vendor_profile_applied": False,
        "vendor_profile_score": None,
        "vendor_profile_match_key": None,
        "vendor_profile_vendor_name": None,
        "invoice_template_applied": False,
        "invoice_template_score": None,
        "invoice_template_invoice_number": None,
        "invoice_template_supplier_nif": None,
    }


def apply_vendor_profile_to_extraction(
    extraction: dict[str, Any],
    tenant_id: str,
    session: Session,
    debug: dict[str, Any] | None = None,
) -> dict[str, Any]:
    normalized_supplier_nif = normalize_digits(extraction.get("supplier_nif"))
    normalized_vendor = normalize_identifier(extraction.get("vendor"))

    profiles = session.query(VendorProfile).filter(VendorProfile.tenant_id == tenant_id).all()
    if not profiles:
        return extraction

    best_profile: VendorProfile | None = None
    best_score = 0
    best_match_key: str | None = None
    for profile in profiles:
        score = 0
        match_key = None
        profile_nif = normalize_digits(profile.supplier_nif)
        profile_vendor = normalize_identifier(profile.vendor_name)

        if normalized_supplier_nif and profile_nif == normalized_supplier_nif:
            score += 100
            match_key = "supplier_nif"
        if normalized_vendor and profile_vendor == normalized_vendor:
            score += 60
            match_key = match_key or "vendor_name_exact"
        elif normalized_vendor and profile_vendor and (
            normalized_vendor in profile_vendor or profile_vendor in normalized_vendor
        ):
            score += 30
            match_key = match_key or "vendor_name_partial"

        if score > best_score:
            best_score = score
            best_profile = profile
            best_match_key = match_key

    if debug is not None:
        debug["vendor_profile_score"] = best_score or None
        debug["vendor_profile_match_key"] = best_match_key
        debug["vendor_profile_vendor_name"] = best_profile.vendor_name if best_profile else None

    if not best_profile or best_score < 60:
        return extraction

    try:
        payload = json.loads(best_profile.payload)
    except json.JSONDecodeError:
        return extraction

    for field in [
        "vendor",
        "vendor_address",
        "vendor_contact",
        "supplier_nif",
        "category",
        "currency",
        "customer_name",
        "customer_nif",
    ]:
        if extraction.get("qr_data") and field in {"supplier_nif", "customer_nif"}:
            continue
        value = sanitize_learned_value(payload.get(field))
        if value:
            extraction[field] = value

    cues = payload.get("cues") or {}
    ignore_customer_values = {str(value).strip().upper() for value in cues.get("ignore_customer_values") or [] if value}
    customer_name = str(extraction.get("customer_name") or "").strip().upper()
    if customer_name and customer_name in ignore_customer_values:
        extraction["customer_name"] = payload.get("customer_name") or None

    if payload.get("notes") and not extraction.get("notes"):
        extraction["notes"] = payload["notes"]

    if debug is not None:
        debug["vendor_profile_applied"] = True

    return extraction


def upsert_vendor_profile(invoice: Invoice, session: Session) -> None:
    normalized_supplier_nif = normalize_digits(invoice.supplier_nif)
    normalized_vendor = normalize_identifier(invoice.vendor)
    if not normalized_supplier_nif and not normalized_vendor:
        return

    profile = None
    if normalized_supplier_nif:
        profile = (
            session.query(VendorProfile)
            .filter(
                VendorProfile.tenant_id == invoice.tenant_id,
                VendorProfile.supplier_nif == normalized_supplier_nif,
            )
            .one_or_none()
        )

    if not profile and normalized_vendor:
        profiles = session.query(VendorProfile).filter(VendorProfile.tenant_id == invoice.tenant_id).all()
        for candidate in profiles:
            candidate_vendor = normalize_identifier(candidate.vendor_name)
            if candidate_vendor and candidate_vendor == normalized_vendor:
                profile = candidate
                break

    payload = json.dumps(build_vendor_profile_payload(invoice))
    if profile:
        profile.vendor_name = invoice.vendor
        profile.supplier_nif = normalized_supplier_nif or profile.supplier_nif
        profile.payload = payload
    else:
        session.add(
            VendorProfile(
                tenant_id=invoice.tenant_id,
                supplier_nif=normalized_supplier_nif or normalized_vendor or "unknown",
                vendor_name=invoice.vendor,
                payload=payload,
            )
        )


def score_template_match(
    template: InvoiceTemplate,
    extraction: dict[str, Any],
    normalized_invoice_number: str | None,
    normalized_supplier_nif: str | None,
    normalized_vendor: str | None,
) -> int:
    score = 0
    template_invoice = normalize_identifier(template.invoice_number)
    template_nif = normalize_digits(template.supplier_nif)

    if normalized_invoice_number and template_invoice == normalized_invoice_number:
        score += 100
    elif normalized_invoice_number and template_invoice and (
        normalized_invoice_number in template_invoice or template_invoice in normalized_invoice_number
    ):
        score += 20

    if normalized_supplier_nif and template_nif == normalized_supplier_nif:
        score += 100

    try:
        payload = json.loads(template.payload)
    except json.JSONDecodeError:
        payload = {}

    payload_vendor = normalize_identifier(payload.get("vendor"))
    if normalized_vendor and payload_vendor == normalized_vendor:
        score += 40
    elif normalized_vendor and payload_vendor and (
        normalized_vendor in payload_vendor or payload_vendor in normalized_vendor
    ):
        score += 20

    payload_total = payload.get("total")
    extraction_total = extraction.get("total")
    if payload_total is not None and extraction_total is not None:
        try:
            if abs(float(payload_total) - float(extraction_total)) < 0.01:
                score += 15
        except (TypeError, ValueError):
            pass

    return score


def apply_template_to_extraction(
    extraction: dict[str, Any],
    tenant_id: str,
    session: Session,
    debug: dict[str, Any] | None = None,
) -> dict[str, Any]:
    extraction = apply_vendor_profile_to_extraction(extraction, tenant_id, session, debug=debug)

    invoice_number = extraction.get("invoice_number")
    supplier_nif = extraction.get("supplier_nif")
    vendor = extraction.get("vendor")

    normalized_invoice_number = normalize_identifier(invoice_number)
    normalized_supplier_nif = normalize_digits(supplier_nif)
    normalized_vendor = normalize_identifier(vendor)

    if not any([normalized_invoice_number, normalized_supplier_nif, normalized_vendor]):
        return extraction

    candidates = (
        session.query(InvoiceTemplate)
        .filter(InvoiceTemplate.tenant_id == tenant_id)
        .order_by(InvoiceTemplate.updated_at.desc())
        .all()
    )

    best_template: InvoiceTemplate | None = None
    best_score = 0
    for template in candidates:
        score = score_template_match(
            template,
            extraction,
            normalized_invoice_number=normalized_invoice_number,
            normalized_supplier_nif=normalized_supplier_nif,
            normalized_vendor=normalized_vendor,
        )
        if score > best_score:
            best_score = score
            best_template = template

    if debug is not None:
        debug["invoice_template_score"] = best_score or None
        debug["invoice_template_invoice_number"] = best_template.invoice_number if best_template else None
        debug["invoice_template_supplier_nif"] = best_template.supplier_nif if best_template else None

    template_invoice_normalized = normalize_identifier(best_template.invoice_number) if best_template else None
    has_invoice_number_match = bool(
        normalized_invoice_number
        and template_invoice_normalized
        and normalized_invoice_number == template_invoice_normalized
    )

    if not best_template or best_score < 130 or not has_invoice_number_match:
        return extraction

    try:
        payload = json.loads(best_template.payload)
    except json.JSONDecodeError:
        return extraction

    # When QR data is present, trust QR-derived fiscal identifiers and totals.
    protected_when_qr = {
        "supplier_nif",
        "customer_nif",
        "invoice_number",
        "invoice_date",
        "tax",
        "total",
    }

    for field, value in payload.items():
        if extraction.get("qr_data") and field in protected_when_qr:
            continue
        extraction[field] = value

    if debug is not None:
        debug["invoice_template_applied"] = True
    return extraction



def _ensure_line_items(extraction: dict[str, Any], filename: str | None) -> list[dict[str, Any]]:
    line_items = extraction.get("line_items") or []
    if line_items:
        return line_items
    amount = extraction.get("subtotal")
    if amount is None:
        amount = extraction.get("total")
    description = extraction.get("notes") or extraction.get("vendor") or filename or "documento"
    fallback_total = extraction.get("total") if extraction.get("total") is not None else amount
    quantity = Decimal("1.00") if fallback_total is not None else None
    return [
        {
            "position": 1,
            "code": extraction.get("invoice_number"),
            "description": description,
            "quantity": quantity,
            "unit_price": amount,
            "line_subtotal": amount,
            "line_tax_amount": extraction.get("tax"),
            "line_total": fallback_total,
            "tax_rate": None,
        }
    ]


def _is_empty_line_item(item: Any) -> bool:
    if not isinstance(item, dict):
        return True
    text_fields = ["description", "code"]
    numeric_fields = ["quantity", "unit_price", "line_subtotal", "line_tax_amount", "line_total", "total", "subtotal"]

    if any(str(item.get(field) or "").strip() for field in text_fields):
        return False

    for field in numeric_fields:
        value = item.get(field)
        if value is None or value == "":
            continue
        try:
            if Decimal(str(value)) != Decimal("0"):
                return False
        except Exception:
            return False
    return True


def _has_meaningful_line_items(raw_line_items: Any) -> bool:
    if not isinstance(raw_line_items, list) or not raw_line_items:
        return False
    return any(not _is_empty_line_item(item) for item in raw_line_items)


def score_extraction_confidence(extraction: dict[str, Any]) -> tuple[Decimal, bool]:
    score = Decimal("100")
    missing_penalties = {
        "vendor": Decimal("12"),
        "invoice_number": Decimal("14"),
        "invoice_date": Decimal("10"),
        "total": Decimal("16"),
        "supplier_nif": Decimal("10"),
    }

    for field, penalty in missing_penalties.items():
        if not extraction.get(field):
            score -= penalty

    line_items = extraction.get("line_items") or []
    if not line_items:
        score -= Decimal("18")
    elif len(line_items) == 1:
        score -= Decimal("8")

    if extraction.get("qr_data"):
        score += Decimal("8")

    detected_type = (extraction.get("detected_type") or "").lower()
    if detected_type and "invoice" not in detected_type and "fatura" not in detected_type:
        score -= Decimal("12")

    raw_text = str(extraction.get("raw_text") or "")
    if raw_text and len(raw_text) < 200:
        score -= Decimal("8")

    confidence = max(Decimal("0"), min(Decimal("100"), score)).quantize(Decimal("0.01"))
    requires_review = confidence < Decimal("75")
    return confidence, requires_review



def upsert_invoice_template(invoice: Invoice, session: Session) -> None:
    if not invoice.invoice_number or not invoice.supplier_nif:
        return
    payload = json.dumps(
        {
            "vendor": sanitize_learned_value(invoice.vendor),
            "vendor_address": sanitize_learned_value(invoice.vendor_address),
            "vendor_contact": sanitize_learned_value(invoice.vendor_contact),
            "supplier_nif": sanitize_learned_value(invoice.supplier_nif),
            "category": sanitize_learned_value(invoice.category),
            "subtotal": float(invoice.subtotal) if invoice.subtotal is not None else None,
            "tax": float(invoice.tax) if invoice.tax is not None else None,
            "total": float(invoice.total) if invoice.total is not None else None,
            "customer_name": sanitize_learned_value(invoice.customer_name),
            "customer_nif": sanitize_learned_value(invoice.customer_nif),
            "invoice_number": sanitize_learned_value(invoice.invoice_number),
            "invoice_date": sanitize_learned_value(invoice.invoice_date),
            "due_date": sanitize_learned_value(invoice.due_date),
            "currency": sanitize_learned_value(invoice.currency),
            "notes": sanitize_learned_value(invoice.notes),
            "line_items": [
                {
                    "position": index + 1,
                    "code": item.code,
                    "description": item.description,
                    "quantity": float(item.quantity) if item.quantity is not None else None,
                    "unit_price": float(item.unit_price) if item.unit_price is not None else None,
                    "line_subtotal": float(item.line_subtotal) if item.line_subtotal is not None else None,
                    "line_tax_amount": float(item.line_tax_amount) if item.line_tax_amount is not None else None,
                    "line_total": float(item.line_total) if item.line_total is not None else None,
                    "tax_rate": float(item.tax_rate) if item.tax_rate is not None else None,
                }
                for index, item in enumerate(invoice.line_items or [])
            ],
        }
    )
    template = (
        session.query(InvoiceTemplate)
        .filter(
            InvoiceTemplate.tenant_id == invoice.tenant_id,
            InvoiceTemplate.invoice_number == invoice.invoice_number,
            InvoiceTemplate.supplier_nif == invoice.supplier_nif,
        )
        .one_or_none()
    )
    if template:
        template.payload = payload
    else:
        session.add(
            InvoiceTemplate(
                tenant_id=invoice.tenant_id,
                invoice_number=invoice.invoice_number,
                supplier_nif=invoice.supplier_nif,
                payload=payload,
            )
        )


MAX_ZIP_MEMBERS = 200
MAX_ZIP_MEMBER_SIZE = 20 * 1024 * 1024  # 20 MB per file
MAX_ZIP_TOTAL_UNCOMPRESSED = 100 * 1024 * 1024  # 100 MB total
MAX_FAILED_IMPORT_BLOB = 20 * 1024 * 1024  # 20 MB stored for retry
MAX_R2_OBJECT_SIZE = 50 * 1024 * 1024  # 50 MB guardrail for direct storage ingest


def _r2_endpoint() -> str:
    if settings.r2_endpoint:
        raw_endpoint = settings.r2_endpoint.strip().rstrip("/")
        parsed = urlparse(raw_endpoint)
        if parsed.scheme and parsed.netloc:
            if parsed.path and parsed.path != "/":
                logger.warning("R2_ENDPOINT inclui path (%s); a usar apenas scheme+host", parsed.path)
            return f"{parsed.scheme}://{parsed.netloc}"
        return raw_endpoint
    if settings.r2_account_id:
        return f"https://{settings.r2_account_id}.r2.cloudflarestorage.com"
    return ""


def _ensure_r2_enabled() -> None:
    missing = []
    if not settings.r2_bucket:
        missing.append("R2_BUCKET")
    if not _r2_endpoint():
        missing.append("R2_ENDPOINT or R2_ACCOUNT_ID")
    if not settings.r2_access_key_id:
        missing.append("R2_ACCESS_KEY_ID")
    if not settings.r2_secret_access_key:
        missing.append("R2_SECRET_ACCESS_KEY")
    if missing:
        joined = ", ".join(missing)
        raise HTTPException(status_code=503, detail=f"R2 não configurado ({joined})")


def _r2_client():
    _ensure_r2_enabled()
    return boto3.client(
        "s3",
        endpoint_url=_r2_endpoint(),
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
        config=BotocoreConfig(signature_version="s3v4"),
    )


def _sanitize_storage_filename(filename: str) -> str:
    base = os.path.basename(filename or "").strip() or "documento"
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("._")
    return safe[:120] or "documento"


def _tenant_object_prefix(tenant_id: str) -> str:
    return f"tenants/{quote(tenant_id, safe='')}/"


def _build_tenant_object_key(tenant_id: str, filename: str) -> str:
    now = datetime.utcnow().strftime("%Y/%m/%d")
    safe_name = _sanitize_storage_filename(filename)
    return f"{_tenant_object_prefix(tenant_id)}incoming/{now}/{uuid4().hex}_{safe_name}"


def _assert_tenant_object_key(tenant_id: str, object_key: str) -> str:
    normalized = object_key.strip().lstrip("/")
    if not normalized.startswith(_tenant_object_prefix(tenant_id)):
        raise HTTPException(status_code=403, detail="object_key fora do prefixo do tenant")
    return normalized


def _r2_is_configured() -> bool:
    return bool(settings.r2_bucket and _r2_endpoint() and settings.r2_access_key_id and settings.r2_secret_access_key)


def _upload_bytes_to_r2(
    *,
    tenant_id: str,
    filename: str,
    content_type: str | None,
    file_bytes: bytes,
) -> str:
    client = _r2_client()
    object_key = _build_tenant_object_key(tenant_id, filename)
    params: dict[str, Any] = {
        "Bucket": settings.r2_bucket,
        "Key": object_key,
        "Body": file_bytes,
    }
    if content_type:
        params["ContentType"] = content_type
    client.put_object(**params)
    return object_key


def _enqueue_storage_upload(
    *,
    tenant_id: str,
    filename: str,
    content_type: str | None,
    file_bytes: bytes,
    session: Session,
    error_reason: str | None = None,
) -> StorageUploadQueue | None:
    if not file_bytes or len(file_bytes) > MAX_R2_OBJECT_SIZE:
        return None
    row = StorageUploadQueue(
        tenant_id=tenant_id,
        filename=_sanitize_storage_filename(filename),
        content_type=(content_type or "").strip() or None,
        file_size=len(file_bytes),
        file_blob=file_bytes,
        status="pending",
        attempts=0,
        last_error=(error_reason or "").strip()[:1000] or None,
        next_retry_at=datetime.utcnow(),
    )
    session.add(row)
    session.commit()
    return row


def _flush_storage_upload_queue(session: Session, *, limit: int = 10) -> dict[str, int]:
    if not _r2_is_configured():
        return {"attempted": 0, "uploaded": 0, "failed": 0}

    now = datetime.utcnow()
    rows = (
        session.query(StorageUploadQueue)
        .filter(
            StorageUploadQueue.status == "pending",
            or_(StorageUploadQueue.next_retry_at.is_(None), StorageUploadQueue.next_retry_at <= now),
        )
        .order_by(StorageUploadQueue.created_at.asc())
        .limit(max(1, min(limit, 200)))
        .all()
    )

    attempted = 0
    uploaded = 0
    failed = 0
    for row in rows:
        attempted += 1
        try:
            object_key = _upload_bytes_to_r2(
                tenant_id=row.tenant_id,
                filename=row.filename,
                content_type=row.content_type,
                file_bytes=row.file_blob,
            )
            row.status = "uploaded"
            row.object_key = object_key
            row.file_blob = b""
            row.last_error = None
            row.next_retry_at = None
            uploaded += 1
        except Exception as exc:
            row.attempts = int(row.attempts or 0) + 1
            wait_minutes = min(60, 2 ** min(row.attempts, 6))
            row.next_retry_at = datetime.utcnow() + timedelta(minutes=wait_minutes)
            row.last_error = str(exc)[:1000]
            row.status = "pending" if row.attempts < 12 else "failed"
            if row.status == "failed":
                failed += 1

    if attempted:
        session.commit()
    return {"attempted": attempted, "uploaded": uploaded, "failed": failed}


def _mirror_to_storage_or_queue(
    *,
    tenant_id: str,
    filename: str,
    content_type: str | None,
    file_bytes: bytes,
    session: Session,
) -> tuple[str, str | None]:
    if not file_bytes:
        return "skip", None

    if not _r2_is_configured():
        _enqueue_storage_upload(
            tenant_id=tenant_id,
            filename=filename,
            content_type=content_type,
            file_bytes=file_bytes,
            session=session,
            error_reason="R2 não configurado no momento da ingestão",
        )
        return "queued", None

    try:
        object_key = _upload_bytes_to_r2(
            tenant_id=tenant_id,
            filename=filename,
            content_type=content_type,
            file_bytes=file_bytes,
        )
        return "uploaded", object_key
    except Exception as exc:
        _enqueue_storage_upload(
            tenant_id=tenant_id,
            filename=filename,
            content_type=content_type,
            file_bytes=file_bytes,
            session=session,
            error_reason=f"Falha no upload imediato para R2: {exc}",
        )
        return "queued", None


def _storage_queue_worker_loop(interval_seconds: int = 60) -> None:
    while not STORAGE_QUEUE_STOP.is_set():
        session = SessionLocal()
        try:
            _flush_storage_upload_queue(session, limit=50)
        except Exception as exc:
            logger.warning("Falha ao processar storage_upload_queue em background: %s", exc)
        finally:
            session.close()
        STORAGE_QUEUE_STOP.wait(interval_seconds)


def expand_zip_upload(upload: UploadFile) -> list[UploadFile]:
    buffer = upload.file.read()
    upload.file.seek(0)
    expanded: list[UploadFile] = []
    total_uncompressed = 0
    try:
        with zipfile.ZipFile(io.BytesIO(buffer)) as archive:
            members = [info for info in archive.infolist() if not info.is_dir()]
            if len(members) > MAX_ZIP_MEMBERS:
                raise HTTPException(status_code=400, detail=f'ZIP excede o limite de {MAX_ZIP_MEMBERS} ficheiros')
            for member in members:
                filename = os.path.basename(member.filename) or 'documento.zip'
                if member.file_size > MAX_ZIP_MEMBER_SIZE:
                    raise HTTPException(status_code=400, detail=f'Ficheiro {filename} excede o limite de 20 MB dentro do ZIP')
                total_uncompressed += member.file_size
                if total_uncompressed > MAX_ZIP_TOTAL_UNCOMPRESSED:
                    raise HTTPException(status_code=400, detail='ZIP excede o limite total de 100 MB descomprimidos')
                data = archive.read(member)
                file_obj = io.BytesIO(data)
                expanded.append(UploadFile(filename=filename, file=file_obj))
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail='Arquivo ZIP inválido') from exc
    return expanded


def format_invoice_context(invoice: Invoice) -> str:
    currency = invoice.currency or "EUR"
    header = f"Fatura {invoice.invoice_number or invoice.id} do fornecedor {invoice.vendor or 'desconhecido'}"
    dates = f"Emitida em {invoice.invoice_date or 'data desconhecida'} (vencimento {invoice.due_date or 'n/d'})"
    totals = f"Subtotal {invoice.subtotal or 0} {currency} · IVA {invoice.tax or 0} {currency} · Total {invoice.total or 0} {currency}"
    lines = []
    for item in (invoice.line_items or [])[:5]:
        lines.append(
            f"- {item.description or 'Item'} (cód. {item.code or '—'}): {item.line_total or item.line_subtotal or 0} {currency} (Qtd {item.quantity or 0})"
        )
    if not lines:
        lines.append("- Sem linhas registadas")
    return "\n".join([header, dates, totals, "Linhas:", *lines])


def build_chat_answer(question: str, contexts: list[str]) -> str:
    if not settings.openai_api_key:
        return "Serviço de IA indisponível (OPENAI_API_KEY em falta)."
    context_text = "\n\n".join(contexts)
    prompt = (
        "Responde em português (Portugal) com base apenas nas faturas abaixo. "
        "Se a pergunta não estiver coberta, diz que não tens dados suficientes.\n\n"
        f"Dados das faturas:\n{context_text}\n\n"
        f"Pergunta: {question}\nResposta:"
    )
    try:
        client = OpenAI(api_key=settings.openai_api_key)
        response = client.responses.create(
            model=settings.extraction_model,
            input=prompt,
            max_output_tokens=500,
        )
        answer = getattr(response, "output_text", "") or ""
        return answer.strip() or "Não encontrei uma resposta com os dados disponíveis."
    except Exception as exc:
        logger.warning("Falha ao gerar resposta: %s", exc)
        return "Não consegui gerar uma resposta com os dados disponíveis."


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    STORAGE_QUEUE_STOP.clear()
    worker = threading.Thread(target=_storage_queue_worker_loop, name="storage-queue-worker", daemon=True)
    worker.start()
    try:
        yield
    finally:
        STORAGE_QUEUE_STOP.set()
        worker.join(timeout=5)


app = FastAPI(title="ViaContab API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def require_tenant(tenant_id: str | None) -> str:
    if not tenant_id:
        raise HTTPException(status_code=400, detail="tenant_id é obrigatório")
    normalized = tenant_id.strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="tenant_id é obrigatório")
    return normalized


def resolve_tenant_scope(path_tenant_id: str | None = None, header_tenant_id: str | None = None) -> str:
    path_value = require_tenant(path_tenant_id) if path_tenant_id else None
    header_value = require_tenant(header_tenant_id) if header_tenant_id else None

    if path_value and header_value and path_value != header_value:
        raise HTTPException(status_code=403, detail="tenant_id em conflito entre path e header")

    resolved = path_value or header_value
    if not resolved:
        raise HTTPException(status_code=400, detail="tenant_id é obrigatório")
    return resolved


def require_invoice_for_tenant(session: Session, invoice_id: UUID, tenant_id: str) -> Invoice:
    invoice = (
        session.query(Invoice)
        .filter(Invoice.id == invoice_id, Invoice.tenant_id == tenant_id)
        .one_or_none()
    )
    if not invoice:
        raise HTTPException(status_code=404, detail="Fatura não encontrada")
    return invoice


def require_failed_import_for_tenant(session: Session, failed_import_id: UUID, tenant_id: str) -> FailedImport:
    row = (
        session.query(FailedImport)
        .filter(FailedImport.id == failed_import_id, FailedImport.tenant_id == tenant_id)
        .one_or_none()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Falha de importação não encontrada")
    return row


def _read_upload_bytes(upload: UploadFile) -> bytes:
    upload.file.seek(0)
    content = upload.file.read()
    upload.file.seek(0)
    return content


def persist_failed_import(
    session: Session,
    *,
    tenant_id: str,
    filename: str,
    reason: str,
    detected_type: str | None = None,
    source: str = "upload",
    mime_type: str | None = None,
    file_bytes: bytes | None = None,
) -> FailedImport:
    stored_blob = file_bytes
    if stored_blob is not None and len(stored_blob) > MAX_FAILED_IMPORT_BLOB:
        stored_blob = None
        reason = f"{reason} (ficheiro excede 20MB e não foi guardado para retry automático)"

    failed = FailedImport(
        tenant_id=tenant_id,
        filename=filename,
        mime_type=mime_type,
        file_size=len(file_bytes) if file_bytes is not None else None,
        file_blob=stored_blob,
        reason=reason,
        detected_type=detected_type,
        source=source,
    )
    session.add(failed)
    session.flush()
    return failed


def compute_invoice_blockers(invoice: Invoice) -> list[dict[str, str]]:
    blockers: list[dict[str, str]] = []

    subtotal = Decimal(str(invoice.subtotal)) if invoice.subtotal is not None else None
    tax = Decimal(str(invoice.tax)) if invoice.tax is not None else None
    total = Decimal(str(invoice.total)) if invoice.total is not None else None
    if subtotal is not None and tax is not None and total is not None:
        expected_total = (subtotal + tax).quantize(Decimal("0.01"))
        if abs(expected_total - total) > Decimal("0.03"):
            blockers.append(
                {
                    "code": "totals_mismatch",
                    "severity": "error",
                    "message": "Total da fatura não fecha com subtotal + imposto",
                }
            )

    supplier_nif = normalize_digits(invoice.supplier_nif)
    customer_nif = normalize_digits(invoice.customer_nif)
    if supplier_nif and customer_nif and supplier_nif == customer_nif:
        blockers.append(
            {
                "code": "supplier_customer_same_nif",
                "severity": "error",
                "message": "NIF do fornecedor e cliente coincidem",
            }
        )

    if invoice.requires_review:
        blockers.append(
            {
                "code": "document_requires_review",
                "severity": "warning",
                "message": "Documento marcado para revisão manual",
            }
        )

    if invoice.confidence_score is not None and Decimal(str(invoice.confidence_score)) < Decimal("85"):
        blockers.append(
            {
                "code": "low_confidence_document",
                "severity": "warning",
                "message": "Confiança global baixa (<85)",
            }
        )

    line_review_count = sum(1 for line in (invoice.line_items or []) if getattr(line, "needs_review", False))
    if line_review_count > 0:
        blockers.append(
            {
                "code": "line_items_need_review",
                "severity": "warning",
                "message": f"{line_review_count} linha(s) com revisão pendente",
            }
        )

    qr_detected = "QR português detetado" in str(invoice.notes or "")
    if str(invoice.filename or "").lower().endswith(".pdf") and not qr_detected and not supplier_nif:
        blockers.append(
            {
                "code": "qr_or_supplier_missing",
                "severity": "warning",
                "message": "Sem QR/NIF de fornecedor detetado",
            }
        )

    if "DUPLICATE_CANDIDATE" in str(invoice.notes or ""):
        blockers.append(
            {
                "code": "duplicate_candidate",
                "severity": "error",
                "message": "Possível fatura duplicada",
            }
        )

    return blockers


def find_potential_duplicate_invoice(
    *,
    tenant_id: str,
    supplier_nif: str | None,
    invoice_number: str | None,
    total: Decimal | None,
    session: Session,
) -> Invoice | None:
    normalized_supplier_nif = normalize_digits(supplier_nif)
    normalized_invoice_number = normalize_label(invoice_number)
    if not normalized_invoice_number or total is None:
        return None

    candidates = (
        session.query(Invoice)
        .filter(
            Invoice.tenant_id == tenant_id,
            Invoice.total == total,
            Invoice.invoice_number.isnot(None),
        )
        .order_by(Invoice.created_at.desc())
        .limit(100)
        .all()
    )
    for candidate in candidates:
        candidate_invoice_number = normalize_label(candidate.invoice_number)
        if candidate_invoice_number != normalized_invoice_number:
            continue
        candidate_supplier_nif = normalize_digits(candidate.supplier_nif)
        if normalized_supplier_nif and candidate_supplier_nif and candidate_supplier_nif != normalized_supplier_nif:
            continue
        return candidate
    return None


@app.get("/api/health")
def health():
    return {"ok": True, "service": "viacontab-backend"}


@app.get("/api/watchtower/uploads")
def watchtower_uploads():
    snapshot = _watchtower_snapshot()
    active = snapshot["active"]
    for payload in active:
        payload["stuck"] = payload.get("duration_seconds", 0) > 90
    return {"ok": True, **snapshot}


@app.get("/api/ready")
def ready(session: Session = Depends(get_session)):
    session.execute(text("SELECT 1"))
    return {"ok": True, "service": "viacontab-backend", "ready": True}


@app.post("/api/tenants/{tenant_id}/telemetry/upload-event")
def record_upload_telemetry_event(tenant_id: str, payload: UploadTelemetryEventRequest):
    tenant_id = require_tenant(tenant_id)
    _record_upload_telemetry_event(tenant_id, payload)
    return {"ok": True}


@app.get("/api/tenants/{tenant_id}/telemetry/upload-funnel", response_model=UploadTelemetryFunnelResponse)
def upload_telemetry_funnel(tenant_id: str, hours: int = 24):
    tenant_id = require_tenant(tenant_id)
    return _summarize_upload_funnel(tenant_id, hours=hours)


@app.get("/api/tenants/{tenant_id}/profile", response_model=TenantProfileResponse)
def get_tenant_profile(tenant_id: str, session: Session = Depends(get_session)):
    tenant_id = require_tenant(tenant_id)
    profile = get_or_create_tenant_profile(tenant_id, session)
    return {"company_name": profile.company_name, "company_nif": profile.company_nif}


@app.put("/api/tenants/{tenant_id}/profile", response_model=TenantProfileResponse)
def update_tenant_profile(tenant_id: str, payload: TenantProfileRequest, session: Session = Depends(get_session)):
    tenant_id = require_tenant(tenant_id)
    profile = get_or_create_tenant_profile(tenant_id, session)
    updates = payload.model_dump(exclude_unset=True)
    if "company_name" in updates:
        profile.company_name = updates.get("company_name")
    if "company_nif" in updates:
        profile.company_nif = updates.get("company_nif")
    session.add(profile)
    session.commit()
    session.refresh(profile)
    return {"company_name": profile.company_name, "company_nif": profile.company_nif}


@app.get("/api/tenants/{tenant_id}/invoices", response_model=InvoiceListResponse)
def list_invoices(tenant_id: str, session: Session = Depends(get_session)):
    tenant_id = require_tenant(tenant_id)
    _flush_storage_upload_queue(session, limit=10)
    invoices = (
        session.query(Invoice)
        .options(selectinload(Invoice.line_items))
        .filter_by(tenant_id=tenant_id)
        .order_by(Invoice.created_at.desc())
        .all()
    )
    return {"items": [serialize_invoice(invoice) for invoice in invoices]}


@app.get("/api/tenants/{tenant_id}/invoices/{invoice_id}/pdf-url")
def invoice_pdf_url(tenant_id: str, invoice_id: UUID, session: Session = Depends(get_session)):
    tenant_id = require_tenant(tenant_id)
    invoice = require_invoice_for_tenant(session, invoice_id, tenant_id)
    object_key = str(getattr(invoice, "storage_object_key", "") or "").strip()
    if not object_key:
        raise HTTPException(status_code=404, detail="PDF não disponível no storage")

    safe_key = _assert_tenant_object_key(tenant_id, object_key)
    client = _r2_client()
    expires_in = max(60, min(int(settings.r2_presign_expiry_seconds or 300), 3600))
    url = client.generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.r2_bucket, "Key": safe_key},
        ExpiresIn=expires_in,
        HttpMethod="GET",
    )
    return {"url": url, "expires_in_seconds": expires_in, "object_key": safe_key}


@app.get("/api/tenants/{tenant_id}/failed-imports", response_model=FailedImportListResponse)
def list_failed_imports(tenant_id: str, session: Session = Depends(get_session)):
    tenant_id = require_tenant(tenant_id)
    rows = (
        session.query(FailedImport)
        .filter(FailedImport.tenant_id == tenant_id)
        .order_by(FailedImport.created_at.desc())
        .all()
    )
    return {
        "items": [FailedImportBase.model_validate(row).model_dump(mode="json") for row in rows]
    }


@app.get("/api/tenants/{tenant_id}/storage/upload-queue")
def storage_upload_queue_status(tenant_id: str, limit: int = 100, session: Session = Depends(get_session)):
    tenant_id = require_tenant(tenant_id)
    _flush_storage_upload_queue(session, limit=20)

    limit = max(1, min(limit, 500))
    rows = (
        session.query(StorageUploadQueue)
        .filter(StorageUploadQueue.tenant_id == tenant_id)
        .order_by(StorageUploadQueue.created_at.desc())
        .limit(limit)
        .all()
    )

    return {
        "summary": {
            "pending": sum(1 for row in rows if row.status == "pending"),
            "uploaded": sum(1 for row in rows if row.status == "uploaded"),
            "failed": sum(1 for row in rows if row.status == "failed"),
            "total": len(rows),
        },
        "items": [
            {
                "id": str(row.id),
                "tenant_id": row.tenant_id,
                "filename": row.filename,
                "content_type": row.content_type,
                "file_size": row.file_size,
                "status": row.status,
                "attempts": row.attempts,
                "object_key": row.object_key,
                "last_error": row.last_error,
                "next_retry_at": row.next_retry_at.isoformat() if row.next_retry_at else None,
                "created_at": row.created_at.isoformat() if row.created_at else None,
                "updated_at": row.updated_at.isoformat() if row.updated_at else None,
            }
            for row in rows
        ],
    }


@app.get("/api/tenants/{tenant_id}/automation-blockers", response_model=AutomationBlockerListResponse)
def list_automation_blockers(tenant_id: str, limit: int = 200, session: Session = Depends(get_session)):
    tenant_id = require_tenant(tenant_id)
    invoices = (
        session.query(Invoice)
        .options(joinedload(Invoice.line_items))
        .filter(Invoice.tenant_id == tenant_id)
        .order_by(Invoice.created_at.desc())
        .limit(max(20, min(limit, 1000)))
        .all()
    )
    items: list[AutomationBlockerRow] = []
    for invoice in invoices:
        blockers = compute_invoice_blockers(invoice)
        for blocker in blockers:
            items.append(
                AutomationBlockerRow(
                    invoice_id=invoice.id,
                    invoice_number=invoice.invoice_number,
                    filename=invoice.filename,
                    vendor=invoice.vendor,
                    code=blocker["code"],
                    severity=blocker["severity"],
                    message=blocker["message"],
                    created_at=invoice.created_at,
                )
            )
    return {"items": [item.model_dump(mode="json") for item in items]}


@app.get("/api/tenants/{tenant_id}/line-items/review", response_model=LineItemReviewListResponse)
def list_line_items_for_review(tenant_id: str, limit: int = 200, session: Session = Depends(get_session)):
    tenant_id = require_tenant(tenant_id)
    limit = max(20, min(limit, 1000))
    rows = (
        session.query(InvoiceLineItem, Invoice)
        .join(Invoice, InvoiceLineItem.invoice_id == Invoice.id)
        .filter(Invoice.tenant_id == tenant_id, InvoiceLineItem.needs_review.is_(True))
        .order_by(Invoice.created_at.desc(), InvoiceLineItem.position.asc())
        .limit(limit)
        .all()
    )
    items = [
        LineItemReviewRow(
            invoice_id=invoice.id,
            invoice_number=invoice.invoice_number,
            vendor=invoice.vendor,
            filename=invoice.filename,
            created_at=invoice.created_at,
            line_item_id=line.id,
            position=line.position,
            description=line.description,
            line_total=line.line_total,
            tax_rate=line.tax_rate,
            tax_rate_source=getattr(line, "tax_rate_source", None),
            normalization_confidence=line.normalization_confidence,
            review_reason=getattr(line, "review_reason", None),
        )
        for line, invoice in rows
    ]
    return {"items": [item.model_dump(mode="json") for item in items]}


@app.get("/api/tenants/{tenant_id}/line-items/suggestions", response_model=LineItemSuggestionListResponse)
def suggest_line_item_labels(
    tenant_id: str,
    query: str,
    limit: int = 8,
    session: Session = Depends(get_session),
):
    tenant_id = require_tenant(tenant_id)
    limit = max(1, min(limit, 25))
    normalized_query = normalize_catalog_lookup_label(query)
    if len(normalized_query) < 2:
        return {"items": []}

    alias_rows = (
        session.query(CatalogAlias, CatalogItem)
        .join(CatalogItem, CatalogAlias.catalog_item_id == CatalogItem.id)
        .filter(
            CatalogAlias.tenant_id == tenant_id,
            or_(
                CatalogAlias.normalized_label.ilike(f"%{normalized_query}%"),
                CatalogItem.canonical_name.ilike(f"%{normalized_query}%"),
                CatalogItem.display_name.ilike(f"%{query.strip()}%"),
            ),
        )
        .limit(200)
        .all()
    )

    ranked: dict[str, tuple[int, LineItemSuggestion]] = {}
    for alias, catalog_item in alias_rows:
        if not catalog_item.canonical_name:
            continue

        alias_label = alias.normalized_label or ""
        score = 0
        if alias_label == normalized_query:
            score += 100
        elif alias_label.startswith(normalized_query):
            score += 80
        elif normalized_query in alias_label:
            score += 60

        canonical = catalog_item.canonical_name or ""
        if canonical == normalized_query:
            score += 30
        elif canonical.startswith(normalized_query):
            score += 20
        elif normalized_query in canonical:
            score += 10

        confidence = alias.confidence
        if confidence is not None:
            score += int(float(confidence) * 10)
        score += min(int(alias.usage_confirmed_count or 0), 100) * 3
        score += min(int(alias.usage_auto_apply_count or 0), 100) * 1

        suggestion = LineItemSuggestion(
            canonical_name=catalog_item.canonical_name,
            display_name=catalog_item.display_name,
            line_type=catalog_item.item_type,
            line_category=catalog_item.category_path,
            normalized_unit=catalog_item.base_unit,
            confidence=alias.confidence,
            source=alias.source or "alias",
        )
        previous = ranked.get(catalog_item.canonical_name)
        if previous is None or score > previous[0]:
            ranked[catalog_item.canonical_name] = (score, suggestion)

    items = [entry[1] for entry in sorted(ranked.values(), key=lambda item: item[0], reverse=True)[:limit]]
    return {"items": [item.model_dump(mode="json") for item in items]}


@app.get("/api/tenants/{tenant_id}/line-items/quality", response_model=LineItemQualitySummary)
def line_items_quality_summary(tenant_id: str, session: Session = Depends(get_session)):
    tenant_id = require_tenant(tenant_id)

    total_lines = (
        session.query(func.count(InvoiceLineItem.id))
        .join(Invoice, InvoiceLineItem.invoice_id == Invoice.id)
        .filter(Invoice.tenant_id == tenant_id)
        .scalar()
        or 0
    )
    mapped_lines = (
        session.query(func.count(InvoiceLineItem.id))
        .join(Invoice, InvoiceLineItem.invoice_id == Invoice.id)
        .filter(Invoice.tenant_id == tenant_id, InvoiceLineItem.catalog_item_id.isnot(None))
        .scalar()
        or 0
    )
    review_lines = (
        session.query(func.count(InvoiceLineItem.id))
        .join(Invoice, InvoiceLineItem.invoice_id == Invoice.id)
        .filter(Invoice.tenant_id == tenant_id, InvoiceLineItem.needs_review.is_(True))
        .scalar()
        or 0
    )

    mapped_rate_pct = Decimal("0")
    if total_lines:
        mapped_rate_pct = (Decimal(mapped_lines) * Decimal("100")) / Decimal(total_lines)

    return {
        "total_lines": int(total_lines),
        "mapped_lines": int(mapped_lines),
        "review_lines": int(review_lines),
        "mapped_rate_pct": mapped_rate_pct.quantize(Decimal("0.01")),
    }


def _apply_label_to_line_item(
    *,
    tenant_id: str,
    line_item: InvoiceLineItem,
    payload: LineItemLabelRequest,
    session: Session,
) -> tuple[CatalogItem, str]:
    canonical_name = normalize_catalog_lookup_label(payload.canonical_name)
    if not canonical_name:
        raise HTTPException(status_code=400, detail="canonical_name inválido")

    catalog_item = (
        session.query(CatalogItem)
        .filter(CatalogItem.tenant_id == tenant_id, CatalogItem.canonical_name == canonical_name)
        .one_or_none()
    )
    if not catalog_item:
        catalog_item = CatalogItem(
            tenant_id=tenant_id,
            canonical_name=canonical_name,
            display_name=payload.canonical_name.strip(),
            category_path=payload.line_category,
            item_type=payload.line_type,
            base_unit=payload.normalized_unit,
        )
        session.add(catalog_item)
        session.flush()

    line_item.catalog_item_id = catalog_item.id
    if payload.line_type:
        line_item.line_type = payload.line_type
        catalog_item.item_type = payload.line_type
    if payload.line_category:
        line_item.line_category = payload.line_category
        catalog_item.category_path = payload.line_category
    if payload.normalized_unit:
        line_item.normalized_unit = payload.normalized_unit
        catalog_item.base_unit = payload.normalized_unit
    line_item.normalization_confidence = Decimal("0.99")
    line_item.needs_review = False
    line_item.review_reason = None

    alias_label = normalize_catalog_lookup_label(line_item.description or payload.canonical_name)
    if alias_label:
        alias = (
            session.query(CatalogAlias)
            .filter(CatalogAlias.tenant_id == tenant_id, CatalogAlias.normalized_label == alias_label)
            .one_or_none()
        )
        if alias:
            alias.catalog_item_id = catalog_item.id
            alias.raw_label = line_item.description or payload.canonical_name
            alias.confidence = Decimal("0.99")
            alias.source = "manual"
            alias.usage_confirmed_count = int(alias.usage_confirmed_count or 0) + 1
            alias.last_used_at = datetime.utcnow()
        else:
            session.add(
                CatalogAlias(
                    tenant_id=tenant_id,
                    raw_label=line_item.description or payload.canonical_name,
                    normalized_label=alias_label,
                    catalog_item_id=catalog_item.id,
                    confidence=Decimal("0.99"),
                    source="manual",
                    usage_confirmed_count=1,
                    usage_auto_apply_count=0,
                    last_used_at=datetime.utcnow(),
                )
            )

    session.add(line_item)
    return catalog_item, alias_label


def _auto_backfill_alias_matches(
    *,
    tenant_id: str,
    source_line_item_id: UUID,
    alias_label: str | None,
    catalog_item: CatalogItem,
    payload: LineItemLabelRequest,
    session: Session,
) -> int:
    if not alias_label:
        return 0

    updated_count = 0
    candidates = (
        session.query(InvoiceLineItem, Invoice)
        .join(Invoice, InvoiceLineItem.invoice_id == Invoice.id)
        .filter(
            Invoice.tenant_id == tenant_id,
            InvoiceLineItem.id != source_line_item_id,
            InvoiceLineItem.needs_review.is_(True),
            InvoiceLineItem.description.isnot(None),
        )
        .limit(5000)
        .all()
    )
    for candidate, _invoice in candidates:
        candidate_alias = normalize_catalog_lookup_label(candidate.description or "")
        if candidate_alias != alias_label:
            continue
        candidate.catalog_item_id = catalog_item.id
        if payload.line_type:
            candidate.line_type = payload.line_type
        if payload.line_category:
            candidate.line_category = payload.line_category
        if payload.normalized_unit:
            candidate.normalized_unit = payload.normalized_unit
        candidate.normalization_confidence = Decimal("0.97")
        candidate.needs_review = False
        candidate.review_reason = None
        session.add(candidate)
        updated_count += 1

    if updated_count > 0:
        alias = (
            session.query(CatalogAlias)
            .filter(CatalogAlias.tenant_id == tenant_id, CatalogAlias.normalized_label == alias_label)
            .one_or_none()
        )
        if alias:
            alias.usage_auto_apply_count = int(alias.usage_auto_apply_count or 0) + updated_count
            alias.last_used_at = datetime.utcnow()

    return updated_count


@app.post("/api/tenants/{tenant_id}/line-items/{line_item_id}/label", response_model=InvoiceLineItemBase)
def label_line_item(
    tenant_id: str,
    line_item_id: UUID,
    payload: LineItemLabelRequest,
    session: Session = Depends(get_session),
):
    tenant_id = require_tenant(tenant_id)
    line_item = session.get(InvoiceLineItem, line_item_id)
    if not line_item:
        raise HTTPException(status_code=404, detail="Linha não encontrada")
    invoice = session.get(Invoice, line_item.invoice_id)
    if not invoice or invoice.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Linha não encontrada para este tenant")

    catalog_item, alias_label = _apply_label_to_line_item(
        tenant_id=tenant_id,
        line_item=line_item,
        payload=payload,
        session=session,
    )
    _auto_backfill_alias_matches(
        tenant_id=tenant_id,
        source_line_item_id=line_item.id,
        alias_label=alias_label,
        catalog_item=catalog_item,
        payload=payload,
        session=session,
    )
    session.commit()
    session.refresh(line_item)
    return line_item


@app.post("/api/tenants/{tenant_id}/line-items/{line_item_id}/label-bulk", response_model=LineItemBulkLabelResponse)
def label_line_item_bulk(
    tenant_id: str,
    line_item_id: UUID,
    payload: LineItemLabelRequest,
    scope: str = "vendor",
    session: Session = Depends(get_session),
):
    tenant_id = require_tenant(tenant_id)
    if scope not in {"vendor", "tenant"}:
        raise HTTPException(status_code=400, detail="scope inválido (use vendor ou tenant)")

    line_item = session.get(InvoiceLineItem, line_item_id)
    if not line_item:
        raise HTTPException(status_code=404, detail="Linha não encontrada")
    invoice = session.get(Invoice, line_item.invoice_id)
    if not invoice or invoice.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Linha não encontrada para este tenant")

    catalog_item, alias_label = _apply_label_to_line_item(
        tenant_id=tenant_id,
        line_item=line_item,
        payload=payload,
        session=session,
    )

    if alias_label:
        query = (
            session.query(InvoiceLineItem, Invoice)
            .join(Invoice, InvoiceLineItem.invoice_id == Invoice.id)
            .filter(
                Invoice.tenant_id == tenant_id,
                InvoiceLineItem.id != line_item.id,
                InvoiceLineItem.needs_review.is_(True),
                InvoiceLineItem.description.isnot(None),
            )
        )
        if scope == "vendor":
            query = query.filter(Invoice.vendor == invoice.vendor)

        updated_count = 1
        for candidate, _candidate_invoice in query.limit(1000).all():
            candidate_alias_label = normalize_catalog_lookup_label(candidate.description or "")
            if candidate_alias_label != alias_label:
                continue
            candidate.catalog_item_id = catalog_item.id
            if payload.line_type:
                candidate.line_type = payload.line_type
            if payload.line_category:
                candidate.line_category = payload.line_category
            if payload.normalized_unit:
                candidate.normalized_unit = payload.normalized_unit
            candidate.normalization_confidence = Decimal("0.99")
            candidate.needs_review = False
            candidate.review_reason = None
            session.add(candidate)
            updated_count += 1

        if updated_count > 1:
            alias = (
                session.query(CatalogAlias)
                .filter(CatalogAlias.tenant_id == tenant_id, CatalogAlias.normalized_label == alias_label)
                .one_or_none()
            )
            if alias:
                alias.usage_auto_apply_count = int(alias.usage_auto_apply_count or 0) + (updated_count - 1)
                alias.last_used_at = datetime.utcnow()
    else:
        updated_count = 1

    session.commit()
    return {"line_item_id": line_item.id, "updated_count": updated_count}


@app.get("/api/tenants/{tenant_id}/cost-trends", response_model=CostTrendResponse)
def cost_trends(
    tenant_id: str,
    item_query: str,
    days: int = 90,
    vendor: str | None = None,
    limit: int = 400,
    session: Session = Depends(get_session),
):
    tenant_id = require_tenant(tenant_id)
    item_query = item_query.strip()
    if len(item_query) < 2:
        raise HTTPException(status_code=400, detail="item_query deve ter pelo menos 2 caracteres")
    days = max(7, min(days, 365))
    limit = max(20, min(limit, 2000))

    normalized_query = normalize_label(item_query)
    now = datetime.utcnow()
    current_start = now - timedelta(days=days)
    previous_start = current_start - timedelta(days=days)

    query = (
        session.query(InvoiceLineItem, Invoice, CatalogItem)
        .join(Invoice, InvoiceLineItem.invoice_id == Invoice.id)
        .outerjoin(CatalogItem, InvoiceLineItem.catalog_item_id == CatalogItem.id)
        .filter(Invoice.tenant_id == tenant_id, Invoice.created_at >= previous_start)
    )
    if vendor:
        query = query.filter(func.lower(Invoice.vendor) == vendor.strip().lower())

    like_query = f"%{normalized_query}%"
    query = query.filter(
        (func.lower(func.coalesce(InvoiceLineItem.normalized_description, "")).like(like_query))
        | (func.lower(func.coalesce(InvoiceLineItem.description, "")).like(like_query))
        | (func.lower(func.coalesce(CatalogItem.canonical_name, "")).like(like_query))
    )

    rows = query.order_by(Invoice.created_at.desc()).limit(limit).all()

    points: list[CostTrendPoint] = []
    current_prices: list[Decimal] = []
    previous_prices: list[Decimal] = []
    for line_item, invoice, catalog_item in rows:
        unit_price = line_item.normalized_unit_price
        if unit_price is None:
            unit_price = infer_normalized_unit_price(
                quantity=line_item.quantity,
                unit_price=line_item.unit_price,
                line_subtotal=line_item.line_subtotal,
                line_total=line_item.line_total,
            )

        points.append(
            CostTrendPoint(
                invoice_id=invoice.id,
                invoice_number=invoice.invoice_number,
                vendor=invoice.vendor,
                created_at=invoice.created_at,
                description=line_item.description,
                canonical_item=catalog_item.canonical_name if catalog_item else line_item.normalized_description,
                normalized_unit=line_item.normalized_unit,
                normalized_quantity=line_item.normalized_quantity or line_item.quantity,
                normalized_unit_price=unit_price,
            )
        )
        if unit_price is None:
            continue
        if invoice.created_at >= current_start:
            current_prices.append(unit_price)
        else:
            previous_prices.append(unit_price)

    def avg(values: list[Decimal]) -> Decimal | None:
        if not values:
            return None
        return (sum(values) / Decimal(len(values))).quantize(Decimal("0.0001"))

    current_avg = avg(current_prices)
    previous_avg = avg(previous_prices)
    pct_change: Decimal | None = None
    if current_avg is not None and previous_avg not in (None, Decimal("0")):
        pct_change = (((current_avg - previous_avg) / previous_avg) * Decimal("100")).quantize(Decimal("0.01"))

    return CostTrendResponse(
        summary=CostTrendSummary(
            current_avg_unit_price=current_avg,
            previous_avg_unit_price=previous_avg,
            pct_change=pct_change,
            sample_size_current=len(current_prices),
            sample_size_previous=len(previous_prices),
            days=days,
            vendor=vendor,
            item_query=item_query,
        ),
        points=points,
    )


def serialize_invoice(invoice: Invoice) -> dict[str, Any]:
    learning_debug = getattr(invoice, "learning_debug", None)
    if isinstance(learning_debug, str):
        try:
            learning_debug = json.loads(learning_debug)
        except json.JSONDecodeError:
            learning_debug = None

    payload = InvoiceBase.model_validate(
        {
            "id": invoice.id,
            "tenant_id": invoice.tenant_id,
            "filename": invoice.filename,
            "storage_object_key": getattr(invoice, "storage_object_key", None),
            "vendor": invoice.vendor,
            "vendor_address": invoice.vendor_address,
            "vendor_contact": invoice.vendor_contact,
            "category": invoice.category,
            "subtotal": invoice.subtotal,
            "tax": invoice.tax,
            "total": invoice.total,
            "supplier_nif": invoice.supplier_nif,
            "customer_name": invoice.customer_name,
            "customer_nif": invoice.customer_nif,
            "invoice_number": invoice.invoice_number,
            "invoice_date": invoice.invoice_date,
            "due_date": invoice.due_date,
            "currency": invoice.currency,
            "raw_text": invoice.raw_text,
            "ai_payload": invoice.ai_payload,
            "extraction_model": invoice.extraction_model,
            "token_input": invoice.token_input,
            "token_output": invoice.token_output,
            "token_total": invoice.token_total,
            "confidence_score": invoice.confidence_score,
            "requires_review": invoice.requires_review,
            "notes": invoice.notes,
            "line_items": invoice.line_items,
            "learning_debug": learning_debug,
            "status": invoice.status,
            "created_at": invoice.created_at,
        }
    ).model_dump(mode="json")
    return payload


@app.patch("/api/invoices/{invoice_id}", response_model=InvoiceBase)
def update_invoice(
    invoice_id: UUID,
    payload: InvoiceUpdateRequest,
    session: Session = Depends(get_session),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
):
    tenant_id = resolve_tenant_scope(header_tenant_id=x_tenant_id)
    invoice = require_invoice_for_tenant(session, invoice_id, tenant_id)

    updates = payload.model_dump(exclude_unset=True)
    line_items_payload = updates.pop("line_items", None)
    for field, value in updates.items():
        setattr(invoice, field, value)

    if line_items_payload is not None:
        default_tax_rate = infer_default_tax_rate(invoice.subtotal, invoice.tax)
        session.query(InvoiceLineItem).filter(InvoiceLineItem.invoice_id == invoice.id).delete()
        for index, item in enumerate(line_items_payload, start=1):
            enriched = enrich_line_item_payload(
                item,
                tenant_id=invoice.tenant_id,
                session=session,
                default_tax_rate=default_tax_rate,
                vendor_name=invoice.vendor,
            )
            session.add(
                InvoiceLineItem(
                    invoice_id=invoice.id,
                    position=index,
                    code=enriched.get("code"),
                    description=enriched.get("description"),
                    normalized_description=enriched.get("normalized_description"),
                    quantity=enriched.get("quantity"),
                    unit_price=enriched.get("unit_price"),
                    line_subtotal=enriched.get("line_subtotal"),
                    line_tax_amount=enriched.get("line_tax_amount"),
                    line_total=enriched.get("line_total"),
                    tax_rate=enriched.get("tax_rate"),
                    tax_rate_source=enriched.get("tax_rate_source"),
                    catalog_item_id=enriched.get("catalog_item_id"),
                    raw_unit=enriched.get("raw_unit"),
                    normalized_unit=enriched.get("normalized_unit"),
                        measurement_type=enriched.get("measurement_type"),
                        normalized_quantity=enriched.get("normalized_quantity"),
                        normalized_unit_price=enriched.get("normalized_unit_price"),
                        line_category=enriched.get("line_category"),
                        line_type=enriched.get("line_type"),
                        normalization_confidence=enriched.get("normalization_confidence"),
                        needs_review=bool(enriched.get("needs_review", False)),
                        review_reason=enriched.get("review_reason"),
                    )
                )

    session.add(invoice)
    upsert_vendor_profile(invoice, session)
    upsert_invoice_template(invoice, session)
    promote_manual_line_item_aliases(invoice, session)
    session.commit()
    session.refresh(invoice)
    invoice.line_items  # trigger lazy load for response
    return serialize_invoice(invoice)


def _process_upload_for_ingest(
    *,
    tenant_id: str,
    upload: UploadFile,
    session: Session,
    source: str = "upload",
    persist_failure_record: bool = True,
    storage_object_key: str | None = None,
) -> tuple[Invoice | None, RejectedDocument | None]:
    started_at = time.monotonic()
    filename = upload.filename or "documento"
    task_id = f"{tenant_id}:{filename}:{time.time_ns()}"
    _watchtower_start(task_id, tenant_id=tenant_id, filename=filename)
    logger.info("Starting ingest for %s (tenant=%s)", filename, tenant_id)

    upload_bytes_cache: bytes | None = None

    def _get_upload_bytes() -> bytes:
        nonlocal upload_bytes_cache
        if upload_bytes_cache is None:
            upload_bytes_cache = _read_upload_bytes(upload)
        return upload_bytes_cache

    try:
        _watchtower_stage(task_id, "precheck")
        should_process, detected_type, validation_reason, cached_text, cached_raw, precheck_usage = precheck_invoice_candidate(upload)
        logger.info(
            "Precheck finished for %s in %.2fs (should_process=%s, detected_type=%s)",
            filename,
            time.monotonic() - started_at,
            should_process,
            detected_type,
        )
        if not should_process:
            reason = validation_reason or "Documento inválido para processamento de faturas"
            _watchtower_finish(task_id, status="rejected", reason=reason)
            session.rollback()
            if persist_failure_record:
                persist_failed_import(
                    session,
                    tenant_id=tenant_id,
                    filename=filename,
                    reason=reason,
                    detected_type=detected_type,
                    source=source,
                    mime_type=upload.content_type,
                    file_bytes=_get_upload_bytes(),
                )
            session.commit()
            return None, RejectedDocument(filename=filename, reason=reason, detected_type=detected_type)

        learning_debug = init_learning_debug()
        _watchtower_stage(task_id, "extraction")
        with ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(
                extract_invoice_data,
                upload,
                cached_text,
                cached_raw,
                precheck_usage,
            )
            extraction = future.result(timeout=90)
        logger.info(
            "Extraction finished for %s in %.2fs (is_invoice=%s, detected_type=%s)",
            filename,
            time.monotonic() - started_at,
            extraction.get("is_invoice"),
            extraction.get("detected_type"),
        )

        if not extraction.get("is_invoice"):
            filename_hint = normalize_label(filename)
            has_invoice_filename = any(token in filename_hint for token in ["fatura", "factura", "invoice"])
            has_financial_signals = any(
                extraction.get(field) is not None
                for field in ["subtotal", "tax", "total", "invoice_number", "supplier_nif"]
            )
            if has_invoice_filename and has_financial_signals:
                extraction["is_invoice"] = True
                extraction["detected_type"] = "invoice_filename_hint"
                extraction["validation_reason"] = "Accepted by filename + financial signal heuristic"

        if not extraction.get("is_invoice"):
            reason = extraction.get("validation_reason") or "Documento inválido para processamento de faturas"
            detected = extraction.get("detected_type")
            _watchtower_finish(task_id, status="rejected", reason=reason)
            session.rollback()
            if persist_failure_record:
                persist_failed_import(
                    session,
                    tenant_id=tenant_id,
                    filename=filename,
                    reason=reason,
                    detected_type=detected,
                    source=source,
                    mime_type=upload.content_type,
                    file_bytes=_get_upload_bytes(),
                )
            session.commit()
            return None, RejectedDocument(filename=filename, reason=reason, detected_type=detected)

        _watchtower_stage(task_id, "template")
        extraction = apply_template_to_extraction(extraction, tenant_id, session, debug=learning_debug)
        extraction = apply_tenant_defaults_to_extraction(extraction, tenant_id, session)
        extraction = apply_counterparty_nif_heuristics(extraction, tenant_id, session)
        extraction = apply_vendor_profile_enrichment(extraction, tenant_id, session)

        extracted_line_items = extraction.get("line_items")
        missing_line_items = not _has_meaningful_line_items(extracted_line_items)

        line_items_payload = _ensure_line_items(extraction, upload.filename)
        extraction["line_items"] = line_items_payload
        confidence_score, requires_review = score_extraction_confidence(extraction)
        if missing_line_items:
            requires_review = True
            marker = "AUTO: linhas em falta/vazias — validar manualmente"
            existing_notes = str(extraction.get("notes") or "").strip()
            extraction["notes"] = f"{existing_notes} | {marker}" if existing_notes else marker

        duplicate_candidate = find_potential_duplicate_invoice(
            tenant_id=tenant_id,
            supplier_nif=extraction.get("supplier_nif"),
            invoice_number=extraction.get("invoice_number"),
            total=_to_decimal_safe(extraction.get("total"), quant="0.01"),
            session=session,
        )
        if duplicate_candidate is not None:
            requires_review = True
            duplicate_marker = f"DUPLICATE_CANDIDATE: provável duplicada de {duplicate_candidate.id}"
            existing_notes = str(extraction.get("notes") or "").strip()
            extraction["notes"] = f"{existing_notes} | {duplicate_marker}" if existing_notes else duplicate_marker

        extraction["confidence_score"] = confidence_score
        extraction["requires_review"] = requires_review

        _watchtower_stage(task_id, "db_write")
        invoice = Invoice(
            tenant_id=tenant_id,
            filename=filename,
            storage_object_key=storage_object_key,
            vendor=extraction["vendor"],
            vendor_address=extraction.get("vendor_address"),
            vendor_contact=extraction.get("vendor_contact"),
            category=extraction["category"],
            subtotal=extraction["subtotal"],
            tax=extraction["tax"],
            total=extraction["total"],
            supplier_nif=extraction.get("supplier_nif"),
            customer_name=extraction.get("customer_name"),
            customer_nif=extraction.get("customer_nif"),
            invoice_number=extraction.get("invoice_number"),
            invoice_date=extraction.get("invoice_date"),
            due_date=extraction.get("due_date"),
            currency=extraction.get("currency"),
            raw_text=extraction.get("raw_text"),
            ai_payload=extraction.get("ai_payload"),
            extraction_model=extraction.get("extraction_model"),
            token_input=extraction.get("token_input"),
            token_output=extraction.get("token_output"),
            token_total=extraction.get("token_total"),
            confidence_score=extraction.get("confidence_score"),
            requires_review=bool(extraction.get("requires_review", False)),
            notes=extraction["notes"],
            status="requere revisao" if extraction.get("requires_review") else "processed",
        )
        session.add(invoice)
        session.flush()
        default_tax_rate = infer_default_tax_rate(invoice.subtotal, invoice.tax)

        for index, item in enumerate(line_items_payload, start=1):
            enriched = enrich_line_item_payload(
                item,
                tenant_id=tenant_id,
                session=session,
                default_tax_rate=default_tax_rate,
                vendor_name=invoice.vendor,
            )
            session.add(
                InvoiceLineItem(
                    invoice_id=invoice.id,
                    position=enriched.get("position") or index,
                    code=enriched.get("code"),
                    description=enriched.get("description"),
                    normalized_description=enriched.get("normalized_description"),
                    quantity=enriched.get("quantity"),
                    unit_price=enriched.get("unit_price"),
                    line_subtotal=enriched.get("line_subtotal"),
                    line_tax_amount=enriched.get("line_tax_amount"),
                    line_total=enriched.get("line_total"),
                    tax_rate=enriched.get("tax_rate"),
                    tax_rate_source=enriched.get("tax_rate_source"),
                    catalog_item_id=enriched.get("catalog_item_id"),
                    raw_unit=enriched.get("raw_unit"),
                    normalized_unit=enriched.get("normalized_unit"),
                    measurement_type=enriched.get("measurement_type"),
                    normalized_quantity=enriched.get("normalized_quantity"),
                    normalized_unit_price=enriched.get("normalized_unit_price"),
                    line_category=enriched.get("line_category"),
                    line_type=enriched.get("line_type"),
                    normalization_confidence=enriched.get("normalization_confidence"),
                    needs_review=bool(enriched.get("needs_review", False)),
                    review_reason=enriched.get("review_reason"),
                )
            )

        if settings.debug_learning:
            invoice.learning_debug = json.dumps(learning_debug)
        session.flush()
        upsert_vendor_profile(invoice, session)
        upsert_invoice_template(invoice, session)
        session.commit()
        session.refresh(invoice)
        invoice.line_items
        logger.info(
            "DB write finished for %s in %.2fs (invoice_id=%s)",
            filename,
            time.monotonic() - started_at,
            invoice.id,
        )
        _watchtower_finish(task_id, status="ingested")
        return invoice, None
    except InvalidDocumentError as exc:
        logger.warning("Documento inválido %s: %s", filename, exc)
        session.rollback()
        _watchtower_finish(task_id, status="rejected", reason=str(exc))
        if persist_failure_record:
            persist_failed_import(
                session,
                tenant_id=tenant_id,
                filename=filename,
                reason=str(exc),
                detected_type="invalid_document",
                source=source,
                mime_type=upload.content_type,
                file_bytes=_get_upload_bytes(),
            )
        session.commit()
        return None, RejectedDocument(filename=filename, reason=str(exc), detected_type="invalid_document")
    except FutureTimeout:
        logger.warning("Timeout ao processar documento %s", filename)
        session.rollback()
        _watchtower_finish(task_id, status="rejected", reason="processing_timeout")
        reason = "Tempo limite excedido durante extração (90s por ficheiro)"
        if persist_failure_record:
            persist_failed_import(
                session,
                tenant_id=tenant_id,
                filename=filename,
                reason=reason,
                detected_type="processing_timeout",
                source=source,
                mime_type=upload.content_type,
                file_bytes=_get_upload_bytes(),
            )
        session.commit()
        return None, RejectedDocument(filename=filename, reason=reason, detected_type="processing_timeout")
    except Exception as exc:
        logger.exception("Falha ao processar documento %s: %s", filename, exc)
        session.rollback()
        _watchtower_finish(task_id, status="rejected", reason="processing_error")
        reason = "Falha técnica ao analisar o documento"
        if persist_failure_record:
            persist_failed_import(
                session,
                tenant_id=tenant_id,
                filename=filename,
                reason=reason,
                detected_type="processing_error",
                source=source,
                mime_type=upload.content_type,
                file_bytes=_get_upload_bytes(),
            )
        session.commit()
        return None, RejectedDocument(filename=filename, reason=reason, detected_type="processing_error")


@app.post("/api/tenants/{tenant_id}/ingest", response_model=IngestResponse)
def ingest_invoices(
    tenant_id: str,
    background_tasks: BackgroundTasks,
    files: List[UploadFile] = File(...),
    session: Session = Depends(get_session),
):
    tenant_id = require_tenant(tenant_id)
    _flush_storage_upload_queue(session, limit=20)
    if not files:
        raise HTTPException(status_code=400, detail="Selecione pelo menos um ficheiro")

    files_to_process: List[tuple[UploadFile, str]] = []
    rejected_rows: list[RejectedDocument] = []
    for upload in files:
        filename = (upload.filename or "").lower()
        if filename.endswith(".zip"):
            try:
                expanded = expand_zip_upload(upload)
                files_to_process.extend((item, "zip_entry") for item in expanded)
            except HTTPException as exc:
                detail = str(exc.detail)
                upload_bytes = _read_upload_bytes(upload)
                session.rollback()
                persist_failed_import(
                    session,
                    tenant_id=tenant_id,
                    filename=upload.filename or "documento.zip",
                    reason=f"Falha ao expandir ZIP: {detail}",
                    detected_type="zip_error",
                    source="zip_archive",
                    mime_type=upload.content_type,
                    file_bytes=upload_bytes,
                )
                session.commit()
                rejected_rows.append(
                    RejectedDocument(
                        filename=upload.filename or "documento.zip",
                        reason=f"Falha ao expandir ZIP: {detail}",
                        detected_type="zip_error",
                    )
                )
        else:
            files_to_process.append((upload, "upload"))

    if not files_to_process and not rejected_rows:
        raise HTTPException(status_code=400, detail="Selecione pelo menos um ficheiro")

    ingested_rows: list[Invoice] = []
    for upload, source in files_to_process:
        upload_bytes = _read_upload_bytes(upload)
        invoice, rejection = _process_upload_for_ingest(tenant_id=tenant_id, upload=upload, session=session, source=source)
        if invoice:
            ingested_rows.append(invoice)
            if source != "r2":
                _, mirror_object_key = _mirror_to_storage_or_queue(
                    tenant_id=tenant_id,
                    filename=upload.filename or invoice.filename,
                    content_type=upload.content_type,
                    file_bytes=upload_bytes,
                    session=session,
                )
                if mirror_object_key and not getattr(invoice, "storage_object_key", None):
                    invoice.storage_object_key = mirror_object_key
                    session.add(invoice)
                    session.commit()
        if rejection:
            rejected_rows.append(rejection)

    logger.info("Committed ingest batch for tenant=%s (ingested=%s, rejected=%s)", tenant_id, len(ingested_rows), len(rejected_rows))

    for invoice in ingested_rows:
        background_tasks.add_task(enqueue_invoice_embedding_job, invoice.id)

    return {
        "ingested": [serialize_invoice(invoice) for invoice in ingested_rows],
        "rejected": [item.model_dump() for item in rejected_rows],
    }


@app.post("/api/tenants/{tenant_id}/storage/uploads/init", response_model=StorageUploadInitResponse)
def init_storage_upload(tenant_id: str, payload: StorageUploadInitRequest):
    tenant_id = require_tenant(tenant_id)
    if payload.file_size is not None and payload.file_size > MAX_R2_OBJECT_SIZE:
        raise HTTPException(status_code=400, detail="Ficheiro excede o limite de 50MB")

    client = _r2_client()
    expires_in = max(60, min(int(settings.r2_presign_expiry_seconds or 300), 3600))
    filename = _sanitize_storage_filename(payload.filename)
    object_key = _build_tenant_object_key(tenant_id, filename)

    params: dict[str, Any] = {
        "Bucket": settings.r2_bucket,
        "Key": object_key,
    }
    content_type = (payload.content_type or "").strip()
    if content_type:
        params["ContentType"] = content_type

    upload_url = client.generate_presigned_url(
        "put_object",
        Params=params,
        ExpiresIn=expires_in,
        HttpMethod="PUT",
    )

    return {
        "bucket": settings.r2_bucket,
        "object_key": object_key,
        "upload_url": upload_url,
        "expires_in_seconds": expires_in,
    }


@app.post("/api/tenants/{tenant_id}/storage/uploads/complete", response_model=IngestResponse)
def complete_storage_upload(
    tenant_id: str,
    payload: StorageUploadCompleteRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
):
    tenant_id = require_tenant(tenant_id)
    object_key = _assert_tenant_object_key(tenant_id, payload.object_key)
    client = _r2_client()

    try:
        head = client.head_object(Bucket=settings.r2_bucket, Key=object_key)
    except ClientError as exc:
        code = str(exc.response.get("Error", {}).get("Code", ""))
        if code in {"404", "NoSuchKey", "NotFound"}:
            raise HTTPException(status_code=404, detail="Objeto não encontrado no bucket") from exc
        logger.warning("Falha head_object no R2 (%s): %s", object_key, exc)
        raise HTTPException(status_code=502, detail="Falha ao validar objeto no storage") from exc

    content_length = int(head.get("ContentLength") or 0)
    if content_length <= 0:
        raise HTTPException(status_code=400, detail="Objeto vazio no storage")
    if content_length > MAX_R2_OBJECT_SIZE:
        raise HTTPException(status_code=400, detail="Ficheiro excede o limite de 50MB")

    try:
        response = client.get_object(Bucket=settings.r2_bucket, Key=object_key)
        body_stream = response.get("Body")
        file_bytes = body_stream.read() if body_stream else b""
    except ClientError as exc:
        logger.warning("Falha get_object no R2 (%s): %s", object_key, exc)
        raise HTTPException(status_code=502, detail="Falha ao ler objeto no storage") from exc

    if not file_bytes:
        raise HTTPException(status_code=400, detail="Objeto vazio no storage")

    fallback_name = os.path.basename(object_key) or "documento"
    filename = _sanitize_storage_filename(payload.filename or fallback_name)
    upload_content_type = (payload.content_type or str(head.get("ContentType") or "")).strip()
    upload_headers = Headers({"content-type": upload_content_type}) if upload_content_type else None
    upload = UploadFile(filename=filename, file=io.BytesIO(file_bytes), headers=upload_headers)

    invoice, rejection = _process_upload_for_ingest(
        tenant_id=tenant_id,
        upload=upload,
        session=session,
        source="r2",
        storage_object_key=object_key,
    )

    ingested_rows: list[Invoice] = [invoice] if invoice else []
    rejected_rows: list[RejectedDocument] = [rejection] if rejection else []

    for ingested in ingested_rows:
        background_tasks.add_task(enqueue_invoice_embedding_job, ingested.id)

    return {
        "ingested": [serialize_invoice(ingested) for ingested in ingested_rows],
        "rejected": [item.model_dump() for item in rejected_rows],
    }


@app.post("/api/tenants/{tenant_id}/chat", response_model=ChatResponse)
def chat_with_invoices(tenant_id: str, payload: ChatRequest, session: Session = Depends(get_session)):
    tenant_id = require_tenant(tenant_id)
    hits = search_invoice_embeddings(payload.question, tenant_id=tenant_id, top_k=payload.top_k)
    if not hits:
        return ChatResponse(answer="Não encontrei dados suficientes para responder.", references=[])

    invoice_ids: list[UUID] = []
    for hit in hits:
        invoice_id = hit.payload.get("invoice_id") if hit.payload else None
        if invoice_id:
            try:
                invoice_ids.append(UUID(invoice_id))
            except ValueError:
                continue

    invoices: list[Invoice] = []
    if invoice_ids:
        invoices = (
            session.query(Invoice)
            .options(selectinload(Invoice.line_items))
            .filter(Invoice.id.in_(invoice_ids), Invoice.tenant_id == tenant_id)
            .all()
        )
    invoice_map = {str(inv.id): inv for inv in invoices}

    contexts: list[str] = []
    references: list[dict[str, Any]] = []
    for hit in hits:
        payload_hit = hit.payload or {}
        invoice_id = payload_hit.get("invoice_id")
        invoice = invoice_map.get(invoice_id)
        if not invoice:
            continue
        contexts.append(format_invoice_context(invoice))
        references.append(
            {
                "invoice_id": invoice.id,
                "vendor": invoice.vendor,
                "invoice_number": invoice.invoice_number,
                "score": hit.score,
            }
        )

    if not contexts:
        return ChatResponse(answer="Não encontrei dados suficientes para responder.", references=[])

    answer = build_chat_answer(payload.question, contexts)
    return ChatResponse(answer=answer, references=references)


@app.delete("/api/invoices/{invoice_id}")
def delete_invoice(
    invoice_id: UUID,
    session: Session = Depends(get_session),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
):
    tenant_id = resolve_tenant_scope(header_tenant_id=x_tenant_id)
    invoice = require_invoice_for_tenant(session, invoice_id, tenant_id)

    session.delete(invoice)
    session.commit()
    return {"ok": True}


@app.delete("/api/failed-imports/{failed_import_id}")
def delete_failed_import(
    failed_import_id: UUID,
    session: Session = Depends(get_session),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
):
    tenant_id = resolve_tenant_scope(header_tenant_id=x_tenant_id)
    row = require_failed_import_for_tenant(session, failed_import_id, tenant_id)
    session.delete(row)
    session.commit()
    return {"ok": True}


@app.post("/api/failed-imports/{failed_import_id}/retry")
def retry_failed_import(
    failed_import_id: UUID,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
):
    tenant_id = resolve_tenant_scope(header_tenant_id=x_tenant_id)
    row = require_failed_import_for_tenant(session, failed_import_id, tenant_id)
    if not row.file_blob:
        raise HTTPException(status_code=400, detail="Este ficheiro não foi guardado para retry automático")

    filename = row.filename or "documento"
    upload = UploadFile(filename=filename, file=io.BytesIO(row.file_blob))

    row.retry_count = (row.retry_count or 0) + 1
    row.last_retry_at = datetime.utcnow()
    session.add(row)
    session.commit()

    invoice, rejection = _process_upload_for_ingest(
        tenant_id=tenant_id,
        upload=upload,
        session=session,
        source="retry",
        persist_failure_record=False,
    )

    if invoice:
        current = (
            session.query(FailedImport)
            .filter(FailedImport.id == failed_import_id, FailedImport.tenant_id == tenant_id)
            .one_or_none()
        )
        if current:
            session.delete(current)
            session.commit()
        background_tasks.add_task(enqueue_invoice_embedding_job, invoice.id)
        return {"ok": True, "ingested": serialize_invoice(invoice), "rejected": None}

    if rejection:
        current = (
            session.query(FailedImport)
            .filter(FailedImport.id == failed_import_id, FailedImport.tenant_id == tenant_id)
            .one_or_none()
        )
        if current:
            current.reason = rejection.reason
            current.detected_type = rejection.detected_type
            session.add(current)
            session.commit()
    return {"ok": False, "ingested": None, "rejected": rejection.model_dump() if rejection else None}


@app.post("/api/invoices/{invoice_id}/corrections", response_model=InvoiceBase)
def apply_invoice_correction(
    invoice_id: UUID,
    payload: InvoiceCorrectionRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
):
    tenant_id = resolve_tenant_scope(header_tenant_id=x_tenant_id)
    invoice = require_invoice_for_tenant(session, invoice_id, tenant_id)
    if not invoice.raw_text:
        raise HTTPException(status_code=400, detail="Fatura não tem texto bruto guardado")

    extraction = build_extraction_from_text(
        text=invoice.raw_text,
        file_name=invoice.filename,
        correction_message=payload.message,
        previous_payload=invoice.ai_payload,
    )
    extraction = apply_tenant_defaults_to_extraction(extraction, invoice.tenant_id, session)
    extraction = apply_counterparty_nif_heuristics(extraction, invoice.tenant_id, session)
    extraction = apply_vendor_profile_enrichment(extraction, invoice.tenant_id, session)
    extraction["line_items"] = _ensure_line_items(extraction, invoice.filename)
    confidence_score, requires_review = score_extraction_confidence(extraction)
    extraction["confidence_score"] = confidence_score
    extraction["requires_review"] = requires_review
    apply_extraction_to_invoice(invoice, extraction, session)
    invoice.status = "requere revisao" if requires_review else "corrigido"
    upsert_vendor_profile(invoice, session)
    upsert_invoice_template(invoice, session)

    if settings.debug_learning:
        invoice.learning_debug = json.dumps(
            {
                **init_learning_debug(),
                "vendor_profile_applied": False,
                "invoice_template_applied": False,
            }
        )

    correction = InvoiceCorrection(
        invoice_id=invoice.id,
        message=payload.message.strip(),
        ai_payload=extraction.get("ai_payload"),
    )
    session.add(correction)
    session.commit()
    background_tasks.add_task(enqueue_invoice_embedding_job, invoice.id)
    session.refresh(invoice)
    return serialize_invoice(invoice)


@app.get("/api/invoices/{invoice_id}/corrections", response_model=InvoiceCorrectionListResponse)
def list_invoice_corrections(
    invoice_id: UUID,
    session: Session = Depends(get_session),
    x_tenant_id: str | None = Header(default=None, alias="X-Tenant-Id"),
):
    tenant_id = resolve_tenant_scope(header_tenant_id=x_tenant_id)
    invoice = require_invoice_for_tenant(session, invoice_id, tenant_id)
    corrections = (
        session.query(InvoiceCorrection)
        .filter(InvoiceCorrection.invoice_id == invoice_id)
        .order_by(InvoiceCorrection.created_at.desc())
        .all()
    )
    return {"items": corrections}
