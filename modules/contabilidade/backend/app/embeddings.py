from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels

from .config import get_settings
from .llm_client import create_embedding
from .models import Invoice

logger = logging.getLogger(__name__)
settings = get_settings()
COLLECTION_NAME = "invoice_embeddings"
VECTOR_SIZE = settings.embedding_vector_size


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
        if existing_size is None:
            return
        if existing_size == VECTOR_SIZE:
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
    except Exception as exc:
        if isinstance(exc, RuntimeError):
            raise
        client.recreate_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=qmodels.VectorParams(size=VECTOR_SIZE, distance=qmodels.Distance.COSINE),
        )


def _embed_text(value: str) -> list[float]:
    response = create_embedding(model=settings.embedding_model, input_value=value)
    vector = response.data[0].embedding
    vector_size = len(vector)
    if vector_size != VECTOR_SIZE:
        raise RuntimeError(
            f"Embedding model {settings.embedding_model} returned {vector_size} dims, expected {VECTOR_SIZE}. "
            "OpenAI fallback is intentionally disabled for embeddings unless dimensions match."
        )
    return vector


def upsert_invoice_embedding(invoice: Invoice) -> None:
    if not settings.openai_api_key:
        return

    try:
        _ensure_collection()
        text = _build_embedding_text(invoice)
        embedding = _embed_text(text)
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
    if not settings.openai_api_key:
        return []
    question = question.strip()
    if not question:
        return []
    _ensure_collection()
    embedding = _embed_text(question)
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
