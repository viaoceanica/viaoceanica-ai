"""
Via Oceânica AI — Módulo Helpdesk (Module Contract v1)

Client/company support ticket system, tenant-scoped.
"""
from __future__ import annotations

import contextvars
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Optional
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, ForeignKey, JSON, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

from ai_client import ask_assistant

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("helpdesk")

PORT = int(os.getenv("MOD_HELPDESK_PORT", "4001"))
DATABASE_URL = os.getenv("DATABASE_URL", "")
AI_AGENT_ID = os.getenv("AI_AGENT_ID", "helpdesk")
DEFAULT_TENANT = os.getenv("DEFAULT_TENANT_ID", "demo")
_start_time = time.time()


class Base(DeclarativeBase):
    pass


class Ticket(Base):
    __tablename__ = "helpdesk_tickets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    requester_name: Mapped[str] = mapped_column(String(255))
    requester_email: Mapped[str] = mapped_column(String(255), index=True)
    subject: Mapped[str] = mapped_column(String(255), index=True)
    description: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), index=True, default="open")
    priority: Mapped[str] = mapped_column(String(32), index=True, default="medium")
    category: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    assignee_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    source: Mapped[str] = mapped_column(String(32), default="portal")
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True)
    conversations: Mapped[list["TicketConversation"]] = relationship(back_populates="ticket", cascade="all, delete-orphan")




class AdminCatalogEntry(Base):
    __tablename__ = "helpdesk_admin_catalog"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    resource_type: Mapped[str] = mapped_column(String(32), index=True)
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, index=True)

class TicketConversation(Base):
    __tablename__ = "helpdesk_ticket_conversations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    ticket_id: Mapped[str] = mapped_column(String(36), ForeignKey("helpdesk_tickets.id"), index=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    kind: Mapped[str] = mapped_column(String(32), default="reply")  # reply | note | event
    author_name: Mapped[str] = mapped_column(String(255))
    author_email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    body: Mapped[str] = mapped_column(Text)
    visibility: Mapped[str] = mapped_column(String(32), default="public")  # public | internal
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    ticket: Mapped[Ticket] = relationship(back_populates="conversations")


_engine = None
_SessionLocal = None

if DATABASE_URL:
    _engine = create_engine(DATABASE_URL, future=True, pool_pre_ping=True)
    _SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False, future=True)


@dataclass
class ModuleContext:
    user_id: str
    tenant_id: str
    session_id: str
    platform_roles: str
    company_role: str
    module_entitlements: str
    request_id: str


_current_context: contextvars.ContextVar[Optional[ModuleContext]] = contextvars.ContextVar(
    "helpdesk_module_context", default=None
)

PUBLIC_PATHS = frozenset([
    "/health",
    "/ready",
    "/api/health",
    "/api/ready",
])

TicketStatus = Literal["open", "in_progress", "waiting_customer", "resolved", "closed"]
TicketPriority = Literal["low", "medium", "high", "urgent"]
ConversationKind = Literal["reply", "note", "event"]
ConversationVisibility = Literal["public", "internal"]

ADMIN_RESOURCES = {
    "clients": {
        "label": "Clientes",
        "fields": [
            {"key": "name", "label": "Nome do cliente", "required": True},
            {"key": "company_name", "label": "Nome da empresa", "required": False},
            {"key": "code", "label": "Código", "required": True},
            {"key": "email", "label": "Email", "required": False},
            {"key": "phone", "label": "Telefone", "required": False},
            {"key": "address", "label": "Morada", "required": False},
        ],
    },
    "slas": {
        "label": "SLAs",
        "fields": [
            {"key": "name", "label": "Nome", "required": True},
            {"key": "responseTime", "label": "Tempo de resposta", "required": True},
            {"key": "resolutionTime", "label": "Tempo de resolução", "required": True},
        ],
    },
    "technicians": {
        "label": "Técnicos",
        "fields": [
            {"key": "name", "label": "Nome", "required": True},
            {"key": "email", "label": "Email", "required": True},
            {"key": "specialty", "label": "Especialidade", "required": False},
        ],
    },
    "urgency": {
        "label": "Urgência",
        "fields": [
            {"key": "name", "label": "Nome", "required": True},
            {"key": "priority", "label": "Prioridade", "required": True},
            {"key": "color", "label": "Cor", "required": False},
        ],
    },
    "states": {
        "label": "Estados",
        "fields": [
            {"key": "name", "label": "Nome", "required": True},
            {"key": "category", "label": "Categoria", "required": True},
            {"key": "isFinal", "label": "Estado final", "required": False},
        ],
    },
}


