"""
Via Oceânica AI — Módulo Helpdesk (Module Contract v1)

Client/company support ticket system, tenant-scoped.
"""
from __future__ import annotations

import base64
import contextvars
import logging
import os
import re
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal, Optional
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from sqlalchemy import DateTime, ForeignKey, JSON, Integer, String, Text, create_engine, inspect, select, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

from ai_client import ask_assistant

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("helpdesk")

PORT = int(os.getenv("MOD_HELPDESK_PORT", "4001"))
DATABASE_URL = os.getenv("DATABASE_URL", "")
AI_AGENT_ID = os.getenv("AI_AGENT_ID", "helpdesk")
DEFAULT_TENANT = os.getenv("DEFAULT_TENANT_ID", "demo")
ALLOW_DEMO_TENANT = os.getenv("ALLOW_DEMO_TENANT", "false").lower() in {"1", "true", "yes", "on"}
_start_time = time.time()


def derive_platform_database_url(database_url: str) -> str:
    if not database_url:
        return ""
    return re.sub(r"/[^/?]+(?=\?|$)", "/viaoceanica_platform", database_url, count=1)


PLATFORM_DATABASE_URL = os.getenv("PLATFORM_DATABASE_URL", "").strip() or derive_platform_database_url(DATABASE_URL)


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
    due_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    sla_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    routing_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
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
    attachments: Mapped[list["TicketAttachment"]] = relationship(back_populates="conversation", cascade="all, delete-orphan")


class TicketAttachment(Base):
    __tablename__ = "helpdesk_ticket_attachments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    ticket_id: Mapped[str] = mapped_column(String(36), ForeignKey("helpdesk_tickets.id"), index=True)
    conversation_id: Mapped[str] = mapped_column(String(36), ForeignKey("helpdesk_ticket_conversations.id"), index=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(128), default="application/octet-stream")
    content_b64: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, index=True)
    conversation: Mapped[TicketConversation] = relationship(back_populates="attachments")


_engine = None
_SessionLocal = None
_platform_engine = None
_PlatformSessionLocal = None

if DATABASE_URL:
    _engine = create_engine(DATABASE_URL, future=True, pool_pre_ping=True)
    _SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False, future=True)

