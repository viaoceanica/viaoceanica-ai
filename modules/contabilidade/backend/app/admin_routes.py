from __future__ import annotations

from datetime import datetime, timedelta
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func

from .database import get_session
from .middleware import get_module_context
from .models import InvoiceImportEvent, StorageUploadQueue, InvoiceLineItem, Invoice
from .schemas import TenantProfileResponse
from .main import (
    get_or_create_tenant_profile,
    list_automation_blockers,
    list_line_items_for_review,
    line_items_quality_summary,
)

router = APIRouter(tags=["admin"])


def require_tenant_admin(tenant_id: str) -> None:
    ctx = get_module_context()
    if str(ctx.tenant_id) != str(tenant_id):
        raise HTTPException(status_code=403, detail="tenant_id em conflito com o contexto autenticado")

    platform_roles = {role.strip() for role in (ctx.platform_roles or "").split(",") if role.strip()}
    if "admin" in platform_roles:
        return

    if ctx.company_role not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="Acesso reservado a administradores da empresa")


@router.get("/api/tenants/{tenant_id}/admin/summary")
def admin_summary(tenant_id: str, session: Session = Depends(get_session)):
    require_tenant_admin(tenant_id)

    since = datetime.utcnow() - timedelta(hours=24)
    recent_events = (
        session.query(InvoiceImportEvent)
        .filter(InvoiceImportEvent.tenant_id == tenant_id, InvoiceImportEvent.created_at >= since)
        .all()
    )

    latest_success = (
        session.query(InvoiceImportEvent)
        .filter(InvoiceImportEvent.tenant_id == tenant_id, InvoiceImportEvent.status == "ingested")
        .order_by(InvoiceImportEvent.created_at.desc())
        .first()
    )

    queue_rows = session.query(StorageUploadQueue).filter(StorageUploadQueue.tenant_id == tenant_id).all()

    quality = line_items_quality_summary(tenant_id=tenant_id, session=session)
    blockers = list_automation_blockers(tenant_id=tenant_id, session=session)

    return {
        "importsLast24h": len(recent_events),
        "failedImportsLast24h": sum(1 for event in recent_events if event.status in {"failed", "rejected"}),
        "duplicateCandidatesLast24h": sum(1 for event in recent_events if event.duplicate_candidate_invoice_id is not None),
        "automationBlockers": len(blockers.get("items", [])),
        "storageQueue": {
            "pending": sum(1 for row in queue_rows if row.status == "pending"),
            "uploaded": sum(1 for row in queue_rows if row.status == "uploaded"),
            "failed": sum(1 for row in queue_rows if row.status == "failed"),
            "total": len(queue_rows),
        },
        "lineItemsQuality": quality,
        "lastSuccessfulImportAt": latest_success.created_at.isoformat() if latest_success else None,
    }


@router.get("/api/tenants/{tenant_id}/admin/import-events")
def admin_import_events(tenant_id: str, limit: int = 100, session: Session = Depends(get_session)):
    require_tenant_admin(tenant_id)
    rows = (
        session.query(InvoiceImportEvent)
        .filter(InvoiceImportEvent.tenant_id == tenant_id)
        .order_by(InvoiceImportEvent.created_at.desc())
        .limit(max(1, min(limit, 500)))
        .all()
    )
    return {
        "items": [
            {
                "id": str(row.id),
                "invoice_id": str(row.invoice_id) if row.invoice_id else None,
                "filename": row.filename,
                "status": row.status,
                "source": row.source,
                "reason": row.reason,
                "supplier_nif": row.supplier_nif,
                "invoice_number": row.invoice_number,
                "total": float(row.total) if isinstance(row.total, Decimal) else row.total,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ]
    }


@router.get("/api/tenants/{tenant_id}/admin/blockers")
def admin_blockers(tenant_id: str, limit: int = 200, session: Session = Depends(get_session)):
    require_tenant_admin(tenant_id)
    return list_automation_blockers(tenant_id=tenant_id, limit=limit, session=session)


@router.get("/api/tenants/{tenant_id}/admin/line-items/review")
def admin_line_items_review(tenant_id: str, limit: int = 200, session: Session = Depends(get_session)):
    require_tenant_admin(tenant_id)
    return list_line_items_for_review(tenant_id=tenant_id, limit=limit, session=session)


@router.get("/api/tenants/{tenant_id}/admin/line-items/quality")
def admin_line_items_quality(tenant_id: str, session: Session = Depends(get_session)):
    require_tenant_admin(tenant_id)
    return line_items_quality_summary(tenant_id=tenant_id, session=session)


@router.get("/api/tenants/{tenant_id}/admin/settings")
def admin_settings(tenant_id: str, session: Session = Depends(get_session)):
    require_tenant_admin(tenant_id)
    profile = get_or_create_tenant_profile(tenant_id, session)
    payload = TenantProfileResponse(company_name=profile.company_name, company_nif=profile.company_nif)
    return {
        "profile": payload.model_dump(mode="json"),
    }


@router.get("/api/tenants/{tenant_id}/admin/audit")
def admin_audit(tenant_id: str, limit: int = 100, session: Session = Depends(get_session)):
    require_tenant_admin(tenant_id)
    rows = (
        session.query(InvoiceImportEvent)
        .filter(InvoiceImportEvent.tenant_id == tenant_id)
        .order_by(InvoiceImportEvent.created_at.desc())
        .limit(max(1, min(limit, 500)))
        .all()
    )
    return {
        "items": [
            {
                "id": str(row.id),
                "filename": row.filename,
                "status": row.status,
                "reason": row.reason,
                "created_at": row.created_at.isoformat() if row.created_at else None,
            }
            for row in rows
        ]
    }
