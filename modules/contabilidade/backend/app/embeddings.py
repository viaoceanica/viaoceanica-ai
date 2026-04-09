from __future__ import annotations

import logging
from functools import lru_cache
from openai import OpenAI
from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels

from .config import get_settings
from .models import Invoice

logger = logging.getLogger(__name__)
settings = get_settings()
COLLECTION_NAME = "invoice_embeddings"
VECTOR_SIZE = 1536  # text-embedding-3-small


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


@lru_cache
def _get_openai_client() -> OpenAI:
    if not settings.openai_api_key:
        raise RuntimeError("OPENAI_API_KEY não configurada para embeddings")
    return OpenAI(api_key=settings.openai_api_key)


def _ensure_collection() -> None:
    client = _get_qdrant_client()
    try:
        client.get_collection(COLLECTION_NAME)
    except Exception:
        client.recreate_collection(
            collection_name=COLLECTION_NAME,
            vectors_config=qmodels.VectorParams(size=VECTOR_SIZE, distance=qmodels.Distance.COSINE),
        )


def upsert_invoice_embedding(invoice: Invoice) -> None:
    if not settings.openai_api_key:
        return

    try:
        _ensure_collection()
        text = _build_embedding_text(invoice)
        embedding = (
            _get_openai_client()
            .embeddings.create(model=settings.embedding_model, input=text)
            .data[0]
            .embedding
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
    if not settings.openai_api_key:
        return []
    question = question.strip()
    if not question:
        return []
    _ensure_collection()
    embedding = (
        _get_openai_client().embeddings.create(
            model=settings.embedding_model, input=question
        ).data[0].embedding
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
