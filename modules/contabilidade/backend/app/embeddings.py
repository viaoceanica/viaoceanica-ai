from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Any
from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels

from .ai_client import embeddings_create as ai_embeddings_create
from .config import get_settings
from .models import Invoice

logger = logging.getLogger(__name__)
settings = get_settings()
COLLECTION_NAME = "invoice_embeddings"
VECTOR_SIZE = settings.embedding_vector_size
DEFAULT_AI_USER_ID = os.getenv("DEFAULT_USER_ID", "1")


def _build_embedding_text(invoice: Invoice) -> str:
    header = (
        f"tenant {invoice.tenant_id} invoice {invoice.invoice_number or invoice.id} "
        f"vendor {invoice.vendor or ''} nif {invoice.supplier_nif or ''} "
        f"customer {invoice.customer_name or ''}"
    )
    totals = f"total {invoice.total or 0} tax {invoice.tax or 0} subtotal {invoice.subtotal or 0} currency {invoice.currency or 'EUR'}"
    lines: list[str] = []
    for item in invoice.line_items or []:
        lines.append(
            f"line {item.code or ''} {item.description or ''} quantity {item.quantity or 0} unit {item.unit_price or 0} "
            f"subtotal {item.line_subtotal or item.line_total or 0} tax {item.line_tax_amount or 0} total {item.line_total or 0}"
        )
    return " | ".join([header, totals, *lines])


@lru_cache
def _get_qdrant_client() -> QdrantClient:
    return QdrantClient(url=settings.qdrant_url)


def _vector_size_from_collection(collection: Any) -> int | None:
    vectors = getattr(getattr(getattr(collection, "config", None), "params", None), "vectors", None)
    if isinstance(vectors, qmodels.VectorParams):
        return int(vectors.size)
    if isinstance(vectors, dict):
        first = next(iter(vectors.values()), None)
        if first and getattr(first, "size", None) is not None:
            return int(first.size)
    return None


def _ensure_collection() -> None:
    client = _get_qdrant_client()
    try:
        collection = client.get_collection(COLLECTION_NAME)
        existing_size = _vector_size_from_collection(collection)
        if existing_size is None or existing_size == VECTOR_SIZE:
            return
        count_result = client.count(collection_name=COLLECTION_NAME)
        count = int(getattr(count_result, "count", 0) or 0)
        if count == 0:
            logger.warning(
                "Recreating empty Qdrant collection %s because vector size %s != %s",
                COLLECTION_NAME,
                existing_size,
                VECTOR_SIZE,
            )
            client.recreate_collection(
                collection_name=COLLECTION_NAME,
                vectors_config=qmodels.VectorParams(size=VECTOR_SIZE, distance=qmodels.Distance.COSINE),
            )
            return
        raise RuntimeError(
            f"Qdrant collection {COLLECTION_NAME} uses vector size {existing_size}, expected {VECTOR_SIZE}. "
            "Refuse to mix embeddings with different dimensions."
        )
    except Exception:
        client.recreate_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=qmodels.VectorParams(size=VECTOR_SIZE, distance=qmodels.Distance.COSINE),
        )


def _embedding_context_headers(tenant_id: str, request_id: str) -> dict[str, str]:
    return {
        "X-Viao-User-Id": DEFAULT_AI_USER_ID,
        "X-Viao-Tenant-Id": str(tenant_id),
        "X-Viao-Module-Key": "contabilidade",
        "X-Viao-Request-Id": request_id,
    }


def upsert_invoice_embedding(invoice: Invoice) -> None:
    try:
        _ensure_collection()
        text = _build_embedding_text(invoice)
        embedding = ai_embeddings_create(
            input_text=text,
            model=settings.embedding_model,
            context_headers=_embedding_context_headers(invoice.tenant_id, f"embedding-upsert-{invoice.id}"),
        )
        payload = {
            "invoice_id": str(invoice.id),
            "tenant_id": invoice.tenant_id,
            "vendor": invoice.vendor,
            "invoice_number": invoice.invoice_number,
            "total": float(invoice.total or 0),
            "currency": invoice.currency or "EUR",
            "created_at": invoice.created_at.isoformat(),
        }
        _get_qdrant_client().upsert(
            collection_name=COLLECTION_NAME,
            points=[
                qmodels.PointStruct(
                    id=str(invoice.id),
                    vector=embedding,
                    payload=payload,
                )
            ],
        )
    except Exception as exc:
        logger.warning("Falha ao gravar embedding da fatura %s: %s", invoice.id, exc)


def search_invoice_embeddings(question: str, tenant_id: str, top_k: int = 5):
    question = question.strip()
    if not question:
        return []
    _ensure_collection()
    embedding = ai_embeddings_create(
        input_text=question,
        model=settings.embedding_model,
        context_headers=_embedding_context_headers(tenant_id, "embedding-search"),
    )
    client = _get_qdrant_client()
    try:
        response = client.query_points(
            collection_name=COLLECTION_NAME,
            query=embedding,
            limit=top_k,
            query_filter=qmodels.Filter(
                must=[
                    qmodels.FieldCondition(
                        key="tenant_id", match=qmodels.MatchValue(value=tenant_id)
                    )
                ]
            ),
        )
        return response.points
    except Exception as exc:
        logger.warning("Falha na pesquisa de embeddings: %s", exc)
        return []