class TicketCreate(BaseModel):
    requester_name: str = Field(min_length=1, max_length=255)
    requester_email: str = Field(min_length=3, max_length=255)
    subject: str = Field(min_length=3, max_length=255)
    description: str = Field(min_length=3)
    priority: TicketPriority = "medium"
    category: Optional[str] = Field(default=None, max_length=64)
    tags: list[str] = Field(default_factory=list)


class TicketUpdate(BaseModel):
    status: Optional[TicketStatus] = None
    priority: Optional[TicketPriority] = None
    category: Optional[str] = Field(default=None, max_length=64)
    assignee_name: Optional[str] = Field(default=None, max_length=255)
    tags: Optional[list[str]] = None


class ConversationCreate(BaseModel):
    kind: ConversationKind = "reply"
    author_name: str = Field(min_length=1, max_length=255)
    author_email: Optional[str] = Field(default=None, max_length=255)
    body: str = Field(min_length=1)
    visibility: ConversationVisibility = "public"




class AdminCatalogPayload(BaseModel):
    values: dict[str, str]


def serialize_admin_entry(item: AdminCatalogEntry) -> dict:
    return {
        "id": item.id,
        "tenant_id": item.tenant_id,
        "resource_type": item.resource_type,
        **(item.payload or {}),
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


def get_admin_resource(resource_type: str) -> dict:
    resource = ADMIN_RESOURCES.get(resource_type)
    if resource is None:
        raise HTTPException(status_code=404, detail="Recurso administrativo não encontrado")
    return resource


def validate_admin_payload(resource_type: str, values: dict) -> dict:
    resource = get_admin_resource(resource_type)
    normalized = {}
    for field in resource["fields"]:
        value = values.get(field["key"], "") if values else ""
        value = "" if value is None else str(value).strip()
        if field.get("required") and not value:
            raise HTTPException(status_code=400, detail=f"Campo obrigatório: {field['label']}")
        normalized[field["key"]] = value
    return normalized

def serialize_conversation(item: TicketConversation) -> dict:
    return {
        "id": item.id,
        "ticket_id": item.ticket_id,
        "tenant_id": item.tenant_id,
        "kind": item.kind,
        "author_name": item.author_name,
        "author_email": item.author_email,
        "body": item.body,
        "visibility": item.visibility,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


def serialize_ticket(ticket: Ticket, include_conversations: bool = False) -> dict:
    payload = {
        "id": ticket.id,
        "tenant_id": ticket.tenant_id,
        "requester_name": ticket.requester_name,
        "requester_email": ticket.requester_email,
        "subject": ticket.subject,
        "description": ticket.description,
        "status": ticket.status,
        "priority": ticket.priority,
        "category": ticket.category,
        "assignee_name": ticket.assignee_name,
        "source": ticket.source,
        "tags": ticket.tags or [],
        "created_at": ticket.created_at.isoformat() if ticket.created_at else None,
        "updated_at": ticket.updated_at.isoformat() if ticket.updated_at else None,
    }
    if include_conversations:
        payload["conversations"] = [serialize_conversation(item) for item in sorted(ticket.conversations, key=lambda x: x.created_at)]
    return payload


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("[helpdesk] Starting on port %s", PORT)
    if _engine is not None:
        Base.metadata.create_all(bind=_engine)
    yield
    logger.info("[helpdesk] Shutting down")


app = FastAPI(
    title="Via Oceânica — Módulo Helpdesk",
    description="Helpdesk module contract wrapper",
    version="1.2.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def get_db_session() -> Session:
    if _SessionLocal is None:
        raise HTTPException(status_code=503, detail="Helpdesk database is not configured")
    return _SessionLocal()


def get_module_context() -> ModuleContext:
    ctx = _current_context.get()
    if ctx is None:
        raise HTTPException(status_code=401, detail="Missing module context (x-viao-* headers)")
    return ctx


def require_tenant_admin(tenant_id: str) -> ModuleContext:
    ctx = get_module_context()
    if str(ctx.tenant_id) != str(tenant_id):
        raise HTTPException(status_code=403, detail="tenant_id em conflito com o contexto autenticado")

    platform_roles = {role.strip() for role in (ctx.platform_roles or "").split(",") if role.strip()}
    if "admin" in platform_roles:
        return ctx

    company_roles = {role.strip() for role in (ctx.company_role or "").split(",") if role.strip()}
    if company_roles.intersection({"owner", "admin"}):
        return ctx

    raise HTTPException(status_code=403, detail="Acesso reservado a administradores da empresa")


@app.middleware("http")
async def extract_platform_headers(request: Request, call_next):
    path = request.url.path
    if path in PUBLIC_PATHS:
        return await call_next(request)

    user_id = request.headers.get("x-viao-user-id", "")
    tenant_id = request.headers.get("x-viao-tenant-id", "") or request.headers.get("x-tenant-id", "") or DEFAULT_TENANT
    session_id = request.headers.get("x-viao-session-id", "")
    platform_roles = request.headers.get("x-viao-platform-roles", "")
    company_role = request.headers.get("x-viao-company-role", "")
    module_entitlements = request.headers.get("x-viao-module-entitlements", "")
    request_id = request.headers.get("x-viao-request-id", "")

    if not user_id:
        user_id = "0"

    ctx = ModuleContext(
        user_id=user_id,
        tenant_id=tenant_id,
        session_id=session_id or request_id or f"{tenant_id}-{user_id}",
        platform_roles=platform_roles,
        company_role=company_role,
        module_entitlements=module_entitlements,
        request_id=request_id or "unknown",
    )
    request.state.tenant_id = ctx.tenant_id
    request.state.user_id = ctx.user_id
    request.state.session_id = ctx.session_id
    request.state.platform_roles = ctx.platform_roles
    request.state.company_role = ctx.company_role
    request.state.module_entitlements = ctx.module_entitlements

    token = _current_context.set(ctx)
    try:
        response = await call_next(request)
        return response
    finally:
        _current_context.reset(token)


@app.get("/health", tags=["module-contract"])
async def health():
    return {
        "status": "ok",
        "service": "mod-helpdesk",
        "version": "1.2.0",
        "uptime_seconds": int(time.time() - _start_time),
    }


@app.get("/ready", tags=["module-contract"])
async def ready():
    dependencies = {"database": "configured" if DATABASE_URL else "not-configured"}
    if _engine is not None:
        try:
            with _engine.connect() as conn:
                conn.exec_driver_sql("SELECT 1")
            dependencies["database"] = "ok"
        except Exception:
            dependencies["database"] = "error"
    return {"status": "ready", "dependencies": dependencies}


@app.get("/api/health")
async def api_health_alias():
    return await health()


@app.get("/api/ready")
async def api_ready_alias():
    return await ready()


@app.post("/api/v1/ai/chat")
async def ai_chat(request: Request):
    body = await request.json()
    message = body.get("message", "")
    session_id = body.get("session_id", request.state.session_id)

    response = await ask_assistant(
        message=message,
        session_id=session_id,
        agent_id=AI_AGENT_ID,
        context={
            "tenant_id": request.state.tenant_id,
            "user_id": request.state.user_id,
            "module": "helpdesk",
            "company_role": request.state.company_role,
        },
    )
    return {"success": True, "data": response}


@app.get("/api/v1/status")
async def status(request: Request):
    return {
        "success": True,
        "data": {
            "module": "helpdesk",
            "tenant_id": request.state.tenant_id,
            "user_id": request.state.user_id,
            "company_role": request.state.company_role,
            "message": "Helpdesk está operacional",
        },
    }


@app.get("/api/v1/context")
async def context_status():
    ctx = get_module_context()
    return {
        "success": True,
        "data": {
            "tenant_id": ctx.tenant_id,
            "user_id": ctx.user_id,
            "session_id": ctx.session_id,
            "platform_roles": ctx.platform_roles,
            "company_role": ctx.company_role,
            "module_entitlements": ctx.module_entitlements,
        },
    }


@app.get("/api/v1/tickets")
async def list_tickets(request: Request, status: Optional[str] = None, priority: Optional[str] = None, search: Optional[str] = None):
    with get_db_session() as session:
        stmt = select(Ticket).where(Ticket.tenant_id == request.state.tenant_id)
        if status:
            stmt = stmt.where(Ticket.status == status)
        if priority:
            stmt = stmt.where(Ticket.priority == priority)
        tickets = session.scalars(stmt.order_by(Ticket.updated_at.desc())).all()
        items = [serialize_ticket(ticket) for ticket in tickets]
        if search:
            q = search.strip().lower()
            items = [
                item
                for item in items
                if q in item["subject"].lower()
                or q in item["description"].lower()
                or q in item["requester_name"].lower()
                or q in item["requester_email"].lower()
            ]
        return {"success": True, "data": items}


@app.post("/api/v1/tickets")
async def create_ticket(request: Request, payload: TicketCreate):
    with get_db_session() as session:
        ticket = Ticket(
            id=str(uuid4()),
            tenant_id=request.state.tenant_id,
            requester_name=payload.requester_name.strip(),
            requester_email=payload.requester_email.strip().lower(),
            subject=payload.subject.strip(),
            description=payload.description.strip(),
            priority=payload.priority,
            category=payload.category.strip() if payload.category else None,
            tags=payload.tags,
            status="open",
            source="portal",
        )
        session.add(ticket)
        session.flush()
        session.add(
            TicketConversation(
                id=str(uuid4()),
                ticket_id=ticket.id,
                tenant_id=ticket.tenant_id,
                kind="event",
                author_name="Sistema",
                author_email=None,
                body="Ticket criado",
                visibility="internal",
            )
        )
        session.commit()
        session.refresh(ticket)
        return {"success": True, "data": serialize_ticket(ticket)}


@app.get("/api/v1/tickets/{ticket_id}")
async def get_ticket(request: Request, ticket_id: str):
    with get_db_session() as session:
        ticket = session.get(Ticket, ticket_id)
        if ticket is None or ticket.tenant_id != request.state.tenant_id:
            raise HTTPException(status_code=404, detail="Ticket não encontrado")
        ticket.conversations
        return {"success": True, "data": serialize_ticket(ticket, include_conversations=True)}


@app.patch("/api/v1/tickets/{ticket_id}")
async def update_ticket(request: Request, ticket_id: str, payload: TicketUpdate):
    require_tenant_admin(request.state.tenant_id)
    with get_db_session() as session:
        ticket = session.get(Ticket, ticket_id)
        if ticket is None or ticket.tenant_id != request.state.tenant_id:
            raise HTTPException(status_code=404, detail="Ticket não encontrado")
        data = payload.model_dump(exclude_unset=True)
        changed_fields = []
        for key, value in data.items():
            setattr(ticket, key, value)
            changed_fields.append(f"{key}={value}")
        ticket.updated_at = datetime.utcnow()
        session.add(ticket)
        if changed_fields:
            session.add(
                TicketConversation(
                    id=str(uuid4()),
                    ticket_id=ticket.id,
                    tenant_id=ticket.tenant_id,
                    kind="event",
                    author_name="Sistema",
                    author_email=None,
                    body="Atualização do ticket: " + ", ".join(changed_fields),
                    visibility="internal",
                )
            )
        session.commit()
        session.refresh(ticket)
        return {"success": True, "data": serialize_ticket(ticket)}


@app.get("/api/v1/tickets/{ticket_id}/conversations")
async def list_conversations(request: Request, ticket_id: str):
    with get_db_session() as session:
        ticket = session.get(Ticket, ticket_id)
        if ticket is None or ticket.tenant_id != request.state.tenant_id:
            raise HTTPException(status_code=404, detail="Ticket não encontrado")
        items = session.scalars(
            select(TicketConversation)
            .where(TicketConversation.ticket_id == ticket_id, TicketConversation.tenant_id == request.state.tenant_id)
            .order_by(TicketConversation.created_at.asc())
        ).all()
        return {"success": True, "data": [serialize_conversation(item) for item in items]}


@app.post("/api/v1/tickets/{ticket_id}/conversations")
async def create_conversation(request: Request, ticket_id: str, payload: ConversationCreate):
    with get_db_session() as session:
        ticket = session.get(Ticket, ticket_id)
        if ticket is None or ticket.tenant_id != request.state.tenant_id:
            raise HTTPException(status_code=404, detail="Ticket não encontrado")
        if payload.visibility == "internal":
            require_tenant_admin(request.state.tenant_id)
        item = TicketConversation(
            id=str(uuid4()),
            ticket_id=ticket.id,
            tenant_id=ticket.tenant_id,
            kind=payload.kind,
            author_name=payload.author_name.strip(),
            author_email=payload.author_email.strip().lower() if payload.author_email else None,
            body=payload.body.strip(),
            visibility=payload.visibility,
        )
        ticket.updated_at = datetime.utcnow()
        session.add(item)
        session.add(ticket)
        session.commit()
        session.refresh(item)
        return {"success": True, "data": serialize_conversation(item)}


@app.get("/api/v1/tenants/{tenant_id}/admin/summary")
async def admin_summary(tenant_id: str):
    ctx = require_tenant_admin(tenant_id)
    with get_db_session() as session:
        tickets = session.scalars(select(Ticket).where(Ticket.tenant_id == tenant_id)).all()
        summary = {
            "total": len(tickets),
            "open": sum(1 for ticket in tickets if ticket.status == "open"),
            "in_progress": sum(1 for ticket in tickets if ticket.status == "in_progress"),
            "waiting_customer": sum(1 for ticket in tickets if ticket.status == "waiting_customer"),
            "resolved": sum(1 for ticket in tickets if ticket.status == "resolved"),
            "closed": sum(1 for ticket in tickets if ticket.status == "closed"),
            "urgent": sum(1 for ticket in tickets if ticket.priority == "urgent"),
        }
    return {
        "success": True,
        "data": {
            "module": "helpdesk",
            "tenant_id": tenant_id,
            "admin_access": True,
            "company_role": ctx.company_role,
            "platform_roles": ctx.platform_roles,
            "summary": summary,
            "message": "Resumo operacional do Helpdesk",
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)


@app.get("/api/v1/admin/catalog")
async def list_admin_resources(request: Request):
    require_tenant_admin(request.state.tenant_id)
    return {
        "success": True,
        "data": {
            key: {
                "label": value["label"],
                "fields": value["fields"],
            }
            for key, value in ADMIN_RESOURCES.items()
        },
    }


@app.get("/api/v1/admin/catalog/{resource_type}")
async def list_admin_catalog_entries(request: Request, resource_type: str):
    require_tenant_admin(request.state.tenant_id)
    resource = get_admin_resource(resource_type)
    with get_db_session() as session:
        items = session.scalars(
            select(AdminCatalogEntry)
            .where(
                AdminCatalogEntry.tenant_id == request.state.tenant_id,
                AdminCatalogEntry.resource_type == resource_type,
            )
            .order_by(AdminCatalogEntry.updated_at.desc())
        ).all()
        return {
            "success": True,
            "data": {
                "resource": resource_type,
                "label": resource["label"],
                "fields": resource["fields"],
                "items": [serialize_admin_entry(item) for item in items],
            },
        }


@app.post("/api/v1/admin/catalog/{resource_type}")
async def create_admin_catalog_entry(request: Request, resource_type: str, payload: AdminCatalogPayload):
    require_tenant_admin(request.state.tenant_id)
    validate_admin_payload(resource_type, payload.values)
    with get_db_session() as session:
        item = AdminCatalogEntry(
            id=str(uuid4()),
            tenant_id=request.state.tenant_id,
            resource_type=resource_type,
            payload=validate_admin_payload(resource_type, payload.values),
        )
        session.add(item)
        session.commit()
        session.refresh(item)
        return {"success": True, "data": serialize_admin_entry(item)}


@app.put("/api/v1/admin/catalog/{resource_type}/{entry_id}")
async def update_admin_catalog_entry(request: Request, resource_type: str, entry_id: str, payload: AdminCatalogPayload):
    require_tenant_admin(request.state.tenant_id)
    with get_db_session() as session:
        item = session.get(AdminCatalogEntry, entry_id)
        if item is None or item.tenant_id != request.state.tenant_id or item.resource_type != resource_type:
            raise HTTPException(status_code=404, detail="Registo não encontrado")
        item.payload = validate_admin_payload(resource_type, payload.values)
        item.updated_at = datetime.utcnow()
        session.add(item)
        session.commit()
        session.refresh(item)
        return {"success": True, "data": serialize_admin_entry(item)}


@app.delete("/api/v1/admin/catalog/{resource_type}/{entry_id}")
async def delete_admin_catalog_entry(request: Request, resource_type: str, entry_id: str):
    require_tenant_admin(request.state.tenant_id)
    with get_db_session() as session:
        item = session.get(AdminCatalogEntry, entry_id)
        if item is None or item.tenant_id != request.state.tenant_id or item.resource_type != resource_type:
            raise HTTPException(status_code=404, detail="Registo não encontrado")
        session.delete(item)
        session.commit()
        return {"success": True, "data": {"id": entry_id}}
