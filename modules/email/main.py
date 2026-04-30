"""
Via Oceânica AI — Módulo Email

Administration-first Email module scaffold with IMAP mailbox configuration,
manual sync, and basic read-write mailbox actions.
"""
from __future__ import annotations

import base64
import contextvars
import hashlib
import imaplib
import logging
import os
import re
import ssl
import time
import unicodedata
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses, parsedate_to_datetime
from typing import Literal, Optional
from uuid import uuid4

from cryptography.fernet import Fernet, InvalidToken
from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import Boolean, DateTime, Index, Integer, String, Text, UniqueConstraint, create_engine, delete as sql_delete, func, or_, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

import httpx
from pgvector.sqlalchemy import Vector

from ai_client import ask_assistant

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("email")

PORT = int(os.getenv("MOD_EMAIL_PORT", "4004"))
DATABASE_URL = os.getenv("DATABASE_URL", "")
AI_AGENT_ID = os.getenv("AI_AGENT_ID", "email")
DEFAULT_TENANT = os.getenv("DEFAULT_TENANT_ID", "")
ALLOW_DEMO_TENANT = os.getenv("ALLOW_DEMO_TENANT", "false").lower() in {"1", "true", "yes", "on"}
EMAIL_CREDENTIALS_SECRET = os.getenv("EMAIL_CREDENTIALS_SECRET", "email-module-dev-secret-change-me")
SYNC_FETCH_LIMIT = int(os.getenv("EMAIL_SYNC_FETCH_LIMIT", "25"))
MANUAL_SYNC_FETCH_LIMIT = int(os.getenv("EMAIL_MANUAL_SYNC_FETCH_LIMIT", "5"))
AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://ai-service:4010")
EMAIL_EMBEDDING_MODEL = os.getenv("EMAIL_EMBEDDING_MODEL", "qwen3-embedding:8b")
EMAIL_EMBEDDING_TIMEOUT_SECONDS = float(os.getenv("EMAIL_EMBEDDING_TIMEOUT_SECONDS", "120"))
EMAIL_EMBEDDING_SOURCE_LIMIT = int(os.getenv("EMAIL_EMBEDDING_SOURCE_LIMIT", "12000"))
_start_time = time.time()

MailboxSecurityMode = Literal["ssl_tls", "starttls", "none"]
MailboxAccessMode = Literal["read_only", "read_write"]
CampaignStatus = Literal["draft", "scheduled", "sending", "sent"]
AutomationStatus = Literal["active", "paused"]
EmailAction = Literal["mark_read", "mark_unread", "delete", "move", "flag", "unflag"]


def utc_now() -> datetime:
    return datetime.utcnow()


def build_fernet(secret: str) -> Fernet:
    key = base64.urlsafe_b64encode(hashlib.sha256(secret.encode("utf-8")).digest())
    return Fernet(key)


FERNET = build_fernet(EMAIL_CREDENTIALS_SECRET)


class Base(DeclarativeBase):
    pass


class Mailbox(Base):
    __tablename__ = "email_mailboxes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(255))
    email_address: Mapped[str] = mapped_column(String(255), index=True)
    provider: Mapped[str] = mapped_column(String(64), default="imap")
    status: Mapped[str] = mapped_column(String(32), default="draft")
    sync_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    imap_host: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    imap_port: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    imap_username: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    imap_password_encrypted: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    security_mode: Mapped[str] = mapped_column(String(32), default="ssl_tls")
    access_mode: Mapped[str] = mapped_column(String(32), default="read_write")
    auth_method: Mapped[str] = mapped_column(String(32), default="password")
    folder: Mapped[str] = mapped_column(String(255), default="INBOX")
    validate_certificates: Mapped[bool] = mapped_column(Boolean, default=True)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    last_connection_test_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now, index=True)


class EmailMessage(Base):
    __tablename__ = "email_messages"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    mailbox_id: Mapped[str] = mapped_column(String(36), index=True)
    imap_uid: Mapped[str] = mapped_column(String(128), index=True)
    folder: Mapped[str] = mapped_column(String(255), default="INBOX")
    message_id_header: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    subject: Mapped[Optional[str]] = mapped_column(String(512), nullable=True)
    from_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    from_address: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    to_addresses: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    snippet: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    body_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    body_html: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    received_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True, index=True)
    is_seen: Mapped[bool] = mapped_column(Boolean, default=False)
    is_flagged: Mapped[bool] = mapped_column(Boolean, default=False)
    has_attachments: Mapped[bool] = mapped_column(Boolean, default=False)
    remote_deleted: Mapped[bool] = mapped_column(Boolean, default=False)
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now, index=True)


class EmailMessageEmbedding(Base):
    __tablename__ = "email_message_embeddings"
    __table_args__ = (
        UniqueConstraint("tenant_id", "message_id", name="uq_email_message_embeddings_tenant_message"),
        Index("ix_email_message_embeddings_tenant_mailbox_embedded", "tenant_id", "mailbox_id", "embedded_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    mailbox_id: Mapped[str] = mapped_column(String(36), index=True)
    message_id: Mapped[str] = mapped_column(String(36), index=True)
    folder: Mapped[str] = mapped_column(String(255), default="INBOX")
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    content_text: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    embedding_model: Mapped[str] = mapped_column(String(128), default="qwen3-embedding:8b")
    embedding: Mapped[list[float]] = mapped_column(Vector(), nullable=False)
    embedded_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now, index=True)


class EmailCampaign(Base):
    __tablename__ = "email_campaigns"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(255))
    subject: Mapped[str] = mapped_column(String(255))
    audience: Mapped[str] = mapped_column(String(255), default="all")
    status: Mapped[str] = mapped_column(String(32), default="draft")
    scheduled_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    sent_count: Mapped[int] = mapped_column(Integer, default=0)
    opened_count: Mapped[int] = mapped_column(Integer, default=0)
    clicked_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now, index=True)


class AutomationRule(Base):
    __tablename__ = "email_automation_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(255))
    trigger: Mapped[str] = mapped_column(String(255))
    action: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now, index=True)


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
    "email_module_context", default=None
)

PUBLIC_PATHS = frozenset(["/health", "/ready", "/api/health", "/api/ready"])


class MailboxCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email_address: str = Field(min_length=3, max_length=255)
    provider: str = Field(default="imap", min_length=2, max_length=64)
    sync_enabled: bool = True


class MailboxAdminUpsert(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    email_address: str = Field(min_length=3, max_length=255)
    imap_host: str = Field(min_length=3, max_length=255)
    imap_port: int = Field(ge=1, le=65535)
    imap_username: str = Field(min_length=1, max_length=255)
    imap_password: Optional[str] = Field(default=None, max_length=1024)
    security_mode: MailboxSecurityMode = "ssl_tls"
    access_mode: MailboxAccessMode = "read_write"
    folder: str = Field(default="INBOX", min_length=1, max_length=255)
    validate_certificates: bool = True
    sync_enabled: bool = True
    auth_method: Literal["password"] = "password"

    @field_validator("name", "email_address", "imap_host", "imap_username", "folder")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("email_address")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()

    @field_validator("imap_host")
    @classmethod
    def normalize_host(cls, value: str) -> str:
        return value.strip().lower()

    @model_validator(mode="after")
    def validate_security_and_port(self):
        if self.security_mode == "ssl_tls" and self.imap_port == 143:
            raise ValueError("A porta 143 é invulgar para SSL/TLS. Use 993, exceto se o fornecedor indicar outra.")
        if self.security_mode in {"starttls", "none"} and self.imap_port == 993:
            raise ValueError("A porta 993 costuma ser usada apenas para SSL/TLS direto, não para STARTTLS ou IMAP simples.")
        return self


class MailboxConnectionTestRequest(BaseModel):
    imap_password: Optional[str] = Field(default=None, max_length=1024)


class EmailActionRequest(BaseModel):
    action: EmailAction
    target_folder: Optional[str] = Field(default=None, max_length=255)

    @field_validator("target_folder")
    @classmethod
    def strip_target_folder(cls, value: str | None) -> str | None:
        return value.strip() if value else value

    @model_validator(mode="after")
    def validate_target_folder(self):
        if self.action == "move" and not self.target_folder:
            raise ValueError("target_folder é obrigatório quando a ação é move")
        return self


class CampaignCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    subject: str = Field(min_length=3, max_length=255)
    audience: str = Field(default="all", min_length=1, max_length=255)
    status: CampaignStatus = "draft"
    scheduled_at: Optional[datetime] = None


class AutomationCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    trigger: str = Field(min_length=3, max_length=255)
    action: str = Field(min_length=3)
    status: AutomationStatus = "active"


class ParsedEmailPayload(BaseModel):
    message_id_header: Optional[str] = None
    subject: Optional[str] = None
    from_name: Optional[str] = None
    from_address: Optional[str] = None
    to_addresses: Optional[str] = None
    snippet: Optional[str] = None
    body_text: Optional[str] = None
    body_html: Optional[str] = None
    received_at: Optional[datetime] = None
    has_attachments: bool = False


class AssistantContextRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    limit: int = Field(default=12, ge=1, le=25)
    selected_email_id: Optional[str] = Field(default=None, max_length=64)
    selected_email_ids: list[str] = Field(default_factory=list, max_length=25)


class EmailSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=4000)
    limit: int = Field(default=10, ge=1, le=50)
    mailbox_id: Optional[str] = Field(default=None, max_length=64)
    folder: Optional[str] = Field(default=None, max_length=255)
    include_children: bool = False


class AssistantActionPreviewRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    limit: int = Field(default=5, ge=1, le=10)
    selected_email_id: Optional[str] = Field(default=None, max_length=64)
    selected_email_ids: list[str] = Field(default_factory=list, max_length=25)


class AssistantActionExecuteRequest(BaseModel):
    action: EmailAction
    email_ids: list[str] = Field(min_length=1, max_length=50)
    target_folder: Optional[str] = Field(default=None, max_length=255)


def get_db_session() -> Session:
    if _SessionLocal is None:
        raise HTTPException(status_code=503, detail="A base de dados do módulo Email não está configurada")
    return _SessionLocal()


def get_module_context() -> ModuleContext:
    ctx = _current_context.get()
    if ctx is None:
        raise HTTPException(status_code=401, detail="Contexto do módulo em falta")
    return ctx


def parse_platform_roles(value: str | None) -> set[str]:
    return {part.strip() for part in (value or "").split(",") if part.strip()}


def require_admin_access(request: Request) -> None:
    company_role = (request.state.company_role or "").strip().lower()
    platform_roles = parse_platform_roles(request.state.platform_roles)
    if company_role not in {"owner", "admin"} and "admin" not in platform_roles:
        raise HTTPException(status_code=403, detail="É necessário acesso de administrador para configurar mailboxes de Email")