if PLATFORM_DATABASE_URL:
    _platform_engine = create_engine(PLATFORM_DATABASE_URL, future=True, pool_pre_ping=True)
    _PlatformSessionLocal = sessionmaker(bind=_platform_engine, autoflush=False, autocommit=False, future=True)


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
            {"key": "code", "label": "Código", "required": False},
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
    "sla_policies": {
        "label": "Políticas de SLA",
        "fields": [
            {"key": "name", "label": "Nome", "required": True},
            {"key": "priority", "label": "Prioridade", "required": True},
            {"key": "responseTime", "label": "Tempo de resposta", "required": True},
            {"key": "resolutionTime", "label": "Tempo de resolução", "required": True},
            {"key": "active", "label": "Ativa", "required": False},
        ],
    },
    "priorities": {
        "label": "Prioridades",
        "fields": [
            {"key": "name", "label": "Nome", "required": True},
            {"key": "level", "label": "Nível", "required": True},
            {"key": "color", "label": "Cor", "required": False},
            {"key": "active", "label": "Ativa", "required": False},
        ],
    },
    "categories": {
        "label": "Categorias",
        "fields": [
            {"key": "name", "label": "Nome", "required": True},
            {"key": "code", "label": "Código", "required": True},
            {"key": "description", "label": "Descrição", "required": False},
            {"key": "team", "label": "Equipa responsável", "required": False},
            {"key": "active", "label": "Ativa", "required": False},
        ],
    },
    "technicians": {
        "label": "Técnicos",
        "read_only": True,
        "fields": [
            {"key": "name", "label": "Nome", "required": True},
            {"key": "email", "label": "Email", "required": True},
            {"key": "team", "label": "Equipa", "required": False},
            {"key": "company_role", "label": "Papel", "required": False},
        ],
    },
    "support_agents": {
        "label": "Agentes de suporte",
        "fields": [
            {"key": "name", "label": "Nome", "required": True},
            {"key": "email", "label": "Email", "required": True},
            {"key": "team", "label": "Equipa", "required": False},
            {"key": "role", "label": "Função", "required": False},
            {"key": "active", "label": "Ativo", "required": False},
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
    "auto_responses": {
        "label": "Respostas automáticas",
        "fields": [
            {"key": "name", "label": "Nome", "required": True},
            {"key": "trigger", "label": "Gatilho", "required": True},
            {"key": "body_pt_pt", "label": "Mensagem pt-PT", "required": True},
            {"key": "active", "label": "Ativa", "required": False},
        ],
    },
}

DEFAULT_ADMIN_CATALOG_SEED = {
    "clients": [
        {
            "name": "Cliente Exemplo",
            "company_name": "Via Oceânica",
            "code": "CLI-001",
            "email": "cliente.exemplo@example.com",
            "phone": "+351 000 000 000",
            "address": "Lisboa",
        }
    ],
    "slas": [
        {"name": "SLA Padrão", "responseTime": "4h", "resolutionTime": "24h"},
    ],
    "sla_policies": [
        {"name": "Normal", "priority": "medium", "responseTime": "4h", "resolutionTime": "24h", "active": "true"},
        {"name": "Crítica", "priority": "urgent", "responseTime": "30m", "resolutionTime": "4h", "active": "true"},
    ],
    "priorities": [
        {"name": "Baixa", "level": "1", "color": "#64748b", "active": "true"},
        {"name": "Média", "level": "2", "color": "#0ea5e9", "active": "true"},
        {"name": "Alta", "level": "3", "color": "#f59e0b", "active": "true"},
        {"name": "Urgente", "level": "4", "color": "#ef4444", "active": "true"},
    ],
    "categories": [
        {"name": "Suporte geral", "code": "SUP", "description": "Pedidos gerais", "team": "support", "active": "true"},
        {"name": "Acessos", "code": "ACC", "description": "Problemas de login", "team": "support", "active": "true"},
        {"name": "Cobrança", "code": "BIL", "description": "Faturação e pagamentos", "team": "billing", "active": "true"},
    ],
    "support_agents": [
        {"name": "Agente Helpdesk", "email": "helpdesk@example.com", "team": "support", "role": "lead", "active": "true"},
    ],
    "urgency": [
        {"name": "Normal", "priority": "low", "color": "#64748b"},
        {"name": "Elevada", "priority": "high", "color": "#f59e0b"},
        {"name": "Crítica", "priority": "urgent", "color": "#ef4444"},
    ],
    "states": [
        {"name": "Aberto", "category": "active", "isFinal": "false"},
        {"name": "Em curso", "category": "active", "isFinal": "false"},
        {"name": "À espera do cliente", "category": "waiting", "isFinal": "false"},
        {"name": "Resolvido", "category": "done", "isFinal": "true"},
        {"name": "Fechado", "category": "done", "isFinal": "true"},
    ],
    "auto_responses": [
        {
            "name": "Confirmação inicial",
            "trigger": "helpdesk",
            "body_pt_pt": "Olá, obrigado pelo seu contacto. Já recebemos o seu pedido e vamos analisá-lo.",
            "active": "true",
        }
    ],
}


class TicketCreate(BaseModel):
    requester_name: str = Field(min_length=1, max_length=255)
    requester_email: str = Field(min_length=3, max_length=255)
    subject: str = Field(min_length=3, max_length=255)
    description: str = Field(min_length=3)
    priority: TicketPriority = "medium"
    category: Optional[str] = Field(default=None, max_length=64)
    tags: list[str] = Field(default_factory=list)
    sla_minutes: Optional[int] = Field(default=None, ge=5, le=10080)
    due_at: Optional[datetime] = None


class TicketUpdate(BaseModel):
    status: Optional[TicketStatus] = None
    priority: Optional[TicketPriority] = None
    category: Optional[str] = Field(default=None, max_length=64)
    assignee_name: Optional[str] = Field(default=None, max_length=255)
    tags: Optional[list[str]] = None
    sla_minutes: Optional[int] = Field(default=None, ge=5, le=10080)
    due_at: Optional[datetime] = None


class ConversationAttachmentCreate(BaseModel):
    filename: str = Field(min_length=1, max_length=255)
    content_type: str = Field(default="application/octet-stream", max_length=128)
    content_b64: str = Field(min_length=1)


class ConversationCreate(BaseModel):
    kind: ConversationKind = "reply"
    author_name: str = Field(min_length=1, max_length=255)
    author_email: Optional[str] = Field(default=None, max_length=255)
    body: str = Field(min_length=1)
    visibility: ConversationVisibility = "public"
    attachments: list[ConversationAttachmentCreate] = Field(default_factory=list)




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


def serialize_datetime_value(value) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def parse_platform_tenant_id(tenant_id: str) -> Optional[int]:
    raw_value = str(tenant_id or "").strip()
    if not raw_value or not raw_value.isdigit():
        return None
    return int(raw_value)


def get_platform_db_session() -> Session:
    if _PlatformSessionLocal is None:
        raise HTTPException(status_code=503, detail="Platform database is not configured")
    return _PlatformSessionLocal()


def load_portal_team_members(tenant_id: str) -> list[dict]:
    platform_tenant_id = parse_platform_tenant_id(tenant_id)
    if platform_tenant_id is None or _PlatformSessionLocal is None:
        return []

    with get_platform_db_session() as session:
        team_rows = session.execute(
            text(
                """
                select
                    u.id as platform_user_id,
                    u.name,
                    u.email,
                    u.company_role,
                    u.created_at,
                    u.updated_at,
                    t.name as team_name
                from users u
                join team_members tm on tm.user_id = u.id
                join teams t on t.id = tm.team_id
                where u.company_id = :tenant_id
                  and t.company_id = :tenant_id
                order by lower(coalesce(u.name, u.email, '')), lower(coalesce(t.name, ''))
                """
            ),
            {"tenant_id": platform_tenant_id},
        ).mappings().all()

        if team_rows:
            members_by_id: dict[int, dict] = {}
            for row in team_rows:
                platform_user_id = int(row["platform_user_id"])
                member = members_by_id.setdefault(
                    platform_user_id,
                    {
                        "platform_user_id": platform_user_id,
                        "name": row.get("name") or row.get("email") or f"Membro {platform_user_id}",
                        "email": row.get("email") or "",
                        "company_role": row.get("company_role") or "",
                        "created_at": row.get("created_at"),
                        "updated_at": row.get("updated_at"),
                        "teams": [],
                        "source": "portal-team",
                    },
                )
                team_name = (row.get("team_name") or "").strip()
                if team_name and team_name not in member["teams"]:
                    member["teams"].append(team_name)

            return [
                {
                    "platform_user_id": member["platform_user_id"],
                    "name": member["name"],
                    "email": member["email"],
                    "company_role": member["company_role"],
                    "team": ", ".join(member["teams"]),
                    "created_at": member["created_at"],
                    "updated_at": member["updated_at"],
                    "source": member["source"],
                }
                for member in members_by_id.values()
            ]

        return []


def serialize_portal_technician(tenant_id: str, member: dict) -> dict:
    return {
        "id": f"portal-technician-{member['platform_user_id']}",
        "tenant_id": tenant_id,
        "resource_type": "technicians",
        "name": member.get("name") or member.get("email") or f"Membro {member['platform_user_id']}",
        "email": member.get("email") or "",
        "team": member.get("team") or "",
        "company_role": member.get("company_role") or "",
        "platform_user_id": str(member.get("platform_user_id") or ""),
        "source": member.get("source") or "portal-member",
        "created_at": serialize_datetime_value(member.get("created_at")),
        "updated_at": serialize_datetime_value(member.get("updated_at")),
    }


def serialize_attachment(item: TicketAttachment) -> dict:
    return {
        "id": item.id,
        "ticket_id": item.ticket_id,
        "conversation_id": item.conversation_id,
        "tenant_id": item.tenant_id,
        "filename": item.filename,
        "content_type": item.content_type,
        "content_b64": item.content_b64,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


def get_admin_resource(resource_type: str) -> dict:
    resource = ADMIN_RESOURCES.get(resource_type)
    if resource is None:
        raise HTTPException(status_code=404, detail="Recurso administrativo não encontrado")
    return resource


def derive_client_code(values: dict) -> str:
    source = str(values.get("company_name") or values.get("name") or "").strip().upper()
    compact = "".join(ch for ch in source if ch.isalnum())
    return (compact[:3] or "CLI")


def validate_admin_payload(resource_type: str, values: dict) -> dict:
    resource = get_admin_resource(resource_type)
    if resource.get("read_only"):
        raise HTTPException(status_code=405, detail="Este catálogo é sincronizado a partir do portal Via Oceânica AI")
    normalized = {}
    for field in resource["fields"]:
        value = values.get(field["key"], "") if values else ""
        value = "" if value is None else str(value).strip()
        if field.get("required") and not value:
            raise HTTPException(status_code=400, detail=f"Campo obrigatório: {field['label']}")
        normalized[field["key"]] = value

    if resource_type == "clients" and not normalized.get("code"):
        normalized["code"] = derive_client_code(normalized)

    return normalized


def seed_default_admin_catalogs(session: Session, tenant_id: str) -> None:
    has_entries = session.scalar(
        select(AdminCatalogEntry.id).where(AdminCatalogEntry.tenant_id == tenant_id).limit(1)
    )
    if has_entries:
        return

    for resource_type, entries in DEFAULT_ADMIN_CATALOG_SEED.items():
        for values in entries:
            session.add(
                AdminCatalogEntry(
                    id=str(uuid4()),
                    tenant_id=tenant_id,
                    resource_type=resource_type,
                    payload=validate_admin_payload(resource_type, values),
                )
            )
    session.commit()


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
        "attachments": [serialize_attachment(attachment) for attachment in getattr(item, "attachments", [])],
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
        "due_at": ticket.due_at.isoformat() if ticket.due_at else None,
        "sla_minutes": ticket.sla_minutes,
        "routing_reason": ticket.routing_reason,
        "source": ticket.source,
        "tags": ticket.tags or [],
        "created_at": ticket.created_at.isoformat() if ticket.created_at else None,
        "updated_at": ticket.updated_at.isoformat() if ticket.updated_at else None,
    }
    if include_conversations:
        payload["conversations"] = [serialize_conversation(item) for item in sorted(ticket.conversations, key=lambda x: x.created_at)]
    return payload


DEFAULT_SLA_MINUTES = {
    "urgent": 120,
    "high": 480,
    "medium": 1440,
    "low": 2880,
}

ROUTING_HINTS = [
    ("billing", {"billing", "invoice", "payment", "finance", "fatura", "cobran", "accounts"}),
    ("access", {"login", "password", "auth", "signin", "2fa", "mfa", "access", "acesso"}),
    ("email", {"email", "mail", "smtp", "outlook", "exchange"}),
    ("infra", {"network", "dns", "vpn", "server", "infra", "cloud", "ops", "system"}),
    ("support", {"bug", "error", "issue", "help", "support", "helpdesk", "portal"}),
]


def is_truthy(value: object) -> bool:
    return str(value).strip().lower() in {"1", "true", "yes", "on", "active"}


def normalize_text(value: Optional[str]) -> str:
    return (value or "").strip().lower()


def parse_duration_minutes(value: object) -> Optional[int]:
    text = str(value or "").strip().lower()
    if not text:
        return None
    match = re.match(r"^(\d+(?:[\.,]\d+)?)\s*(m|min|mins|minute|minutes|minuto|minutos|h|hr|hrs|hour|hours|hora|horas|d|day|days|dia|dias)?$", text)
    if not match:
        return None
    amount = float(match.group(1).replace(",", "."))
    if amount <= 0:
        return None
    unit = (match.group(2) or "m").lower()
    if unit in {"d", "day", "days", "dia", "dias"}:
        return int(round(amount * 1440))
    if unit in {"h", "hr", "hrs", "hour", "hours", "hora", "horas"}:
        return int(round(amount * 60))
    return int(round(amount))


def migrate_helpdesk_schema() -> None:
    if _engine is None:
        return
    with _engine.begin() as conn:
        inspector = inspect(conn)
        if not inspector.has_table("helpdesk_tickets"):
            return
        columns = {column["name"] for column in inspector.get_columns("helpdesk_tickets")}
        if "due_at" not in columns:
            conn.exec_driver_sql("ALTER TABLE helpdesk_tickets ADD COLUMN due_at TIMESTAMP NULL")
        if "sla_minutes" not in columns:
            conn.exec_driver_sql("ALTER TABLE helpdesk_tickets ADD COLUMN sla_minutes INTEGER NULL")
        if "routing_reason" not in columns:
            conn.exec_driver_sql("ALTER TABLE helpdesk_tickets ADD COLUMN routing_reason TEXT NULL")


def load_support_agents(session: Session, tenant_id: str) -> list[dict[str, str]]:
    items = session.scalars(
        select(AdminCatalogEntry)
        .where(AdminCatalogEntry.tenant_id == tenant_id, AdminCatalogEntry.resource_type == "support_agents")
        .order_by(AdminCatalogEntry.updated_at.desc())
    ).all()
    agents: list[dict[str, str]] = []
    for item in items:
        payload = item.payload or {}
        if not is_truthy(payload.get("active", "true")):
            continue
        name = normalize_text(payload.get("name") or payload.get("email"))
        if not name:
            continue
        agents.append(
            {
                "name": payload.get("name", "").strip() or payload.get("email", "").strip(),
                "email": payload.get("email", "").strip(),
                "team": normalize_text(payload.get("team")),
                "role": normalize_text(payload.get("role")),
            }
        )
    agents.sort(key=lambda agent: (agent["role"] not in {"owner", "admin", "lead"}, agent["team"], agent["name"]))
    return agents


def load_catalog_entries(session: Session, tenant_id: str, resource_type: str) -> list[AdminCatalogEntry]:
    return session.scalars(
        select(AdminCatalogEntry)
        .where(AdminCatalogEntry.tenant_id == tenant_id, AdminCatalogEntry.resource_type == resource_type)
        .order_by(AdminCatalogEntry.updated_at.desc())
    ).all()


def get_catalog_payload(item: AdminCatalogEntry) -> dict:
    return item.payload or {}


def is_active_payload(payload: dict) -> bool:
    return is_truthy(payload.get("active", "true"))


def resolve_policy_sla_minutes(session: Session, tenant_id: str, priority: Optional[str]) -> Optional[int]:
    normalized_priority = normalize_text(priority)
    if not normalized_priority:
        return None

    for item in load_catalog_entries(session, tenant_id, "sla_policies"):
        payload = get_catalog_payload(item)
        if not is_active_payload(payload):
            continue
        if normalize_text(payload.get("priority")) != normalized_priority:
            continue
        minutes = parse_duration_minutes(payload.get("resolutionTime"))
        if minutes:
            return minutes
    return None


def resolve_default_sla_minutes(session: Session, tenant_id: str, priority: Optional[str]) -> int:
    return resolve_policy_sla_minutes(session, tenant_id, priority) or DEFAULT_SLA_MINUTES.get(normalize_text(priority), 1440)


def tokenize_catalog_value(value: object) -> set[str]:
    return {
        token.strip().lower()
        for token in re.split(r"[\s,;|/]+", str(value or ""))
        if token.strip()
    }


def build_default_auto_reply(ticket: Ticket) -> str:
    first_name = ticket.requester_name.strip().split()[0] if ticket.requester_name.strip() else ""
    greeting = f"Olá {first_name}," if first_name else "Olá,"
    return (
        f"{greeting} obrigado por contactar o Helpdesk. Já recebemos o seu pedido e estamos a analisá-lo. "
        "Se puder enviar mais detalhes ou capturas de ecrã, ajuda-nos a acelerar a resolução. "
        "Vamos manter este ticket atualizado."
    )


def choose_auto_reply_body(ticket: Ticket, session: Session) -> tuple[str, Optional[str]]:
    entries = load_catalog_entries(session, ticket.tenant_id, "auto_responses")
    haystack = " ".join(
        part for part in [ticket.subject, ticket.description, ticket.category or "", " ".join(ticket.tags or []), ticket.priority, ticket.status] if part
    ).lower()

    for item in entries:
        payload = get_catalog_payload(item)
        if not is_active_payload(payload):
            continue
        trigger_tokens = tokenize_catalog_value(payload.get("trigger")) | tokenize_catalog_value(payload.get("name"))
        if trigger_tokens and not any(token in haystack for token in trigger_tokens):
            continue
        body = (payload.get("body_pt_pt") or payload.get("body") or "").strip()
        if body:
            return body, payload.get("name")

    return build_default_auto_reply(ticket), None


def choose_routing_agent(ticket: Ticket, agents: list[dict[str, str]]) -> tuple[Optional[str], Optional[str]]:
    haystack = " ".join(
        part for part in [ticket.subject, ticket.description, ticket.category or "", " ".join(ticket.tags or []), ticket.priority] if part
    ).lower()

    def matches(agent: dict[str, str], hints: set[str]) -> bool:
        agent_text = " ".join([agent.get("name", ""), agent.get("team", ""), agent.get("role", "")]).lower()
        return any(hint in agent_text for hint in hints)

    if not agents:
        return None, None

    for label, hints in ROUTING_HINTS:
        if any(keyword in haystack for keyword in hints):
            for agent in agents:
                if matches(agent, hints):
                    return agent["name"], f"Auto-routing: {label} match"

    if ticket.priority in {"urgent", "high"}:
        for agent in agents:
            if agent["role"] in {"owner", "admin", "lead"}:
                return agent["name"], f"Auto-routing: priority={ticket.priority}"

    return agents[0]["name"], "Auto-routing: default support queue"


def apply_sla_defaults(ticket: Ticket, payload: dict, session: Session, *, on_create: bool = False) -> bool:
    changed = False
    priority = payload.get("priority", ticket.priority)
    default_sla_minutes = resolve_default_sla_minutes(session, ticket.tenant_id, priority)
    should_refresh_due_at = False

    if "sla_minutes" in payload:
        requested_sla_minutes = payload.get("sla_minutes")
        ticket.sla_minutes = requested_sla_minutes if requested_sla_minutes is not None else default_sla_minutes
        changed = True
        should_refresh_due_at = True
    elif on_create and ticket.sla_minutes is None:
        ticket.sla_minutes = default_sla_minutes
        changed = True
        should_refresh_due_at = True

    if "due_at" in payload and payload.get("due_at") is not None:
        ticket.due_at = payload.get("due_at")
        changed = True
    elif "due_at" in payload or should_refresh_due_at or (on_create and ticket.due_at is None):
        sla_minutes = ticket.sla_minutes or default_sla_minutes
        ticket.due_at = datetime.utcnow() + timedelta(minutes=int(sla_minutes))
        changed = True
    elif not on_create and ticket.due_at is None:
        sla_minutes = ticket.sla_minutes or default_sla_minutes
        ticket.due_at = datetime.utcnow() + timedelta(minutes=int(sla_minutes))
        changed = True

    return changed


def maybe_apply_auto_routing(ticket: Ticket, session: Session, force: bool = False) -> Optional[str]:
    should_route = force or not ticket.assignee_name or (ticket.routing_reason or "").startswith("Auto-routing")
    if not should_route:
        return None
    agents = load_support_agents(session, ticket.tenant_id)
    assignee_name, reason = choose_routing_agent(ticket, agents)
    if assignee_name and ticket.assignee_name != assignee_name:
        ticket.assignee_name = assignee_name
        ticket.routing_reason = reason
        return reason
    if reason and not ticket.routing_reason:
        ticket.routing_reason = reason
    return reason if assignee_name else None


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("[helpdesk] Starting on port %s", PORT)
    if _engine is not None:
        Base.metadata.create_all(bind=_engine)
        migrate_helpdesk_schema()
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


def require_ticket_editor(tenant_id: str) -> ModuleContext:
    ctx = get_module_context()
    if str(ctx.tenant_id) != str(tenant_id):
        raise HTTPException(status_code=403, detail="tenant_id em conflito com o contexto autenticado")

    platform_roles = {role.strip() for role in (ctx.platform_roles or "").split(",") if role.strip()}
    if "admin" in platform_roles:
        return ctx

    company_roles = {role.strip() for role in (ctx.company_role or "").split(",") if role.strip()}
    if company_roles.intersection({"owner", "admin", "member", "lead"}):
        return ctx

    raise HTTPException(status_code=403, detail="Acesso reservado a membros do helpdesk")


@app.middleware("http")
async def extract_platform_headers(request: Request, call_next):
    path = request.url.path
    if path in PUBLIC_PATHS:
        return await call_next(request)

    user_id = request.headers.get("x-viao-user-id", "")
    tenant_id = request.headers.get("x-viao-tenant-id", "") or request.headers.get("x-tenant-id", "")
    session_id = request.headers.get("x-viao-session-id", "")
    platform_roles = request.headers.get("x-viao-platform-roles", "")
    company_role = request.headers.get("x-viao-company-role", "")
    module_entitlements = request.headers.get("x-viao-module-entitlements", "")
    request_id = request.headers.get("x-viao-request-id", "")

    if not user_id:
        user_id = "0"
    if not tenant_id:
        if ALLOW_DEMO_TENANT:
            tenant_id = DEFAULT_TENANT
        else:
            return JSONResponse(status_code=401, content={"success": False, "error": {"code": "MISSING_TENANT", "message": "Missing tenant context"}})

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
        data = payload.model_dump()
        ticket = Ticket(
            id=str(uuid4()),
            tenant_id=request.state.tenant_id,
            requester_name=data["requester_name"].strip(),
            requester_email=data["requester_email"].strip().lower(),
            subject=data["subject"].strip(),
            description=data["description"].strip(),
            priority=data["priority"],
            category=data["category"].strip() if data.get("category") else None,
            tags=data.get("tags") or [],
            sla_minutes=data.get("sla_minutes"),
            due_at=data.get("due_at"),
            status="open",
            source="portal",
        )
        session.add(ticket)
        session.flush()
        event_notes = ["Ticket criado"]
        if apply_sla_defaults(ticket, data, session, on_create=True):
            if ticket.sla_minutes is not None:
                event_notes.append(f"SLA {ticket.sla_minutes} min")
            if ticket.due_at is not None:
                event_notes.append(f"Due {ticket.due_at.isoformat(timespec='minutes')}")
        routing_reason = maybe_apply_auto_routing(ticket, session, force=True)
        if routing_reason:
            event_notes.append(routing_reason)
        session.add(
            TicketConversation(
                id=str(uuid4()),
                ticket_id=ticket.id,
                tenant_id=ticket.tenant_id,
                kind="event",
                author_name="Sistema",
                author_email=None,
                body="Ticket criado" if len(event_notes) == 1 else "Ticket criado: " + "; ".join(event_notes[1:]),
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
    require_ticket_editor(request.state.tenant_id)
    with get_db_session() as session:
        ticket = session.get(Ticket, ticket_id)
        if ticket is None or ticket.tenant_id != request.state.tenant_id:
            raise HTTPException(status_code=404, detail="Ticket não encontrado")
        data = payload.model_dump(exclude_unset=True)
        changed_fields = []
        for key, value in data.items():
            setattr(ticket, key, value)
            changed_fields.append(f"{key}={value}")

        if apply_sla_defaults(ticket, data, session, on_create=False):
            changed_fields.append(f"sla_minutes={ticket.sla_minutes}")
            changed_fields.append(f"due_at={ticket.due_at.isoformat() if ticket.due_at else None}")

        routing_reason = None
        if "assignee_name" not in data and (ticket.assignee_name is None or (ticket.routing_reason or "").startswith("Auto-routing")):
            routing_reason = maybe_apply_auto_routing(ticket, session)
        if routing_reason:
            changed_fields.append(f"assignee_name={ticket.assignee_name}")

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


@app.delete("/api/v1/tickets/{ticket_id}")
async def delete_ticket(request: Request, ticket_id: str):
    require_tenant_admin(request.state.tenant_id)
    with get_db_session() as session:
        ticket = session.get(Ticket, ticket_id)
        if ticket is None or ticket.tenant_id != request.state.tenant_id:
            raise HTTPException(status_code=404, detail="Ticket não encontrado")
        session.delete(ticket)
        session.commit()
        return {"success": True, "data": {"id": ticket_id}}


@app.post("/api/v1/tickets/{ticket_id}/auto-reply")
async def auto_reply_ticket(request: Request, ticket_id: str):
    require_tenant_admin(request.state.tenant_id)
    with get_db_session() as session:
        ticket = session.get(Ticket, ticket_id)
        if ticket is None or ticket.tenant_id != request.state.tenant_id:
            raise HTTPException(status_code=404, detail="Ticket não encontrado")

        body, template_name = choose_auto_reply_body(ticket, session)
        item = TicketConversation(
            id=str(uuid4()),
            ticket_id=ticket.id,
            tenant_id=ticket.tenant_id,
            kind="reply",
            author_name="Assistente Helpdesk",
            author_email=None,
            body=body,
            visibility="public",
        )
        ticket.updated_at = datetime.utcnow()
        session.add(item)
        session.add(ticket)
        session.commit()
        session.refresh(item)
        return {"success": True, "data": {"conversation": serialize_conversation(item), "template": template_name, "body": body}}


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
        if len(payload.attachments or []) > 5:
            raise HTTPException(status_code=400, detail="Máximo de 5 anexos por mensagem")
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
        attachment_rows: list[TicketAttachment] = []
        for attachment in payload.attachments or []:
            try:
                decoded = base64.b64decode(attachment.content_b64, validate=True)
            except Exception:
                raise HTTPException(status_code=400, detail=f"Anexo inválido: {attachment.filename}")
            if len(decoded) > 2_000_000:
                raise HTTPException(status_code=400, detail=f"Anexo demasiado grande: {attachment.filename}")
            attachment_rows.append(
                TicketAttachment(
                    id=str(uuid4()),
                    ticket_id=ticket.id,
                    conversation_id=item.id,
                    tenant_id=ticket.tenant_id,
                    filename=attachment.filename.strip() or "anexo.bin",
                    content_type=attachment.content_type.strip() or "application/octet-stream",
                    content_b64=attachment.content_b64,
                )
            )
        ticket.updated_at = datetime.utcnow()
        session.add(item)
        for attachment_item in attachment_rows:
            session.add(attachment_item)
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
                "read_only": bool(value.get("read_only")),
            }
            for key, value in ADMIN_RESOURCES.items()
        },
    }