def encrypt_secret(value: str) -> str:
    return FERNET.encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_secret(value: str) -> str:
    try:
        return FERNET.decrypt(value.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:
        raise HTTPException(status_code=500, detail="Stored mailbox credentials could not be decrypted") from exc


def ensure_db_extensions() -> None:
    if _engine is None:
        return

    with _engine.begin() as conn:
        conn.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS vector")


def ensure_schema() -> None:
    if _engine is None:
        return

    statements = [
        "ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS imap_host VARCHAR(255)",
        "ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS imap_port INTEGER",
        "ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS imap_username VARCHAR(255)",
        "ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS imap_password_encrypted TEXT",
        "ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS security_mode VARCHAR(32) DEFAULT 'ssl_tls'",
        "ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS access_mode VARCHAR(32) DEFAULT 'read_write'",
        "ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS auth_method VARCHAR(32) DEFAULT 'password'",
        "ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS folder VARCHAR(255) DEFAULT 'INBOX'",
        "ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS validate_certificates BOOLEAN DEFAULT TRUE",
        "ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS last_error TEXT",
        "ALTER TABLE email_mailboxes ADD COLUMN IF NOT EXISTS last_connection_test_at TIMESTAMP NULL",
    ]

    with _engine.begin() as conn:
        for statement in statements:
            conn.exec_driver_sql(statement)

        conn.exec_driver_sql("UPDATE email_mailboxes SET provider = 'imap' WHERE provider IS NULL OR provider = ''")
        conn.exec_driver_sql("UPDATE email_mailboxes SET security_mode = 'ssl_tls' WHERE security_mode IS NULL OR security_mode = ''")
        conn.exec_driver_sql("UPDATE email_mailboxes SET access_mode = 'read_write' WHERE access_mode IS NULL OR access_mode = ''")
        conn.exec_driver_sql("UPDATE email_mailboxes SET auth_method = 'password' WHERE auth_method IS NULL OR auth_method = ''")
        conn.exec_driver_sql("UPDATE email_mailboxes SET folder = 'INBOX' WHERE folder IS NULL OR folder = ''")
        conn.exec_driver_sql("UPDATE email_mailboxes SET validate_certificates = TRUE WHERE validate_certificates IS NULL")


def build_email_embedding_source(item: EmailMessage) -> str:
    parts = [
        f"Assunto: {item.subject or ''}",
        f"De: {item.from_name or item.from_address or ''}",
        f"Para: {item.to_addresses or ''}",
        f"Folder: {item.folder or 'INBOX'}",
        f"Snippet: {item.snippet or ''}",
        f"Corpo: {(item.body_text or '')[:EMAIL_EMBEDDING_SOURCE_LIMIT]}",
    ]
    return "\n".join(part for part in parts if part and part.strip())


def calculate_content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def fetch_embedding_vector(text: str, tenant_id: str, model: str = EMAIL_EMBEDDING_MODEL) -> list[float] | None:
    if not text.strip():
        return None

    try:
        with httpx.Client(timeout=EMAIL_EMBEDDING_TIMEOUT_SECONDS) as client:
            response = client.post(
                f"{AI_SERVICE_URL}/api/v1/embeddings",
                json={"input": text, "model": model},
                headers={
                    "Content-Type": "application/json",
                    "x-viao-user-id": "1",
                    "x-viao-tenant-id": tenant_id,
                    "x-viao-company-role": "owner",
                    "x-viao-request-id": f"email-embedding-{uuid4()}",
                },
            )
            response.raise_for_status()
            payload = response.json()
            embedding = ((payload.get("data") or {}).get("data") or [{}])[0].get("embedding")
            return embedding if isinstance(embedding, list) else None
    except Exception as exc:
        logger.warning("[email] embedding generation failed: %s", exc)
        return None


def sync_email_embedding(session: Session, item: EmailMessage) -> bool:
    source_text = build_email_embedding_source(item)
    if not source_text.strip():
        return False

    content_hash = calculate_content_hash(source_text)
    existing = session.scalar(
        select(EmailMessageEmbedding).where(
            EmailMessageEmbedding.tenant_id == item.tenant_id,
            EmailMessageEmbedding.message_id == item.id,
        )
    )

    if existing and existing.content_hash == content_hash and existing.embedding_model == EMAIL_EMBEDDING_MODEL:
        return False

    embedding = fetch_embedding_vector(source_text, item.tenant_id)
    if not embedding:
        return False

    if existing is None:
        existing = EmailMessageEmbedding(
            id=str(uuid4()),
            tenant_id=item.tenant_id,
            mailbox_id=item.mailbox_id,
            message_id=item.id,
            folder=item.folder,
            content_hash=content_hash,
            content_text=source_text,
            embedding_model=EMAIL_EMBEDDING_MODEL,
            embedding=embedding,
            embedded_at=utc_now(),
        )
        session.add(existing)
    else:
        existing.mailbox_id = item.mailbox_id
        existing.folder = item.folder
        existing.content_hash = content_hash
        existing.content_text = source_text
        existing.embedding_model = EMAIL_EMBEDDING_MODEL
        existing.embedding = embedding
        existing.embedded_at = utc_now()
        existing.updated_at = utc_now()

    return True


def get_mailbox_or_404(session: Session, tenant_id: str, mailbox_id: str) -> Mailbox:
    mailbox = session.scalar(select(Mailbox).where(Mailbox.tenant_id == tenant_id, Mailbox.id == mailbox_id))
    if mailbox is None:
        raise HTTPException(status_code=404, detail="Mailbox não encontrada")
    return mailbox


def get_email_or_404(session: Session, tenant_id: str, email_id: str) -> EmailMessage:
    item = session.scalar(select(EmailMessage).where(EmailMessage.tenant_id == tenant_id, EmailMessage.id == email_id))
    if item is None:
        raise HTTPException(status_code=404, detail="Email não encontrado")
    return item


def normalize_date(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(timezone.utc).replace(tzinfo=None)


ASSISTANT_QUERY_STOPWORDS = {
    "a",
    "an",
    "and",
    "as",
    "da",
    "de",
    "do",
    "dos",
    "das",
    "emails",
    "email",
    "form",
    "from",
    "for",
    "in",
    "mails",
    "message",
    "messages",
    "mensagem",
    "mensagens",
    "para",
    "por",
    "recipient",
    "recipients",
    "regarding",
    "summarize",
    "summary",
    "than",
    "sobre",
    "to",
    "o",
    "or",
    "the",
}

GENERIC_EMAIL_REFERENCES = {
    "email",
    "emails",
    "latest",
    "latest email",
    "latest emails",
    "last email",
    "last emails",
    "last",
    "most recent email",
    "most recent emails",
    "most recent",
    "recent",
    "this email",
    "these emails",
    "o email mais recente",
    "o ultimo email",
    "o último email",
}


def truncate_text(value: str | None, max_length: int = 180) -> str:
    cleaned = re.sub(r"\s+", " ", (value or "")).strip()
    if len(cleaned) <= max_length:
        return cleaned
    return f"{cleaned[: max_length - 1].rstrip()}…"


def normalize_assistant_query_phrase(value: str) -> str:
    cleaned = re.sub(r"\s+", " ", value).strip(" '\".,;:!?()[]{}")
    cleaned = re.sub(r"^(?:the|o|a|os|as)\s+", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b(?:emails?|mails?|messages?|mensagens?)\b", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" '\".,;:!?()[]{}")
    return cleaned[:120]


def extract_sender_queries(question: str) -> list[str]:
    candidates: list[str] = []
    normalized = re.sub(r"\s+", " ", question).strip()

    patterns = [
        r"(?:emails?|mails?|messages?|mensagens?)\s+(?:from|form|de|do|da|remetente|sender)\s+(.+?)(?:$|[?!,;])",
        r"(?:from|form|de|do|da|remetente|sender)\s+(.+?)(?:$|[?!,;])",
    ]
    for pattern in patterns:
        for match in re.findall(pattern, normalized, flags=re.IGNORECASE):
            cleaned = normalize_assistant_query_phrase(match)
            if cleaned:
                candidates.append(cleaned)

    for match in re.findall(r'["“](.+?)["”]', normalized):
        cleaned = normalize_assistant_query_phrase(match)
        if cleaned:
            candidates.append(cleaned)

    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = candidate.lower()
        if normalize_search_text(candidate) in GENERIC_EMAIL_REFERENCES:
            continue
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped[:3]


def extract_recipient_queries(question: str) -> list[str]:
    candidates: list[str] = []
    normalized = re.sub(r"\s+", " ", question).strip()

    patterns = [
        r"(?:emails?|mails?|messages?|mensagens?)\s+(?:to|para|destinatario|destinatário|recipient)\s+(.+?)(?:$|[?!,;])",
        r"(?:to|para|destinatario|destinatário|recipient)\s+(.+?)(?:$|[?!,;])",
    ]
    for pattern in patterns:
        for match in re.findall(pattern, normalized, flags=re.IGNORECASE):
            cleaned = normalize_assistant_query_phrase(match)
            if cleaned:
                candidates.append(cleaned)

    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = normalize_search_text(candidate)
        if not key or key in GENERIC_EMAIL_REFERENCES or key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped[:3]


def build_sender_search_filters(term: str) -> list:
    normalized = normalize_assistant_query_phrase(term).lower()
    if not normalized:
        return []

    name_field = func.lower(func.coalesce(EmailMessage.from_name, ""))
    address_field = func.lower(func.coalesce(EmailMessage.from_address, ""))
    email_addresses = re.findall(r"[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}", normalized, flags=re.IGNORECASE)
    if email_addresses:
        return [address_field.like(f"%{email_address.lower()}%") for email_address in email_addresses]

    tokens = [
        token
        for token in re.split(r"[^a-z0-9@._%+-]+", normalized)
        if len(token) >= 2 and token not in ASSISTANT_QUERY_STOPWORDS
    ][:4]
    return [or_(name_field.like(f"%{token}%"), address_field.like(f"%{token}%")) for token in tokens]


def build_recipient_search_filters(term: str) -> list:
    normalized = normalize_assistant_query_phrase(term).lower()
    if not normalized:
        return []

    recipient_field = func.lower(func.coalesce(EmailMessage.to_addresses, ""))
    email_addresses = re.findall(r"[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}", normalized, flags=re.IGNORECASE)
    if email_addresses:
        return [recipient_field.like(f"%{email_address.lower()}%") for email_address in email_addresses]

    tokens = [
        token
        for token in re.split(r"[^a-z0-9@._%+-]+", normalized)
        if len(token) >= 2 and token not in ASSISTANT_QUERY_STOPWORDS
    ][:4]
    return [recipient_field.like(f"%{token}%") for token in tokens]


def serialize_assistant_email_summary(item: EmailMessage) -> dict:
    sender = item.from_name or item.from_address or "Remetente desconhecido"
    return {
        "id": item.id,
        "subject": item.subject or "(Sem assunto)",
        "from": sender,
        "from_address": item.from_address,
        "to_addresses": item.to_addresses,
        "folder": item.folder or "INBOX",
        "received_at": item.received_at.isoformat() if item.received_at else None,
        "snippet": truncate_text(item.snippet or item.body_text or item.body_html or "", 180),
        "is_seen": bool(item.is_seen),
        "is_flagged": bool(item.is_flagged),
        "has_attachments": bool(item.has_attachments),
    }


def serialize_assistant_email_detail(item: EmailMessage) -> dict:
    payload = serialize_assistant_email_summary(item)
    payload["body_preview"] = truncate_text(item.body_text or item.snippet or item.body_html or "", 1600)
    return payload


def normalize_selected_email_ids(selected_email_id: str | None, selected_email_ids: list[str] | None) -> list[str]:
    unique_ids: list[str] = []
    for candidate in [selected_email_id, *(selected_email_ids or [])]:
        if not candidate or candidate in unique_ids:
            continue
        unique_ids.append(candidate)
    return unique_ids[:25]


def load_selected_emails_for_assistant(session: Session, tenant_id: str, selected_email_id: str | None, selected_email_ids: list[str] | None) -> list[EmailMessage]:
    normalized_ids = normalize_selected_email_ids(selected_email_id, selected_email_ids)
    if not normalized_ids:
        return []

    items = session.scalars(
        select(EmailMessage)
        .where(
            EmailMessage.tenant_id == tenant_id,
            EmailMessage.remote_deleted.is_(False),
            EmailMessage.id.in_(normalized_ids),
        )
        .order_by(EmailMessage.received_at.desc(), EmailMessage.updated_at.desc())
    ).all()
    order_map = {email_id: index for index, email_id in enumerate(normalized_ids)}
    return sorted(items, key=lambda item: order_map.get(item.id, len(order_map)))


def build_participant_match_payload(
    session: Session,
    base_filters: list,
    query_value: str,
    filter_builder,
    grouped_columns: tuple,
    limit: int,
) -> dict | None:
    scoped_filters = [*base_filters, *filter_builder(query_value)]
    if len(scoped_filters) == len(base_filters):
        return None

    total = int(session.scalar(select(func.count()).select_from(EmailMessage).where(*scoped_filters)) or 0)
    grouped = session.execute(
        select(*grouped_columns, func.count())
        .where(*scoped_filters)
        .group_by(*grouped_columns)
        .order_by(func.count().desc())
        .limit(5)
    ).all()
    recent_matches = session.scalars(
        select(EmailMessage)
        .where(*scoped_filters)
        .order_by(EmailMessage.received_at.desc(), EmailMessage.updated_at.desc())
        .limit(min(limit, 5))
    ).all()
    return {
        "query": query_value,
        "total": total,
        "matches": grouped,
        "recent_emails": [serialize_assistant_email_summary(item) for item in recent_matches],
    }


def extract_keyword_terms(message: str, sender_queries: list[str], recipient_queries: list[str], subject_queries: list[str]) -> list[str]:
    normalized = normalize_search_text(message)
    for phrase in [*sender_queries, *recipient_queries, *subject_queries]:
        phrase_normalized = normalize_search_text(phrase)
        if phrase_normalized:
            normalized = normalized.replace(phrase_normalized, " ")

    normalized = re.sub(
        r"\b(delete|remove|remover|apagar|eliminar|trash|move|mover|transferir|archive|arquivar|flag|unflag|star|important|importante|mark|latest|last|most recent|ultimo|ultima|último|última|read|unread|lido|ler|week|semana|today|hoje|yesterday|ontem|days|day|dias|dia|older|mais antigo|older than|this week|past|ultimos|últimos)\b",
        " ",
        normalized,
    )
    tokens = [
        token
        for token in re.split(r"[^a-z0-9@._%+-]+", normalized)
        if len(token) >= 3 and token not in ASSISTANT_QUERY_STOPWORDS and token not in GENERIC_EMAIL_REFERENCES
    ]

    deduped: list[str] = []
    seen: set[str] = set()
    for token in tokens:
        if token in seen:
            continue
        seen.add(token)
        deduped.append(token)
    return deduped[:4]


def extract_email_query_filters(message: str) -> dict:
    normalized = normalize_search_text(message)
    now = datetime.utcnow()
    filters = {
        "latest_only": request_targets_latest_email(message),
        "unread_only": bool(re.search(r"\b(unread|por ler|nao lido|não lido)\b", normalized)),
        "flagged_only": bool(re.search(r"\b(flagged|important|importantes|importante|starred|com estrela)\b", normalized)),
        "attachments_only": bool(re.search(r"\b(with attachments|attachment|attachments|anexo|anexos)\b", normalized)),
        "older_than_days": None,
        "received_after": None,
        "received_before": None,
        "folder_query": None,
    }

    older_match = re.search(r"\b(?:older than|mais antigo que|mais antigas que)\s+(\d{1,3})\s+(?:days|day|dias|dia)\b", normalized)
    if older_match:
        filters["older_than_days"] = int(older_match.group(1))
        filters["received_before"] = now - timedelta(days=int(older_match.group(1)))

    last_days_match = re.search(r"\b(?:last|past|ultimos|últimos)\s+(\d{1,3})\s+(?:days|day|dias|dia)\b", normalized)
    if last_days_match:
        filters["received_after"] = now - timedelta(days=int(last_days_match.group(1)))

    if re.search(r"\b(this week|esta semana)\b", normalized):
        start_of_week = now - timedelta(days=now.weekday())
        filters["received_after"] = start_of_week.replace(hour=0, minute=0, second=0, microsecond=0)
    elif re.search(r"\b(today|hoje)\b", normalized):
        filters["received_after"] = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif re.search(r"\b(yesterday|ontem)\b", normalized):
        start_today = now.replace(hour=0, minute=0, second=0, microsecond=0)
        filters["received_after"] = start_today - timedelta(days=1)
        filters["received_before"] = start_today

    folder_match = re.search(r"\b(?:in|na|no|para a pasta|pasta)\s+(inbox|archive|arquivo|spam|junk|trash|lixo|sent|enviados|drafts|rascunhos?)\b", normalized)
    if folder_match:
        filters["folder_query"] = folder_match.group(1)

    return filters


def apply_email_query_filters(filters: list, filter_info: dict) -> list:
    scoped = [*filters]
    if filter_info.get("unread_only"):
        scoped.append(EmailMessage.is_seen.is_(False))
    if filter_info.get("flagged_only"):
        scoped.append(EmailMessage.is_flagged.is_(True))
    if filter_info.get("attachments_only"):
        scoped.append(EmailMessage.has_attachments.is_(True))
    if filter_info.get("received_after") is not None:
        scoped.append(EmailMessage.received_at >= normalize_date(filter_info["received_after"]))
    if filter_info.get("received_before") is not None:
        scoped.append(EmailMessage.received_at < normalize_date(filter_info["received_before"]))
    if filter_info.get("folder_query"):
        folder_field = func.lower(func.coalesce(EmailMessage.folder, ""))
        normalized_folder = normalize_search_text(str(filter_info["folder_query"]))
        scoped.append(folder_field.like(f"%{normalized_folder}%"))
    return scoped


def build_keyword_filters(keyword_terms: list[str]) -> list:
    subject_field = func.lower(func.coalesce(EmailMessage.subject, ""))
    snippet_field = func.lower(func.coalesce(EmailMessage.snippet, ""))
    body_field = func.lower(func.coalesce(EmailMessage.body_text, ""))
    html_field = func.lower(func.coalesce(EmailMessage.body_html, ""))
    return [
        or_(
            subject_field.like(f"%{term}%"),
            snippet_field.like(f"%{term}%"),
            body_field.like(f"%{term}%"),
            html_field.like(f"%{term}%"),
        )
        for term in keyword_terms
    ]


def build_email_assistant_context(
    session: Session,
    tenant_id: str,
    question: str,
    limit: int,
    selected_email_id: str | None = None,
    selected_email_ids: list[str] | None = None,
) -> dict:
    base_filters = [EmailMessage.tenant_id == tenant_id, EmailMessage.remote_deleted.is_(False)]
    mailboxes = session.scalars(
        select(Mailbox).where(Mailbox.tenant_id == tenant_id).order_by(Mailbox.updated_at.desc())
    ).all()
    mailbox_counts = get_mailbox_message_counts(session, tenant_id)

    summary = {
        "mailboxes_total": len(mailboxes),
        "mailboxes_connected": sum(1 for item in mailboxes if item.status == "connected"),
        "emails_total": int(session.scalar(select(func.count()).select_from(EmailMessage).where(*base_filters)) or 0),
        "emails_unread": int(
            session.scalar(
                select(func.count()).select_from(EmailMessage).where(*base_filters, EmailMessage.is_seen.is_(False))
            )
            or 0
        ),
        "emails_flagged": int(
            session.scalar(
                select(func.count()).select_from(EmailMessage).where(*base_filters, EmailMessage.is_flagged.is_(True))
            )
            or 0
        ),
        "emails_with_attachments": int(
            session.scalar(
                select(func.count()).select_from(EmailMessage).where(*base_filters, EmailMessage.has_attachments.is_(True))
            )
            or 0
        ),
    }

    recent_emails = session.scalars(
        select(EmailMessage)
        .where(*base_filters)
        .order_by(EmailMessage.received_at.desc(), EmailMessage.updated_at.desc())
        .limit(limit)
    ).all()
    selected_emails = load_selected_emails_for_assistant(session, tenant_id, selected_email_id, selected_email_ids)

    sender_queries = extract_sender_queries(question)
    recipient_queries = extract_recipient_queries(question)
    keyword_terms = extract_keyword_terms(question, sender_queries, recipient_queries, extract_subject_queries(question))
    query_filters, query_info = build_assistant_email_query(session, tenant_id, question)

    sender_matches: list[dict] = []
    for sender_query in sender_queries:
        payload = build_participant_match_payload(
            session,
            base_filters,
            sender_query,
            build_sender_search_filters,
            (EmailMessage.from_name, EmailMessage.from_address),
            limit,
        )
        if payload:
            sender_matches.append(
                {
                    "query": payload["query"],
                    "total": payload["total"],
                    "matches": [
                        {
                            "from_name": row[0],
                            "from_address": row[1],
                            "count": int(row[2] or 0),
                        }
                        for row in payload["matches"]
                    ],
                    "recent_emails": payload["recent_emails"],
                }
            )

    recipient_matches: list[dict] = []
    for recipient_query in recipient_queries:
        payload = build_participant_match_payload(
            session,
            base_filters,
            recipient_query,
            build_recipient_search_filters,
            (EmailMessage.to_addresses,),
            limit,
        )
        if payload:
            recipient_matches.append(
                {
                    "query": payload["query"],
                    "total": payload["total"],
                    "matches": [
                        {
                            "to_addresses": row[0],
                            "count": int(row[1] or 0),
                        }
                        for row in payload["matches"]
                    ],
                    "recent_emails": payload["recent_emails"],
                }
            )

    scoped_total = int(session.scalar(select(func.count()).select_from(EmailMessage).where(*query_filters)) or 0)
    scoped_emails = session.scalars(
        select(EmailMessage)
        .where(*query_filters)
        .order_by(EmailMessage.received_at.desc(), EmailMessage.updated_at.desc())
        .limit(min(limit, 12))
    ).all()

    return {
        "question": question,
        "summary": summary,
        "mailboxes": [
            {
                "id": item.id,
                "name": item.name,
                "email_address": item.email_address,
                "status": item.status,
                "stored_count": int(mailbox_counts.get(item.id, {}).get("stored_count", 0)),
                "unread_count": int(mailbox_counts.get(item.id, {}).get("unread_count", 0)),
                "flagged_count": int(mailbox_counts.get(item.id, {}).get("flagged_count", 0)),
                "last_synced_at": item.last_synced_at.isoformat() if item.last_synced_at else None,
            }
            for item in mailboxes[:8]
        ],
        "recent_emails": [serialize_assistant_email_summary(item) for item in recent_emails],
        "selected_email": serialize_assistant_email_detail(selected_emails[0]) if selected_emails else None,
        "selected_emails": [serialize_assistant_email_detail(item) for item in selected_emails[:10]],
        "sender_matches": sender_matches,
        "recipient_matches": recipient_matches,
        "query_scope": {
            "total": scoped_total,
            "filters": query_info,
            "selected_email_count": len(selected_emails),
            "recent_emails": [serialize_assistant_email_summary(item) for item in scoped_emails],
            "keyword_terms": keyword_terms,
        },
    }

def search_email_messages(session: Session, tenant_id: str, query: str, limit: int, mailbox_id: str | None = None, folder: str | None = None, include_children: bool = False) -> dict:
    query_filters, query_info = build_assistant_email_query(session, tenant_id, query)
    mailbox_filters: list = []
    if mailbox_id:
        mailbox_filters.append(EmailMessage.mailbox_id == mailbox_id)
    folder_filters: list = []
    if folder and folder != ALL_FOLDERS_KEY:
        if include_children and should_include_child_folders(folder):
            folder_filters.append(
                or_(
                    EmailMessage.folder == folder,
                    EmailMessage.folder.startswith(f"{folder}."),
                    EmailMessage.folder.startswith(f"{folder}/"),
                )
            )
        else:
            folder_filters.append(EmailMessage.folder == folder)

    scoped_filters = [*query_filters, *mailbox_filters, *folder_filters]
    if not session.scalar(select(func.count()).select_from(EmailMessage).where(*scoped_filters)):
        scoped_filters = [
            EmailMessage.tenant_id == tenant_id,
            EmailMessage.remote_deleted.is_(False),
            *mailbox_filters,
            *folder_filters,
        ]

    query_vector = fetch_embedding_vector(query, tenant_id)
    candidate_limit = max(limit * 5, 25)

    if query_vector:
        distance_expr = EmailMessageEmbedding.embedding.cosine_distance(query_vector)
        rows = session.execute(
            select(EmailMessage, EmailMessageEmbedding, distance_expr.label("distance"))
            .join(
                EmailMessageEmbedding,
                (EmailMessageEmbedding.tenant_id == EmailMessage.tenant_id) & (EmailMessageEmbedding.message_id == EmailMessage.id),
            )
            .where(*scoped_filters)
            .order_by(distance_expr.asc(), EmailMessage.received_at.desc(), EmailMessage.updated_at.desc())
            .limit(candidate_limit)
        ).all()

        scored = []
        normalized_query = normalize_search_text(query)
        terms = [term for term in re.split(r"[^a-z0-9@._%+-]+", normalized_query) if len(term) >= 3]
        for message, embedding_row, distance in rows:
            blob = normalize_search_text(f"{message.subject or ''} {message.from_name or ''} {message.from_address or ''} {message.snippet or ''} {message.body_text or ''}")
            keyword_hits = sum(1 for term in terms if term in blob)
            semantic_score = max(0.0, 1.0 - float(distance or 0.0))
            score = round(semantic_score + (keyword_hits * 0.05), 4)
            scored.append((score, semantic_score, keyword_hits, float(distance or 0.0), message, embedding_row))

        scored.sort(key=lambda row: (-row[0], row[3], row[4].received_at or datetime.min), reverse=False)
        ranked = scored[:limit]
        return {
            "query": query,
            "query_info": query_info,
            "query_vector_available": True,
            "results": [
                {
                    **serialize_assistant_email_summary(message),
                    "score": score,
                    "semantic_score": semantic_score,
                    "distance": distance,
                    "keyword_hits": keyword_hits,
                    "embedding_model": embedding_row.embedding_model,
                }
                for score, semantic_score, keyword_hits, distance, message, embedding_row in ranked
            ],
        }

    rows = session.scalars(
        select(EmailMessage)
        .where(*scoped_filters)
        .order_by(EmailMessage.received_at.desc(), EmailMessage.updated_at.desc())
        .limit(limit)
    ).all()
    return {
        "query": query,
        "query_info": query_info,
        "query_vector_available": False,
        "results": [serialize_assistant_email_summary(item) for item in rows],
    }


def normalize_search_text(value: str | None) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    ascii_text = "".join(char for char in normalized if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", ascii_text).strip().lower()


def split_folder_segments_for_assistant(folder: str) -> list[str]:
    return [segment.strip() for segment in re.split(r"[./]", folder or "") if segment.strip()]


def trim_inbox_root_for_assistant(segments: list[str]) -> list[str]:
    if len(segments) > 1 and normalize_search_text(segments[0]) == "inbox":
        return segments[1:]
    return segments


def prettify_folder_segment_for_assistant(segment: str) -> str:
    normalized = normalize_search_text(segment)
    if normalized == "inbox":
        return "Caixa de entrada"
    if normalized in {"sent", "sent items", "enviados"}:
        return "Enviados"
    if normalized in {"draft", "drafts", "rascunho", "rascunhos"}:
        return "Rascunhos"
    if normalized in {"archive", "archives", "arquivo", "arquivos"}:
        return "Arquivo"
    if normalized in {"spam", "junk", "bulk mail"}:
        return "Spam"
    if normalized in {"trash", "bin", "lixo", "deleted"}:
        return "Lixo"
    return segment


def folder_label_for_assistant(folder: str) -> str:
    if not folder:
        return "INBOX"
    raw_segments = split_folder_segments_for_assistant(folder)
    safe_segments = trim_inbox_root_for_assistant(raw_segments) or raw_segments
    if not safe_segments:
        return folder
    return " / ".join(prettify_folder_segment_for_assistant(segment) for segment in safe_segments)


def extract_subject_queries(question: str) -> list[str]:
    candidates: list[str] = []
    normalized = re.sub(r"\s+", " ", question).strip()
    patterns = [
        r"(?:subject|assunto)\s+(?:contains|contém|com|is|=)?\s*[\"“']?(.+?)[\"”']?(?:$|[?.!,;])",
        r"(?:with subject|com assunto)\s*[\"“']?(.+?)[\"”']?(?:$|[?.!,;])",
    ]
    for pattern in patterns:
        for match in re.findall(pattern, normalized, flags=re.IGNORECASE):
            cleaned = truncate_text(normalize_assistant_query_phrase(match), 140)
            if cleaned:
                candidates.append(cleaned)

    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        key = normalize_search_text(candidate)
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return deduped[:3]


def extract_email_action_intent(message: str) -> dict | None:
    normalized = normalize_search_text(message)
    if not normalized:
        return None

    if re.search(r"\b(unflag|remove important|remover importante|remove importante|tirar importante|desmarcar importante)\b", normalized):
        return {"action": "unflag"}
    if re.search(r"\b(mark unread|mark as unread|marcar por ler|marca por ler|marcar como por ler|marca como por ler|marcar nao lido|marca nao lido|nao lido|não lido|nao lidos|não lidos)\b", normalized):
        return {"action": "mark_unread"}
    if re.search(r"\b(mark|marcar|marca)\b", normalized) and re.search(r"\b(unread|por ler|nao lido|não lido|nao lidos|não lidos)\b", normalized):
        return {"action": "mark_unread"}
    if re.search(r"\b(mark read|mark as read|marcar lido|marca lido|marcar como lido|marca como lido|marcar lidos|marca lidos|marcar como lidos|marca como lidos)\b", normalized):
        return {"action": "mark_read"}
    if re.search(r"\b(mark|marcar|marca)\b", normalized) and re.search(r"\b(read|lido|lidos)\b", normalized):
        return {"action": "mark_read"}
    if re.search(r"\b(flag|star|important|importante|marcar importante|marca importante)\b", normalized):
        return {"action": "flag"}
    if re.search(r"\b(archive|arquivar|arquiva)\b", normalized):
        return {"action": "move", "target_folder_query": "Arquivo"}
    if re.search(r"\b(move|mover|move|mova|transferir|transfere)\b", normalized):
        folder_match = re.search(r"\b(?:to|para)\s+(.+?)(?:$|[?.!,;])", message, flags=re.IGNORECASE)
        target_folder_query = normalize_assistant_query_phrase(folder_match.group(1)) if folder_match else ""
        return {"action": "move", "target_folder_query": target_folder_query}
    if re.search(r"\b(delete|remove|remover|remove|apagar|apaga|eliminar|elimina|trash)\b", normalized):
        return {"action": "delete"}
    return None


def action_label_for_assistant(action: str) -> str:
    return {
        "delete": "apagar",
        "move": "mover",
        "mark_read": "marcar como lido",
        "mark_unread": "marcar como por ler",
        "flag": "marcar como importante",
        "unflag": "remover a marca de importante",
    }.get(action, action)


def request_targets_latest_email(message: str) -> bool:
    normalized = normalize_search_text(message)
    return bool(
        re.search(r"\b(latest|last|most recent|ultimo|ultima|último|última|mais recente)\b", normalized)
        and re.search(r"\b(email|emails|mail|mails|message|messages|mensagem|mensagens)\b", normalized)
    )


def request_targets_selected_email(message: str) -> bool:
    normalized = normalize_search_text(message)
    return bool(
        re.search(r"\b(this|selected|opened|open|current|este|esta|isto|selecionado|selecionada|aberto|aberta|atual)\b", normalized)
        and re.search(r"\b(email|mail|message|mensagem|resposta)\b", normalized)
    )


def request_targets_selected_emails(message: str) -> bool:
    normalized = normalize_search_text(message)
    return bool(
        re.search(r"\b(these|selected|selection|current|bulk|estas|estes|selecao|seleção|selecionados|selecionadas|atuais|todos os selecionados|todas as selecionadas)\b", normalized)
        and re.search(r"\b(emails|mails|messages|mensagens|selecao|seleção|selecionados|selecionadas)\b", normalized)
    )


def build_assistant_email_query(session: Session, tenant_id: str, message: str):
    filters = [EmailMessage.tenant_id == tenant_id, EmailMessage.remote_deleted.is_(False)]
    sender_queries = extract_sender_queries(message)
    recipient_queries = extract_recipient_queries(message)
    subject_queries = extract_subject_queries(message)
    filter_info = extract_email_query_filters(message)
    keyword_terms = extract_keyword_terms(message, sender_queries, recipient_queries, subject_queries)

    for sender_query in sender_queries[:1]:
        sender_filters = build_sender_search_filters(sender_query)
        if sender_filters:
            filters.extend(sender_filters)

    for recipient_query in recipient_queries[:1]:
        recipient_filters = build_recipient_search_filters(recipient_query)
        if recipient_filters:
            filters.extend(recipient_filters)

    subject_field = func.lower(func.coalesce(EmailMessage.subject, ""))
    for subject_query in subject_queries[:2]:
        normalized_subject = normalize_search_text(subject_query)
        if normalized_subject:
            filters.append(subject_field.like(f"%{normalized_subject}%"))

    if keyword_terms and not sender_queries and not recipient_queries and not subject_queries:
        filters.extend(build_keyword_filters(keyword_terms))

    filters = apply_email_query_filters(filters, filter_info)

    return filters, {
        "sender_queries": sender_queries,
        "recipient_queries": recipient_queries,
        "subject_queries": subject_queries,
        "keyword_terms": keyword_terms,
        "latest_only": bool(filter_info.get("latest_only")),
        "unread_only": bool(filter_info.get("unread_only")),
        "flagged_only": bool(filter_info.get("flagged_only")),
        "attachments_only": bool(filter_info.get("attachments_only")),
        "older_than_days": filter_info.get("older_than_days"),
        "folder_query": filter_info.get("folder_query"),
        "received_after": normalize_date(filter_info.get("received_after")).isoformat() if filter_info.get("received_after") else None,
        "received_before": normalize_date(filter_info.get("received_before")).isoformat() if filter_info.get("received_before") else None,
        "has_targeting": bool(sender_queries or recipient_queries or subject_queries or keyword_terms or filter_info.get("latest_only") or filter_info.get("unread_only") or filter_info.get("flagged_only") or filter_info.get("attachments_only") or filter_info.get("older_than_days") or filter_info.get("received_after") or filter_info.get("received_before") or filter_info.get("folder_query")),
    }


def folder_aliases_for_assistant(folder: str) -> set[str]:
    aliases = {normalize_search_text(folder), normalize_search_text(folder_label_for_assistant(folder))}
    raw_segments = split_folder_segments_for_assistant(folder)
    safe_segments = trim_inbox_root_for_assistant(raw_segments) or raw_segments
    if safe_segments:
        aliases.add(normalize_search_text(safe_segments[-1]))
        aliases.add(normalize_search_text(" ".join(safe_segments)))
        aliases.add(normalize_search_text(" / ".join(prettify_folder_segment_for_assistant(segment) for segment in safe_segments)))
    aliases.discard("")
    return aliases


def resolve_target_folder_for_assistant(target_folder_query: str, folders: list[str]) -> tuple[str | None, list[str]]:
    normalized_target = normalize_search_text(target_folder_query)
    if not normalized_target:
        return None, []

    exact_matches = [folder for folder in folders if normalized_target in folder_aliases_for_assistant(folder)]
    if len(exact_matches) == 1:
        return exact_matches[0], []
    if len(exact_matches) > 1:
        return None, [folder_label_for_assistant(folder) for folder in exact_matches[:5]]

    partial_matches = [
        folder
        for folder in folders
        if any(normalized_target in alias for alias in folder_aliases_for_assistant(folder))
    ]
    if len(partial_matches) == 1:
        return partial_matches[0], []
    return None, [folder_label_for_assistant(folder) for folder in partial_matches[:5]]


def build_email_action_confirmation(action: str, emails: list[EmailMessage], total: int, target_folder: str | None = None) -> str:
    verb = {
        "delete": "apague",
        "move": "mova",
        "mark_read": "marque como lido",
        "mark_unread": "marque como por ler",
        "flag": "marque como importante",
        "unflag": "remova a marca de importante de",
    }.get(action, action_label_for_assistant(action))
    target_suffix = f" para \"{folder_label_for_assistant(target_folder)}\"" if action == "move" and target_folder else ""
    count_label = "este email" if total == 1 else f"estes {total} emails"
    if action == "unflag":
        count_label = "deste email" if total == 1 else f"destes {total} emails"
    lines = [f"Encontrei {total} email(s). Queres que eu {verb} {count_label}{target_suffix}?"]
    for item in emails[:5]:
        sender = item.from_name or item.from_address or "Remetente desconhecido"
        received = item.received_at.strftime("%Y-%m-%d %H:%M") if item.received_at else "sem data"
        lines.append(f"- {received} | {sender} | {item.subject or '(Sem assunto)'}")
    if total > len(emails[:5]):
        lines.append(f"- … e mais {total - len(emails[:5])} email(s)")
    lines.append("Responde 'confirmar' para executar ou 'cancelar' para abortar.")
    return "\n".join(lines)


def build_email_action_preview(
    session: Session,
    tenant_id: str,
    message: str,
    limit: int,
    selected_email_id: str | None = None,
    selected_email_ids: list[str] | None = None,
) -> dict:
    intent = extract_email_action_intent(message)
    if not intent:
        return {"matched": False}

    action = str(intent["action"])
    filters, query_info = build_assistant_email_query(session, tenant_id, message)
    selected_items = load_selected_emails_for_assistant(session, tenant_id, selected_email_id, selected_email_ids)
    targets_selected_single = bool(selected_items and request_targets_selected_email(message))
    targets_selected_many = bool(selected_items and request_targets_selected_emails(message))

    if targets_selected_single:
        items = selected_items[:1]
        total = len(items)
        latest_only = True
        query_info = {**query_info, "selected_email": True}
    elif targets_selected_many:
        items = selected_items[:25]
        total = len(selected_items)
        latest_only = False
        query_info = {**query_info, "selected_emails": True}
    else:
        items = []
        total = 0
        latest_only = False

    if not query_info.get("has_targeting") and not targets_selected_single and not targets_selected_many:
        return {
            "matched": True,
            "ready": False,
            "message": "Posso tratar disso, mas preciso que indiques melhor quais emails queres alterar. Diz-me um remetente, um destinatário, um endereço de email, um assunto, um tema como invoice/newsletter, um filtro como por ler/anexos, pede explicitamente o email mais recente, ou usa o email atualmente aberto/selecionado na interface.",
        }

    if not items:
        query = select(EmailMessage).where(*filters).order_by(EmailMessage.received_at.desc(), EmailMessage.updated_at.desc())
        latest_only = bool(query_info.get("latest_only"))
        items = session.scalars(query.limit(1 if latest_only else 50)).all()
        total = len(items) if latest_only else int(session.scalar(select(func.count()).select_from(EmailMessage).where(*filters)) or 0)

    if not items or total == 0:
        return {
            "matched": True,
            "ready": False,
            "message": "Não encontrei emails que correspondam a esse pedido. Tenta indicar melhor o remetente, o destinatário, o assunto, o tema, a pasta, ou um intervalo temporal mais específico.",
        }

    if total > 25 and not latest_only:
        return {
            "matched": True,
            "ready": False,
            "message": f"Encontrei {total} emails para essa ação. Para segurança, afina o pedido com um remetente, assunto ou intervalo mais específico antes de eu executar alterações em massa.",
        }

    resolved_folder = None
    target_folder_query = str(intent.get("target_folder_query") or "").strip()
    if action == "move":
        if not target_folder_query:
            return {
                "matched": True,
                "ready": False,
                "message": "Posso mover emails pelo assistente, mas preciso que indiques a pasta de destino, por exemplo: mover o email mais recente para Arquivo.",
            }

        mailbox_ids = {item.mailbox_id for item in items}
        if len(mailbox_ids) != 1:
            return {
                "matched": True,
                "ready": False,
                "message": "Encontrei emails em várias mailboxes. Para mover pelo assistente, limita o pedido a uma única mailbox, remetente ou assunto.",
            }

        mailbox = get_mailbox_or_404(session, tenant_id, items[0].mailbox_id)
        folders = list_mailbox_folders(mailbox)
        resolved_folder, suggestions = resolve_target_folder_for_assistant(target_folder_query, folders)
        if not resolved_folder:
            suggestion_text = f" Sugestões: {', '.join(suggestions)}." if suggestions else ""
            return {
                "matched": True,
                "ready": False,
                "message": f"Não consegui resolver a pasta de destino \"{target_folder_query}\" nessa mailbox.{suggestion_text}",
            }

    actionable_items = items if latest_only else items[: min(total, 25)]
    preview_items = actionable_items[: min(limit, len(actionable_items))]
    return {
        "matched": True,
        "ready": True,
        "action": action,
        "target_folder": resolved_folder,
        "target_folder_query": target_folder_query or None,
        "email_ids": [item.id for item in actionable_items],
        "email_count": len(actionable_items),
        "emails": [serialize_assistant_email_summary(item) for item in preview_items],
        "query_scope": query_info,
        "confirmation_prompt": build_email_action_confirmation(action, preview_items, len(actionable_items), resolved_folder),
    }


def execute_email_assistant_action(session: Session, tenant_id: str, action: str, email_ids: list[str], target_folder: str | None) -> dict:
    unique_ids = [email_id for index, email_id in enumerate(email_ids) if email_id and email_id not in email_ids[:index]]
    if not unique_ids:
        raise HTTPException(status_code=422, detail="Nenhum email foi indicado para a ação do assistente")

    items = session.scalars(
        select(EmailMessage)
        .where(EmailMessage.tenant_id == tenant_id, EmailMessage.id.in_(unique_ids))
        .order_by(EmailMessage.received_at.desc(), EmailMessage.updated_at.desc())
    ).all()
    if not items:
        raise HTTPException(status_code=404, detail="Os emails pedidos já não estão disponíveis")

    applied: list[dict] = []
    errors: list[dict] = []
    for item in items:
        mailbox = get_mailbox_or_404(session, tenant_id, item.mailbox_id)
        try:
            result = apply_email_action(session, mailbox, item, action, target_folder)
            applied.append(
                {
                    "id": item.id,
                    "subject": item.subject or "(Sem assunto)",
                    "from": item.from_name or item.from_address or "Remetente desconhecido",
                    "mailbox_id": item.mailbox_id,
                    "message": result.get("message"),
                }
            )
        except HTTPException as exc:
            errors.append(
                {
                    "id": item.id,
                    "subject": item.subject or "(Sem assunto)",
                    "detail": str(exc.detail),
                }
            )

    return {
        "action": action,
        "target_folder": target_folder,
        "applied_count": len(applied),
        "failed_count": len(errors),
        "applied": applied,
        "errors": errors,
    }


def parse_message_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return normalize_date(parsedate_to_datetime(value))
    except Exception:
        return None


def safe_get_content(part) -> str:
    try:
        content = part.get_content()
        return content if isinstance(content, str) else ""
    except Exception:
        return ""


def make_snippet(*values: str | None, limit: int = 240) -> str | None:
    for value in values:
        if not value:
            continue
        cleaned = " ".join(value.replace("\xa0", " ").split())
        if cleaned:
            return cleaned[:limit]
    return None


def parse_email_payload(raw_bytes: bytes) -> ParsedEmailPayload:
    message = BytesParser(policy=policy.default).parsebytes(raw_bytes)

    plain_parts: list[str] = []
    html_parts: list[str] = []
    has_attachments = False

    if message.is_multipart():
        for part in message.walk():
            disposition = (part.get_content_disposition() or "").lower()
            content_type = part.get_content_type()
            if disposition == "attachment":
                has_attachments = True
                continue
            if content_type == "text/plain":
                text = safe_get_content(part)
                if text:
                    plain_parts.append(text)
            elif content_type == "text/html":
                html = safe_get_content(part)
                if html:
                    html_parts.append(html)
    else:
        content_type = message.get_content_type()
        if content_type == "text/plain":
            text = safe_get_content(message)
            if text:
                plain_parts.append(text)
        elif content_type == "text/html":
            html = safe_get_content(message)
            if html:
                html_parts.append(html)

    from_pairs = getaddresses(message.get_all("from", []))
    to_pairs = getaddresses(message.get_all("to", []))
    from_name, from_address = (from_pairs[0] if from_pairs else (None, None))

    body_text = "\n\n".join(part.strip() for part in plain_parts if part.strip()) or None
    body_html = "\n\n".join(part.strip() for part in html_parts if part.strip()) or None
    subject = str(message.get("subject") or "").strip() or "(No subject)"

    return ParsedEmailPayload(
        message_id_header=str(message.get("message-id") or "").strip() or None,
        subject=subject,
        from_name=(from_name or "").strip() or None,
        from_address=(from_address or "").strip().lower() or None,
        to_addresses=", ".join(address for _, address in to_pairs if address) or None,
        snippet=make_snippet(body_text, subject),
        body_text=(body_text[:20000] if body_text else None),
        body_html=(body_html[:40000] if body_html else None),
        received_at=parse_message_date(message.get("date")),
        has_attachments=has_attachments,
    )


def build_ssl_context(validate_certificates: bool) -> ssl.SSLContext:
    ssl_context = ssl.create_default_context()
    if not validate_certificates:
        ssl_context.check_hostname = False
        ssl_context.verify_mode = ssl.CERT_NONE
    return ssl_context


def open_imap_connection(
    *,
    host: str,
    port: int,
    username: str,
    password: str,
    security_mode: str,
    validate_certificates: bool,
    folder: str,
    readonly: bool,
) -> tuple[imaplib.IMAP4 | imaplib.IMAP4_SSL, int]:
    ssl_context = build_ssl_context(validate_certificates) if security_mode in {"ssl_tls", "starttls"} else None

    client: imaplib.IMAP4 | imaplib.IMAP4_SSL
    if security_mode == "ssl_tls":
        client = imaplib.IMAP4_SSL(host=host, port=port, ssl_context=ssl_context)
    else:
        client = imaplib.IMAP4(host=host, port=port)
        if security_mode == "starttls":
            typ, data = client.starttls(ssl_context)
            if typ != "OK":
                raise RuntimeError(f"STARTTLS failed: {data}")

    try:
        login_status, login_data = client.login(username, password)
        if login_status != "OK":
            raise RuntimeError(f"Login failed: {login_data}")

        select_status, select_data = client.select(folder, readonly=readonly)
        if select_status != "OK":
            raise RuntimeError(f"Folder select failed: {select_data}")

        count = 0
        if select_data and select_data[0]:
            try:
                count = int(select_data[0])
            except (TypeError, ValueError):
                count = 0
        return client, count
    except Exception:
        try:
            client.logout()
        except Exception:
            pass
        raise


def close_imap_client(client: imaplib.IMAP4 | imaplib.IMAP4_SSL | None) -> None:
    if client is None:
        return
    try:
        client.logout()
    except Exception:
        pass


def is_imap_disconnect_error(exc: Exception) -> bool:
    message = str(exc).lower()
    return any(token in message for token in ("server shutting down", "socket error", "eof", "connection reset", "broken pipe"))


def test_imap_connection(
    *, host: str, port: int, username: str, password: str, security_mode: str, validate_certificates: bool, folder: str
) -> dict:
    client, message_count = open_imap_connection(
        host=host,
        port=port,
        username=username,
        password=password,
        security_mode=security_mode,
        validate_certificates=validate_certificates,
        folder=folder,
        readonly=True,
    )
    try:
        return {
            "connected": True,
            "message": f"Ligação estabelecida a {host}:{port} com abertura da pasta '{folder}'",
            "message_count": message_count,
        }
    finally:
        close_imap_client(client)


def parse_fetch_payload(fetch_data: list | tuple | None) -> tuple[str, bytes]:
    meta_parts: list[str] = []
    raw_bytes: bytes | None = None

    for entry in fetch_data or []:
        if isinstance(entry, tuple):
            if entry and isinstance(entry[0], bytes):
                meta_parts.append(entry[0].decode("utf-8", errors="ignore"))
            if len(entry) > 1 and isinstance(entry[1], bytes):
                raw_bytes = entry[1]
        elif isinstance(entry, bytes):
            meta_parts.append(entry.decode("utf-8", errors="ignore"))

    if raw_bytes is None:
        raise RuntimeError("Não foi possível ler a mensagem devolvida pelo servidor IMAP")

    return " ".join(meta_parts), raw_bytes


def parse_imap_flags(meta: str) -> set[str]:
    match = re.search(r"FLAGS \((.*?)\)", meta)
    if not match:
        return set()
    return {flag.strip() for flag in match.group(1).split() if flag.strip()}


def decode_imap_folder_name(entry: bytes | str) -> str | None:
    text = entry.decode("utf-8", errors="ignore") if isinstance(entry, bytes) else str(entry)
    text = text.strip()
    match = re.search(r'\)\s+"[^"]*"\s+(.+)$', text)
    if not match:
        return None
    folder = match.group(1).strip()
    if folder.startswith('"') and folder.endswith('"'):
        folder = folder[1:-1].replace('\\"', '"')
    return folder or None


def should_include_child_folders(scope_folder: str | None) -> bool:
    value = (scope_folder or "").strip().lower()
    if not value:
        return False

    strict_folder_leaves = {
        "inbox",
        "spam",
        "junk",
        "bulk mail",
        "trash",
        "bin",
        "deleted",
        "sent",
        "sent items",
        "enviados",
        "draft",
        "drafts",
        "rascunho",
        "rascunhos",
        "archive",
        "archives",
        "arquivo",
        "arquivos",
    }

    segments = [segment for segment in re.split(r"[./]", value) if segment]
    if len(segments) > 1 and segments[0] == "inbox":
        segments = segments[1:]
    leaf = segments[-1] if segments else value

    return leaf not in strict_folder_leaves


def sort_folder_names(folders: list[str], configured_folder: str | None = None) -> list[str]:
    configured = (configured_folder or "INBOX").strip().lower()

    def sort_key(folder: str) -> tuple[int, int, str]:
        value = folder.strip().lower()
        if value == configured:
            return (0, 0, value)
        if value == "inbox" or value.endswith("/inbox"):
            return (0, 1, value)
        if any(token in value for token in ("sent", "enviad")):
            return (1, 0, value)
        if any(token in value for token in ("draft", "rascun")):
            return (2, 0, value)
        if any(token in value for token in ("archive", "arquivo")):
            return (3, 0, value)
        if any(token in value for token in ("spam", "junk", "lixo eletr")):
            return (4, 0, value)
        if any(token in value for token in ("trash", "bin", "lixo")):
            return (5, 0, value)
        return (6, 0, value)

    unique: list[str] = []
    seen: set[str] = set()
    for folder in folders:
        normalized = folder.strip()
        if not normalized:
            continue
        key = normalized.lower()
        if key in seen:
            continue
        seen.add(key)
        unique.append(normalized)

    return sorted(unique, key=sort_key)


def list_client_folders(client: imaplib.IMAP4 | imaplib.IMAP4_SSL, configured_folder: str | None = None) -> list[str]:
    status, data = client.list()
    if status != "OK":
        raise RuntimeError(f"Falha ao listar as pastas da mailbox: {data}")

    folders: list[str] = []
    for entry in data or []:
        if not entry:
            continue
        folder = decode_imap_folder_name(entry)
        if folder:
            folders.append(folder)

    fallback_folder = configured_folder or "INBOX"
    if fallback_folder and fallback_folder not in folders:
        folders.append(fallback_folder)

    return sort_folder_names(folders, configured_folder=fallback_folder)


def list_mailbox_folders(mailbox: Mailbox) -> list[str]:
    if not mailbox.imap_password_encrypted:
        raise HTTPException(status_code=422, detail="A palavra-passe da mailbox não está guardada")
    if not mailbox.imap_host or not mailbox.imap_port or not mailbox.imap_username:
        raise HTTPException(status_code=422, detail="É necessário configurar primeiro o host, a porta e o utilizador IMAP da mailbox")

    password = decrypt_secret(mailbox.imap_password_encrypted)
    client, _ = open_imap_connection(
        host=mailbox.imap_host,
        port=int(mailbox.imap_port),
        username=mailbox.imap_username,
        password=password,
        security_mode=mailbox.security_mode or "ssl_tls",
        validate_certificates=bool(mailbox.validate_certificates),
        folder=mailbox.folder or "INBOX",
        readonly=True,
    )
    try:
        return list_client_folders(client, mailbox.folder or "INBOX")
    finally:
        try:
            client.logout()
        except Exception:
            pass


def get_mailbox_folder_stats(session: Session, mailbox: Mailbox, folders: list[str]) -> list[dict]:
    rows = session.execute(
        select(EmailMessage.folder, EmailMessage.is_seen).where(
            EmailMessage.tenant_id == mailbox.tenant_id,
            EmailMessage.mailbox_id == mailbox.id,
            EmailMessage.remote_deleted.is_(False),
        )
    ).all()

    stats: dict[str, dict[str, int | str]] = {}
    for folder_name, is_seen in rows:
        key = folder_name or mailbox.folder or "INBOX"
        if key not in stats:
            stats[key] = {"folder": key, "stored": 0, "unread": 0}
        stats[key]["stored"] = int(stats[key]["stored"]) + 1
        if not is_seen:
            stats[key]["unread"] = int(stats[key]["unread"]) + 1

    for folder in folders:
        stats.setdefault(folder, {"folder": folder, "stored": 0, "unread": 0})

    return [stats[folder] for folder in sort_folder_names(list(stats.keys()), mailbox.folder or "INBOX")]


def sync_selected_folder(
    session: Session,
    client: imaplib.IMAP4 | imaplib.IMAP4_SSL,
    mailbox: Mailbox,
    folder: str,
    limit: int,
) -> dict:
    select_status, select_data = client.select(folder, readonly=True)
    if select_status != "OK":
        raise RuntimeError(f"Falha ao abrir a pasta '{folder}': {select_data}")

    remote_total = 0
    if select_data and select_data[0]:
        try:
            remote_total = int(select_data[0])
        except (TypeError, ValueError):
            remote_total = 0

    search_status, search_data = client.uid("search", None, "ALL")
    if search_status != "OK":
        raise RuntimeError(f"Falha na pesquisa IMAP da pasta '{folder}': {search_data}")

    all_uids: list[str] = []
    if search_data and search_data[0]:
        all_uids = [uid for uid in search_data[0].decode("utf-8", errors="ignore").split() if uid]
    selected_uids = all_uids[-max(1, min(limit, 100)):]

    existing = []
    if selected_uids:
        existing = session.scalars(
            select(EmailMessage).where(
                EmailMessage.tenant_id == mailbox.tenant_id,
                EmailMessage.mailbox_id == mailbox.id,
                EmailMessage.folder == folder,
                EmailMessage.imap_uid.in_(selected_uids),
            )
        ).all()
    existing_by_uid = {item.imap_uid: item for item in existing}

    synced_count = 0
    new_count = 0
    updated_count = 0
    embedded_count = 0

    for uid in reversed(selected_uids):
        fetch_status, fetch_data = client.uid("fetch", uid, "(UID FLAGS BODY.PEEK[])")
        if fetch_status != "OK":
            logger.warning("[email] Failed to fetch UID %s for mailbox %s folder %s: %s", uid, mailbox.id, folder, fetch_data)
            continue

        meta, raw_bytes = parse_fetch_payload(fetch_data)
        flags = parse_imap_flags(meta)
        payload = parse_email_payload(raw_bytes)

        item = existing_by_uid.get(uid)
        if item is None and payload.message_id_header:
            item = session.scalar(
                select(EmailMessage).where(
                    EmailMessage.tenant_id == mailbox.tenant_id,
                    EmailMessage.mailbox_id == mailbox.id,
                    EmailMessage.folder == folder,
                    EmailMessage.message_id_header == payload.message_id_header,
                )
            )

        if item is None:
            item = EmailMessage(
                id=str(uuid4()),
                tenant_id=mailbox.tenant_id,
                mailbox_id=mailbox.id,
                imap_uid=uid,
                folder=folder,
            )
            session.add(item)
            new_count += 1
        else:
            updated_count += 1

        item.imap_uid = uid
        item.folder = folder
        item.message_id_header = payload.message_id_header
        item.subject = payload.subject
        item.from_name = payload.from_name
        item.from_address = payload.from_address
        item.to_addresses = payload.to_addresses
        item.snippet = payload.snippet
        item.body_text = payload.body_text
        item.body_html = payload.body_html
        item.received_at = payload.received_at or item.received_at or utc_now()
        item.has_attachments = payload.has_attachments
        item.is_seen = "\\Seen" in flags
        item.is_flagged = "\\Flagged" in flags
        item.remote_deleted = "\\Deleted" in flags
        item.last_synced_at = utc_now()
        item.updated_at = utc_now()
        synced_count += 1

        try:
            if sync_email_embedding(session, item):
                embedded_count += 1
        except Exception as exc:
            logger.warning("[email] embedding sync failed for message %s: %s", item.id, exc)

    return {
        "folder": folder,
        "fetched": synced_count,
        "created": new_count,
        "updated": updated_count,
        "embedded": embedded_count,
        "remote_total": remote_total,
    }


def sync_mailbox_messages(session: Session, mailbox: Mailbox, limit: int = SYNC_FETCH_LIMIT) -> dict:
    if not mailbox.sync_enabled:
        raise HTTPException(status_code=409, detail="A sincronização da mailbox está desativada")
    if not mailbox.imap_password_encrypted:
        raise HTTPException(status_code=422, detail="A palavra-passe da mailbox não está guardada")
    if not mailbox.imap_host or not mailbox.imap_port or not mailbox.imap_username:
        raise HTTPException(status_code=422, detail="É necessário configurar primeiro o host, a porta e o utilizador IMAP da mailbox")

    password = decrypt_secret(mailbox.imap_password_encrypted)

    def connect(selected_folder: str) -> imaplib.IMAP4 | imaplib.IMAP4_SSL:
        client, _ = open_imap_connection(
            host=mailbox.imap_host,
            port=int(mailbox.imap_port),
            username=mailbox.imap_username,
            password=password,
            security_mode=mailbox.security_mode or "ssl_tls",
            validate_certificates=bool(mailbox.validate_certificates),
            folder=selected_folder,
            readonly=True,
        )
        return client

    client: imaplib.IMAP4 | imaplib.IMAP4_SSL | None = connect(mailbox.folder or "INBOX")

    try:
        folders = list_client_folders(client, mailbox.folder or "INBOX")
        folder_results: list[dict] = []
        folder_failures: list[dict] = []

        for folder in folders:
            disconnected_retry = False
            while True:
                try:
                    if client is None:
                        client = connect(folder)
                    folder_results.append(sync_selected_folder(session, client, mailbox, folder, limit))
                    break
                except Exception as exc:
                    disconnected = is_imap_disconnect_error(exc)
                    if disconnected:
                        close_imap_client(client)
                        client = None
                        if not disconnected_retry:
                            disconnected_retry = True
                            logger.warning(
                                "[email] IMAP connection dropped while syncing folder %s for mailbox %s, reconnecting once",
                                folder,
                                mailbox.id,
                            )
                            continue
                    logger.warning("[email] Failed to sync folder %s for mailbox %s: %s", folder, mailbox.id, exc)
                    folder_failures.append({"folder": folder, "error": str(exc)})
                    break

        if not folder_results:
            failure_message = "; ".join(f"{entry['folder']}: {entry['error']}" for entry in folder_failures) or "Não foi possível sincronizar nenhuma pasta"
            raise RuntimeError(failure_message)

        synced_count = sum(int(item.get("fetched", 0)) for item in folder_results)
        new_count = sum(int(item.get("created", 0)) for item in folder_results)
        updated_count = sum(int(item.get("updated", 0)) for item in folder_results)
        remote_total = sum(int(item.get("remote_total", 0)) for item in folder_results)

        mailbox.status = "connected"
        mailbox.last_error = "; ".join(f"{entry['folder']}: {entry['error']}" for entry in folder_failures) if folder_failures else None
        mailbox.last_synced_at = utc_now()
        mailbox.updated_at = utc_now()
        session.add(mailbox)
        session.commit()

        stored_count = (
            session.scalar(
                select(func.count()).select_from(EmailMessage).where(
                    EmailMessage.tenant_id == mailbox.tenant_id,
                    EmailMessage.mailbox_id == mailbox.id,
                    EmailMessage.remote_deleted.is_(False),
                )
            )
            or 0
        )
        unread_count = (
            session.scalar(
                select(func.count()).select_from(EmailMessage).where(
                    EmailMessage.tenant_id == mailbox.tenant_id,
                    EmailMessage.mailbox_id == mailbox.id,
                    EmailMessage.remote_deleted.is_(False),
                    EmailMessage.is_seen.is_(False),
                )
            )
            or 0
        )

        return {
            "mailbox_id": mailbox.id,
            "mailbox_name": mailbox.name,
            "folder": mailbox.folder,
            "folders": [item.get("folder") for item in folder_results],
            "folders_synced": len(folder_results),
            "folder_results": folder_results,
            "folder_failures": folder_failures,
            "fetched": synced_count,
            "created": new_count,
            "updated": updated_count,
            "remote_total": remote_total,
            "stored": stored_count,
            "unread": unread_count,
        }
    except HTTPException:
        raise
    except Exception as exc:
        mailbox.status = "error"
        mailbox.last_error = str(exc)
        mailbox.updated_at = utc_now()
        session.add(mailbox)
        session.commit()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        close_imap_client(client)


def queue_mailbox_sync(tenant_id: str, mailbox_id: str, limit: int) -> None:
    with get_db_session() as session:
        mailbox = session.scalar(select(Mailbox).where(Mailbox.tenant_id == tenant_id, Mailbox.id == mailbox_id))
        if mailbox is None:
            logger.warning("[email] Skipping queued sync for missing mailbox %s tenant %s", mailbox_id, tenant_id)
            return
        try:
            result = sync_mailbox_messages(session, mailbox, limit=limit)
            logger.info(
                "[email] queued sync complete mailbox=%s tenant=%s fetched=%s created=%s updated=%s folders=%s",
                mailbox_id,
                tenant_id,
                result.get("fetched", 0),
                result.get("created", 0),
                result.get("updated", 0),
                result.get("folders_synced", 0),
            )
        except Exception as exc:
            logger.exception("[email] queued sync failed mailbox=%s tenant=%s: %s", mailbox_id, tenant_id, exc)


def apply_email_action(
    session: Session,
    mailbox: Mailbox,
    item: EmailMessage,
    action: EmailAction,
    target_folder: str | None = None,
) -> dict:
    if mailbox.access_mode != "read_write":
        raise HTTPException(status_code=409, detail="A mailbox está configurada em modo só de leitura")
    if item.remote_deleted:
        raise HTTPException(status_code=409, detail="O email já foi apagado da mailbox remota")
    if not mailbox.imap_password_encrypted:
        raise HTTPException(status_code=422, detail="A palavra-passe da mailbox não está guardada")
    if not mailbox.imap_host or not mailbox.imap_port or not mailbox.imap_username:
        raise HTTPException(status_code=422, detail="É necessário configurar primeiro o host, a porta e o utilizador IMAP da mailbox")

    password = decrypt_secret(mailbox.imap_password_encrypted)
    client, _ = open_imap_connection(
        host=mailbox.imap_host,
        port=int(mailbox.imap_port),
        username=mailbox.imap_username,
        password=password,
        security_mode=mailbox.security_mode or "ssl_tls",
        validate_certificates=bool(mailbox.validate_certificates),
        folder=item.folder or mailbox.folder or "INBOX",
        readonly=False,
    )

    try:
        if action == "mark_read":
            status, data = client.uid("store", item.imap_uid, "+FLAGS", "(\\Seen)")
            if status != "OK":
                raise RuntimeError(f"Não foi possível marcar o email como lido: {data}")
            item.is_seen = True
        elif action == "mark_unread":
            status, data = client.uid("store", item.imap_uid, "-FLAGS", "(\\Seen)")
            if status != "OK":
                raise RuntimeError(f"Não foi possível marcar o email como por ler: {data}")
            item.is_seen = False
        elif action == "delete":
            status, data = client.uid("store", item.imap_uid, "+FLAGS", "(\\Deleted)")
            if status != "OK":
                raise RuntimeError(f"Não foi possível apagar o email: {data}")
            expunge_status, expunge_data = client.expunge()
            if expunge_status != "OK":
                raise RuntimeError(f"Falha ao executar expunge na mailbox: {expunge_data}")
            item.remote_deleted = True
        elif action == "move":
            if not target_folder:
                raise HTTPException(status_code=422, detail="target_folder é obrigatório para mover um email")
            if target_folder == item.folder:
                raise HTTPException(status_code=409, detail="O email já se encontra nessa pasta")
            copy_status, copy_data = client.uid("COPY", item.imap_uid, f'"{target_folder}"')
            if copy_status != "OK":
                raise RuntimeError(f"Não foi possível mover o email para a pasta '{target_folder}': {copy_data}")
            store_status, store_data = client.uid("store", item.imap_uid, "+FLAGS", "(\\Deleted)")
            if store_status != "OK":
                raise RuntimeError(f"Não foi possível concluir a mudança do email: {store_data}")
            expunge_status, expunge_data = client.expunge()
            if expunge_status != "OK":
                raise RuntimeError(f"Falha ao executar expunge na mailbox: {expunge_data}")
            item.folder = target_folder
            item.is_seen = True
        elif action == "flag":
            status, data = client.uid("store", item.imap_uid, "+FLAGS", "(\\Flagged)")
            if status != "OK":
                raise RuntimeError(f"Não foi possível marcar o email como importante: {data}")
            item.is_flagged = True
        elif action == "unflag":
            status, data = client.uid("store", item.imap_uid, "-FLAGS", "(\\Flagged)")
            if status != "OK":
                raise RuntimeError(f"Não foi possível remover a marcação de importante: {data}")
            item.is_flagged = False
        else:
            raise HTTPException(status_code=422, detail="Ação de email não suportada")

        item.last_synced_at = utc_now()
        item.updated_at = utc_now()
        mailbox.status = "connected"
        mailbox.last_error = None
        mailbox.updated_at = utc_now()
        session.add(item)
        session.add(mailbox)
        session.commit()
        session.refresh(item)

        return {
            "message": {
                "mark_read": "Email marcado como lido",
                "mark_unread": "Email marcado como por ler",
                "delete": "Email apagado da mailbox",
                "move": f"Email movido para {target_folder}",
                "flag": "Email marcado como importante",
                "unflag": "Marcação de importante removida",
            }[action]
        }
    except HTTPException:
        raise
    except Exception as exc:
        mailbox.status = "error"
        mailbox.last_error = str(exc)
        mailbox.updated_at = utc_now()
        session.add(mailbox)
        session.commit()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    finally:
        try:
            client.logout()
        except Exception:
            pass


def get_mailbox_message_counts(session: Session, tenant_id: str) -> dict[str, dict[str, int]]:
    counts: dict[str, dict[str, int]] = {}

    stored_rows = session.execute(
        select(EmailMessage.mailbox_id, func.count())
        .where(EmailMessage.tenant_id == tenant_id, EmailMessage.remote_deleted.is_(False))
        .group_by(EmailMessage.mailbox_id)
    ).all()
    unread_rows = session.execute(
        select(EmailMessage.mailbox_id, func.count())
        .where(
            EmailMessage.tenant_id == tenant_id,
            EmailMessage.remote_deleted.is_(False),
            EmailMessage.is_seen.is_(False),
        )
        .group_by(EmailMessage.mailbox_id)
    ).all()
    flagged_rows = session.execute(
        select(EmailMessage.mailbox_id, func.count())
        .where(
            EmailMessage.tenant_id == tenant_id,
            EmailMessage.remote_deleted.is_(False),
            EmailMessage.is_flagged.is_(True),
        )
        .group_by(EmailMessage.mailbox_id)
    ).all()

    for mailbox_id, total in stored_rows:
        counts.setdefault(str(mailbox_id), {})["stored_count"] = int(total or 0)
    for mailbox_id, total in unread_rows:
        counts.setdefault(str(mailbox_id), {})["unread_count"] = int(total or 0)
    for mailbox_id, total in flagged_rows:
        counts.setdefault(str(mailbox_id), {})["flagged_count"] = int(total or 0)

    return counts


def serialize_mailbox(item: Mailbox, stats: Optional[dict[str, int]] = None) -> dict:
    counts = stats or {}
    return {
        "id": item.id,
        "tenant_id": item.tenant_id,
        "name": item.name,
        "email_address": item.email_address,
        "provider": item.provider,
        "status": item.status,
        "sync_enabled": bool(item.sync_enabled),
        "imap_host": item.imap_host,
        "imap_port": item.imap_port,
        "security_mode": item.security_mode,
        "access_mode": item.access_mode,
        "folder": item.folder,
        "validate_certificates": bool(item.validate_certificates),
        "stored_count": int(counts.get("stored_count", 0)),
        "unread_count": int(counts.get("unread_count", 0)),
        "flagged_count": int(counts.get("flagged_count", 0)),
        "last_error": item.last_error,
        "last_connection_test_at": item.last_connection_test_at.isoformat() if item.last_connection_test_at else None,
        "last_synced_at": item.last_synced_at.isoformat() if item.last_synced_at else None,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


def serialize_admin_mailbox(item: Mailbox, stats: Optional[dict[str, int]] = None) -> dict:
    payload = serialize_mailbox(item, stats)
    payload.update(
        {
            "imap_username": item.imap_username,
            "auth_method": item.auth_method,
            "has_password": bool(item.imap_password_encrypted),
        }
    )
    return payload


def serialize_email_message(item: EmailMessage) -> dict:
    return {
        "id": item.id,
        "tenant_id": item.tenant_id,
        "mailbox_id": item.mailbox_id,
        "imap_uid": item.imap_uid,
        "folder": item.folder,
        "message_id_header": item.message_id_header,
        "subject": item.subject,
        "from_name": item.from_name,
        "from_address": item.from_address,
        "to_addresses": item.to_addresses,
        "snippet": item.snippet,
        "body_text": item.body_text,
        "body_html": item.body_html,
        "received_at": item.received_at.isoformat() if item.received_at else None,
        "is_seen": bool(item.is_seen),
        "is_flagged": bool(item.is_flagged),
        "has_attachments": bool(item.has_attachments),
        "remote_deleted": bool(item.remote_deleted),
        "last_synced_at": item.last_synced_at.isoformat() if item.last_synced_at else None,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


def serialize_campaign(item: EmailCampaign) -> dict:
    return {
        "id": item.id,
        "tenant_id": item.tenant_id,
        "name": item.name,
        "subject": item.subject,
        "audience": item.audience,
        "status": item.status,
        "scheduled_at": item.scheduled_at.isoformat() if item.scheduled_at else None,
        "sent_count": item.sent_count,
        "opened_count": item.opened_count,
        "clicked_count": item.clicked_count,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


def serialize_automation(item: AutomationRule) -> dict:
    return {
        "id": item.id,
        "tenant_id": item.tenant_id,
        "name": item.name,
        "trigger": item.trigger,
        "action": item.action,
        "status": item.status,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


def seed_tenant_workspace(session: Session, tenant_id: str) -> None:
    return None


def apply_mailbox_admin_payload(mailbox: Mailbox, payload: MailboxAdminUpsert, password_to_store: Optional[str]) -> None:
    mailbox.name = payload.name
    mailbox.email_address = payload.email_address
    mailbox.provider = "imap"
    mailbox.imap_host = payload.imap_host
    mailbox.imap_port = payload.imap_port
    mailbox.imap_username = payload.imap_username
    mailbox.security_mode = payload.security_mode
    mailbox.access_mode = payload.access_mode
    mailbox.folder = payload.folder
    mailbox.validate_certificates = payload.validate_certificates
    mailbox.sync_enabled = payload.sync_enabled
    mailbox.auth_method = payload.auth_method
    mailbox.status = "configured" if payload.sync_enabled else "paused"
    mailbox.last_error = None
    if password_to_store:
        mailbox.imap_password_encrypted = encrypt_secret(password_to_store)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("[email] Starting on port %s", PORT)
    if _engine is not None:
        ensure_db_extensions()
        Base.metadata.create_all(bind=_engine)
        ensure_schema()
    yield
    logger.info("[email] Shutting down")


app = FastAPI(
    title="Via Oceânica — Módulo Email",
    description="Email operations module scaffold",
    version="1.2.1",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def extract_platform_headers(request: Request, call_next):
    if request.url.path in PUBLIC_PATHS:
        return await call_next(request)

    user_id = request.headers.get("x-viao-user-id", "") or "0"
    tenant_id = request.headers.get("x-viao-tenant-id", "") or request.headers.get("x-tenant-id", "")
    session_id = request.headers.get("x-viao-session-id", "")
    platform_roles = request.headers.get("x-viao-platform-roles", "")
    company_role = request.headers.get("x-viao-company-role", "")
    module_entitlements = request.headers.get("x-viao-module-entitlements", "")
    request_id = request.headers.get("x-viao-request-id", "") or "unknown"

    if not tenant_id:
        if ALLOW_DEMO_TENANT:
            tenant_id = DEFAULT_TENANT
        else:
            return JSONResponse(
                status_code=401,
                content={"success": False, "error": {"code": "MISSING_TENANT", "message": "Contexto da empresa em falta"}},
            )

    ctx = ModuleContext(
        user_id=user_id,
        tenant_id=tenant_id,
        session_id=session_id or f"{tenant_id}-{user_id}",
        platform_roles=platform_roles,
        company_role=company_role,
        module_entitlements=module_entitlements,
        request_id=request_id,
    )
    request.state.tenant_id = ctx.tenant_id
    request.state.user_id = ctx.user_id
    request.state.session_id = ctx.session_id
    request.state.platform_roles = ctx.platform_roles
    request.state.company_role = ctx.company_role
    request.state.module_entitlements = ctx.module_entitlements

    token = _current_context.set(ctx)
    try:
        return await call_next(request)
    finally:
        _current_context.reset(token)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "mod-email",
        "version": "1.2.1",
        "uptime_seconds": int(time.time() - _start_time),
    }


@app.get("/ready")
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


@app.get("/api/v1/status")
async def status(request: Request):
    company_role = request.state.company_role or "member"
    platform_roles = list(parse_platform_roles(request.state.platform_roles))
    return {
        "success": True,
        "data": {
            "module": "email",
            "tenant_id": request.state.tenant_id,
            "user_id": request.state.user_id,
            "company_role": company_role,
            "platform_roles": platform_roles,
            "can_manage_mailboxes": company_role in {"owner", "admin"} or "admin" in platform_roles,
            "message": "Módulo Email operacional",
        },
    }


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
            "module": "email",
            "company_role": request.state.company_role,
        },
    )
    return {"success": True, "data": response}


@app.post("/api/v1/assistant/context")
async def assistant_context(request: Request, payload: AssistantContextRequest):
    with get_db_session() as session:
        return {
            "success": True,
            "data": build_email_assistant_context(
                session,
                request.state.tenant_id,
                payload.question,
                payload.limit,
                payload.selected_email_id,
                payload.selected_email_ids,
            ),
        }


@app.post("/api/v1/emails/search")
async def search_emails(request: Request, payload: EmailSearchRequest):
    with get_db_session() as session:
        return {
            "success": True,
            "data": search_email_messages(
                session,
                request.state.tenant_id,
                payload.query,
                payload.limit,
                payload.mailbox_id,
                payload.folder,
                payload.include_children,
            ),
        }


@app.post("/api/v1/assistant/action-preview")
async def assistant_action_preview(request: Request, payload: AssistantActionPreviewRequest):
    with get_db_session() as session:
        return {
            "success": True,
            "data": build_email_action_preview(
                session,
                request.state.tenant_id,
                payload.message,
                payload.limit,
                payload.selected_email_id,
                payload.selected_email_ids,
            ),
        }


@app.post("/api/v1/assistant/action-execute")
async def assistant_action_execute(request: Request, payload: AssistantActionExecuteRequest):
    with get_db_session() as session:
        return {
            "success": True,
            "data": execute_email_assistant_action(
                session,
                request.state.tenant_id,
                payload.action,
                payload.email_ids,
                payload.target_folder,
            ),
        }


@app.get("/api/v1/dashboard")
async def dashboard(request: Request):
    with get_db_session() as session:
        seed_tenant_workspace(session, request.state.tenant_id)
        mailboxes = session.scalars(
            select(Mailbox).where(Mailbox.tenant_id == request.state.tenant_id).order_by(Mailbox.updated_at.desc())
        ).all()
        campaigns = session.scalars(
            select(EmailCampaign).where(EmailCampaign.tenant_id == request.state.tenant_id).order_by(EmailCampaign.updated_at.desc())
        ).all()
        automations = session.scalars(
            select(AutomationRule).where(AutomationRule.tenant_id == request.state.tenant_id).order_by(AutomationRule.updated_at.desc())
        ).all()
        latest_emails = session.scalars(
            select(EmailMessage)
            .where(EmailMessage.tenant_id == request.state.tenant_id, EmailMessage.remote_deleted.is_(False))
            .order_by(EmailMessage.received_at.desc(), EmailMessage.updated_at.desc())
            .limit(15)
        ).all()
        mailbox_counts = get_mailbox_message_counts(session, request.state.tenant_id)

        stored_emails = (
            session.scalar(
                select(func.count()).select_from(EmailMessage).where(
                    EmailMessage.tenant_id == request.state.tenant_id,
                    EmailMessage.remote_deleted.is_(False),
                )
            )
            or 0
        )
        unread_emails = (
            session.scalar(
                select(func.count()).select_from(EmailMessage).where(
                    EmailMessage.tenant_id == request.state.tenant_id,
                    EmailMessage.remote_deleted.is_(False),
                    EmailMessage.is_seen.is_(False),
                )
            )
            or 0
        )

        summary = {
            "connected_mailboxes": sum(1 for item in mailboxes if item.status == "connected"),
            "configured_mailboxes": sum(1 for item in mailboxes if item.status in {"configured", "connected"}),
            "active_automations": sum(1 for item in automations if item.status == "active"),
            "draft_campaigns": sum(1 for item in campaigns if item.status == "draft"),
            "scheduled_campaigns": sum(1 for item in campaigns if item.status == "scheduled"),
            "total_sent": sum(item.sent_count for item in campaigns),
            "stored_emails": stored_emails,
            "unread_emails": unread_emails,
        }
        return {
            "success": True,
            "data": {
                "summary": summary,
                "mailboxes": [serialize_mailbox(item, mailbox_counts.get(item.id)) for item in mailboxes],
                "campaigns": [serialize_campaign(item) for item in campaigns],
                "automations": [serialize_automation(item) for item in automations],
                "latest_emails": [serialize_email_message(item) for item in latest_emails],
            },
        }


@app.get("/api/v1/mailboxes")
async def list_mailboxes(request: Request):
    with get_db_session() as session:
        items = session.scalars(
            select(Mailbox).where(Mailbox.tenant_id == request.state.tenant_id).order_by(Mailbox.updated_at.desc())
        ).all()
        mailbox_counts = get_mailbox_message_counts(session, request.state.tenant_id)
        return {"success": True, "data": [serialize_mailbox(item, mailbox_counts.get(item.id)) for item in items]}


@app.post("/api/v1/mailboxes")
async def create_mailbox(request: Request, payload: MailboxCreate):
    with get_db_session() as session:
        item = Mailbox(
            id=str(uuid4()),
            tenant_id=request.state.tenant_id,
            name=payload.name.strip(),
            email_address=payload.email_address.strip().lower(),
            provider=payload.provider.strip().lower(),
            sync_enabled=payload.sync_enabled,
            status="configured" if payload.sync_enabled else "paused",
            access_mode="read_write",
            security_mode="ssl_tls",
            auth_method="password",
            folder="INBOX",
            validate_certificates=True,
        )
        session.add(item)
        session.commit()
        session.refresh(item)
        return {"success": True, "data": serialize_mailbox(item)}


@app.post("/api/v1/mailboxes/{mailbox_id}/sync")
async def sync_mailbox(
    mailbox_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    limit: int | None = Query(default=None, ge=1, le=100),
):
    effective_limit = max(1, min(limit or MANUAL_SYNC_FETCH_LIMIT, SYNC_FETCH_LIMIT))
    with get_db_session() as session:
        item = get_mailbox_or_404(session, request.state.tenant_id, mailbox_id)
        if item.status == "syncing":
            return {
                "success": True,
                "data": {
                    "mailbox": serialize_mailbox(item),
                    "queued": True,
                    "limit": effective_limit,
                    "message": "A mailbox já está a sincronizar.",
                },
            }

        item.status = "syncing"
        item.last_error = None
        item.updated_at = utc_now()
        session.add(item)
        session.commit()
        session.refresh(item)

        background_tasks.add_task(queue_mailbox_sync, request.state.tenant_id, mailbox_id, effective_limit)
        return {
            "success": True,
            "data": {
                "mailbox": serialize_mailbox(item),
                "queued": True,
                "limit": effective_limit,
                "message": "Sincronização iniciada. Os resultados vão aparecer assim que a mailbox terminar o processamento.",
            },
        }


@app.get("/api/v1/mailboxes/{mailbox_id}/folders")
async def list_mailbox_folder_options(mailbox_id: str, request: Request):
    with get_db_session() as session:
        item = get_mailbox_or_404(session, request.state.tenant_id, mailbox_id)
        folders = list_mailbox_folders(item)
        folder_stats = get_mailbox_folder_stats(session, item, folders)
        return {
            "success": True,
            "data": {
                "mailbox_id": mailbox_id,
                "current_folder": item.folder or "INBOX",
                "folders": folders,
                "folder_stats": folder_stats,
            },
        }


@app.get("/api/v1/emails")
async def list_emails(
    request: Request,
    mailbox_id: Optional[str] = None,
    folder: Optional[str] = None,
    include_children: bool = False,
    limit: int = Query(default=100, ge=1, le=250),
):
    with get_db_session() as session:
        query = select(EmailMessage).where(
            EmailMessage.tenant_id == request.state.tenant_id,
            EmailMessage.remote_deleted.is_(False),
        )
        if mailbox_id:
            query = query.where(EmailMessage.mailbox_id == mailbox_id)
        if folder:
            effective_include_children = include_children and should_include_child_folders(folder)
            if effective_include_children:
                query = query.where(
                    or_(
                        EmailMessage.folder == folder,
                        EmailMessage.folder.startswith(f"{folder}."),
                        EmailMessage.folder.startswith(f"{folder}/"),
                    )
                )
            else:
                query = query.where(EmailMessage.folder == folder)

        items = session.scalars(query.order_by(EmailMessage.received_at.desc(), EmailMessage.updated_at.desc()).limit(limit)).all()
        return {"success": True, "data": [serialize_email_message(item) for item in items]}


@app.post("/api/v1/emails/{email_id}/actions")
async def email_action(email_id: str, request: Request, payload: EmailActionRequest):
    with get_db_session() as session:
        item = get_email_or_404(session, request.state.tenant_id, email_id)
        mailbox = get_mailbox_or_404(session, request.state.tenant_id, item.mailbox_id)
        result = apply_email_action(session, mailbox, item, payload.action, payload.target_folder)
        session.refresh(item)
        return {"success": True, "data": {"email": serialize_email_message(item), **result}}


@app.get("/api/v1/admin/mailboxes")
async def list_admin_mailboxes(request: Request):
    require_admin_access(request)
    with get_db_session() as session:
        items = session.scalars(
            select(Mailbox).where(Mailbox.tenant_id == request.state.tenant_id).order_by(Mailbox.updated_at.desc())
        ).all()
        return {"success": True, "data": [serialize_admin_mailbox(item) for item in items]}


@app.post("/api/v1/admin/mailboxes")
async def create_admin_mailbox(request: Request, payload: MailboxAdminUpsert):
    require_admin_access(request)
    if not payload.imap_password:
        raise HTTPException(status_code=422, detail="A palavra-passe da mailbox é obrigatória ao criar uma mailbox IMAP")

    with get_db_session() as session:
        item = Mailbox(
            id=str(uuid4()),
            tenant_id=request.state.tenant_id,
            name=payload.name,
            email_address=payload.email_address,
            provider="imap",
            status="configured",
            sync_enabled=payload.sync_enabled,
            security_mode=payload.security_mode,
            access_mode=payload.access_mode,
            auth_method=payload.auth_method,
            folder=payload.folder,
            validate_certificates=payload.validate_certificates,
        )
        apply_mailbox_admin_payload(item, payload, payload.imap_password)
        session.add(item)
        session.commit()
        session.refresh(item)
        return {"success": True, "data": serialize_admin_mailbox(item)}


@app.put("/api/v1/admin/mailboxes/{mailbox_id}")
async def update_admin_mailbox(mailbox_id: str, request: Request, payload: MailboxAdminUpsert):
    require_admin_access(request)

    with get_db_session() as session:
        item = get_mailbox_or_404(session, request.state.tenant_id, mailbox_id)
        password_to_store = payload.imap_password.strip() if payload.imap_password else None
        if not password_to_store and not item.imap_password_encrypted:
            raise HTTPException(status_code=422, detail="A palavra-passe da mailbox é obrigatória até existir uma guardada")

        apply_mailbox_admin_payload(item, payload, password_to_store)
        item.updated_at = utc_now()
        session.add(item)
        session.commit()
        session.refresh(item)
        return {"success": True, "data": serialize_admin_mailbox(item)}


@app.delete("/api/v1/admin/mailboxes/{mailbox_id}")
async def delete_admin_mailbox(mailbox_id: str, request: Request):
    require_admin_access(request)

    with get_db_session() as session:
        item = get_mailbox_or_404(session, request.state.tenant_id, mailbox_id)
        session.execute(
            sql_delete(EmailMessage).where(
                EmailMessage.tenant_id == request.state.tenant_id,
                EmailMessage.mailbox_id == mailbox_id,
            )
        )
        session.delete(item)
        session.commit()
        return {"success": True, "data": {"id": mailbox_id}}


@app.post("/api/v1/admin/mailboxes/{mailbox_id}/test-connection")
async def test_admin_mailbox_connection(mailbox_id: str, request: Request, payload: MailboxConnectionTestRequest | None = None):
    require_admin_access(request)

    with get_db_session() as session:
        item = get_mailbox_or_404(session, request.state.tenant_id, mailbox_id)
        password = payload.imap_password.strip() if payload and payload.imap_password else None
        if not password:
            if not item.imap_password_encrypted:
                raise HTTPException(status_code=422, detail="A palavra-passe da mailbox é obrigatória para testar a ligação IMAP")
            password = decrypt_secret(item.imap_password_encrypted)

        if not item.imap_host or not item.imap_port or not item.imap_username:
            raise HTTPException(status_code=422, detail="É necessário configurar primeiro o host, a porta e o utilizador IMAP da mailbox")

        try:
            result = test_imap_connection(
                host=item.imap_host,
                port=int(item.imap_port),
                username=item.imap_username,
                password=password,
                security_mode=item.security_mode or "ssl_tls",
                validate_certificates=bool(item.validate_certificates),
                folder=item.folder or "INBOX",
            )
            item.status = "connected" if item.sync_enabled else "paused"
            item.last_error = None
            item.last_connection_test_at = utc_now()
            session.add(item)
            session.commit()
            session.refresh(item)
            return {"success": True, "data": {**serialize_admin_mailbox(item), "test_result": result}}
        except Exception as exc:
            logger.warning("[email] IMAP test failed for mailbox %s: %s", mailbox_id, exc)
            item.status = "error"
            item.last_error = str(exc)
            item.last_connection_test_at = utc_now()
            session.add(item)
            session.commit()
            session.refresh(item)
            raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/api/v1/campaigns")
async def list_campaigns(request: Request):
    with get_db_session() as session:
        seed_tenant_workspace(session, request.state.tenant_id)
        items = session.scalars(
            select(EmailCampaign).where(EmailCampaign.tenant_id == request.state.tenant_id).order_by(EmailCampaign.updated_at.desc())
        ).all()
        return {"success": True, "data": [serialize_campaign(item) for item in items]}


@app.post("/api/v1/campaigns")
async def create_campaign(request: Request, payload: CampaignCreate):
    with get_db_session() as session:
        item = EmailCampaign(
            id=str(uuid4()),
            tenant_id=request.state.tenant_id,
            name=payload.name.strip(),
            subject=payload.subject.strip(),
            audience=payload.audience.strip(),
            status=payload.status,
            scheduled_at=payload.scheduled_at,
            sent_count=0,
            opened_count=0,
            clicked_count=0,
        )
        session.add(item)
        session.commit()
        session.refresh(item)
        return {"success": True, "data": serialize_campaign(item)}


@app.get("/api/v1/automations")
async def list_automations(request: Request):
    with get_db_session() as session:
        seed_tenant_workspace(session, request.state.tenant_id)
        items = session.scalars(
            select(AutomationRule).where(AutomationRule.tenant_id == request.state.tenant_id).order_by(AutomationRule.updated_at.desc())
        ).all()
        return {"success": True, "data": [serialize_automation(item) for item in items]}


@app.post("/api/v1/automations")
async def create_automation(request: Request, payload: AutomationCreate):
    with get_db_session() as session:
        item = AutomationRule(
            id=str(uuid4()),
            tenant_id=request.state.tenant_id,
            name=payload.name.strip(),
            trigger=payload.trigger.strip(),
            action=payload.action.strip(),
            status=payload.status,
        )
        session.add(item)
        session.commit()
        session.refresh(item)
        return {"success": True, "data": serialize_automation(item)}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