@app.get("/api/v1/admin/catalog/{resource_type}")
async def list_admin_catalog_entries(request: Request, resource_type: str):
    require_tenant_admin(request.state.tenant_id)
    resource = get_admin_resource(resource_type)
    if resource.get("read_only") and resource_type == "technicians":
        items = [serialize_portal_technician(request.state.tenant_id, member) for member in load_portal_team_members(request.state.tenant_id)]
        return {
            "success": True,
            "data": {
                "resource": resource_type,
                "label": resource["label"],
                "fields": resource["fields"],
                "read_only": True,
                "items": items,
            },
        }
    with get_db_session() as session:
        seed_default_admin_catalogs(session, request.state.tenant_id)
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
                "read_only": bool(resource.get("read_only")),
                "items": [serialize_admin_entry(item) for item in items],
            },
        }


@app.post("/api/v1/admin/catalog/{resource_type}")
async def create_admin_catalog_entry(request: Request, resource_type: str, payload: AdminCatalogPayload):
    require_tenant_admin(request.state.tenant_id)
    if get_admin_resource(resource_type).get("read_only"):
        raise HTTPException(status_code=405, detail="Os técnicos são sincronizados automaticamente com a equipa do portal")
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
    if get_admin_resource(resource_type).get("read_only"):
        raise HTTPException(status_code=405, detail="Os técnicos são sincronizados automaticamente com a equipa do portal")
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
    if get_admin_resource(resource_type).get("read_only"):
        raise HTTPException(status_code=405, detail="Os técnicos são sincronizados automaticamente com a equipa do portal")
    with get_db_session() as session:
        item = session.get(AdminCatalogEntry, entry_id)
        if item is None or item.tenant_id != request.state.tenant_id or item.resource_type != resource_type:
            raise HTTPException(status_code=404, detail="Registo não encontrado")
        session.delete(item)
        session.commit()
        return {"success": True, "data": {"id": entry_id}}
