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
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses, parsedate_to_datetime
from typing import Literal, Optional
from uuid import uuid4

from cryptography.fernet import Fernet, InvalidToken
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import Boolean, DateTime, Integer, String, Text, create_engine, delete as sql_delete, func, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker

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
_start_time = time.time()

MailboxSecurityMode = Literal["ssl_tls", "starttls", "none"]
MailboxAccessMode = Literal["read_only", "read_write"]
CampaignStatus = Literal["draft", "scheduled", "sending", "sent"]
AutomationStatus = Literal["active", "paused"]
EmailAction = Literal["mark_read", "mark_unread", "delete", "move"]


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
        try:
            client.logout()
        except Exception:
            pass


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
        status, data = client.list()
        if status != "OK":
            raise RuntimeError(f"Falha ao listar as pastas da mailbox: {data}")

        folders: list[str] = []
        for entry in data or []:
            if not entry:
                continue
            folder = decode_imap_folder_name(entry)
            if folder and folder not in folders:
                folders.append(folder)

        configured_folder = mailbox.folder or "INBOX"
        if configured_folder not in folders:
            folders.insert(0, configured_folder)

        return sorted(folders, key=lambda item: (item != configured_folder, item.lower()))
    finally:
        try:
            client.logout()
        except Exception:
            pass


def sync_mailbox_messages(session: Session, mailbox: Mailbox, limit: int = SYNC_FETCH_LIMIT) -> dict:
    if not mailbox.sync_enabled:
        raise HTTPException(status_code=409, detail="A sincronização da mailbox está desativada")
    if not mailbox.imap_password_encrypted:
        raise HTTPException(status_code=422, detail="A palavra-passe da mailbox não está guardada")
    if not mailbox.imap_host or not mailbox.imap_port or not mailbox.imap_username:
        raise HTTPException(status_code=422, detail="É necessário configurar primeiro o host, a porta e o utilizador IMAP da mailbox")

    password = decrypt_secret(mailbox.imap_password_encrypted)
    client, remote_total = open_imap_connection(
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
        search_status, search_data = client.uid("search", None, "ALL")
        if search_status != "OK":
            raise RuntimeError(f"Falha na pesquisa IMAP da mailbox: {search_data}")

        all_uids = []
        if search_data and search_data[0]:
            all_uids = [uid for uid in search_data[0].decode("utf-8", errors="ignore").split() if uid]
        selected_uids = all_uids[-max(1, min(limit, 100)):]

        existing = []
        if selected_uids:
            existing = session.scalars(
                select(EmailMessage).where(
                    EmailMessage.tenant_id == mailbox.tenant_id,
                    EmailMessage.mailbox_id == mailbox.id,
                    EmailMessage.imap_uid.in_(selected_uids),
                )
            ).all()
        existing_by_uid = {item.imap_uid: item for item in existing}

        synced_count = 0
        new_count = 0
        updated_count = 0

        for uid in reversed(selected_uids):
            fetch_status, fetch_data = client.uid("fetch", uid, "(UID FLAGS BODY.PEEK[])")
            if fetch_status != "OK":
                logger.warning("[email] Failed to fetch UID %s for mailbox %s: %s", uid, mailbox.id, fetch_data)
                continue

            meta, raw_bytes = parse_fetch_payload(fetch_data)
            flags = parse_imap_flags(meta)
            payload = parse_email_payload(raw_bytes)

            item = existing_by_uid.get(uid)
            if item is None:
                item = EmailMessage(
                    id=str(uuid4()),
                    tenant_id=mailbox.tenant_id,
                    mailbox_id=mailbox.id,
                    imap_uid=uid,
                    folder=mailbox.folder or "INBOX",
                )
                session.add(item)
                new_count += 1
            else:
                updated_count += 1

            item.folder = mailbox.folder or "INBOX"
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

        mailbox.status = "connected"
        mailbox.last_error = None
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
        try:
            client.logout()
        except Exception:
            pass


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


def serialize_mailbox(item: Mailbox) -> dict:
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
        "last_error": item.last_error,
        "last_connection_test_at": item.last_connection_test_at.isoformat() if item.last_connection_test_at else None,
        "last_synced_at": item.last_synced_at.isoformat() if item.last_synced_at else None,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "updated_at": item.updated_at.isoformat() if item.updated_at else None,
    }


def serialize_admin_mailbox(item: Mailbox) -> dict:
    payload = serialize_mailbox(item)
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
                "mailboxes": [serialize_mailbox(item) for item in mailboxes],
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
        return {"success": True, "data": [serialize_mailbox(item) for item in items]}


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
async def sync_mailbox(mailbox_id: str, request: Request):
    with get_db_session() as session:
        item = get_mailbox_or_404(session, request.state.tenant_id, mailbox_id)
        result = sync_mailbox_messages(session, item)
        session.refresh(item)
        return {"success": True, "data": {"mailbox": serialize_mailbox(item), "sync_result": result}}


@app.get("/api/v1/mailboxes/{mailbox_id}/folders")
async def list_mailbox_folder_options(mailbox_id: str, request: Request):
    with get_db_session() as session:
        item = get_mailbox_or_404(session, request.state.tenant_id, mailbox_id)
        folders = list_mailbox_folders(item)
        return {
            "success": True,
            "data": {
                "mailbox_id": mailbox_id,
                "current_folder": item.folder or "INBOX",
                "folders": folders,
            },
        }


@app.get("/api/v1/emails")
async def list_emails(
    request: Request,
    mailbox_id: Optional[str] = None,
    limit: int = Query(default=50, ge=1, le=100),
):
    with get_db_session() as session:
        query = select(EmailMessage).where(
            EmailMessage.tenant_id == request.state.tenant_id,
            EmailMessage.remote_deleted.is_(False),
        )
        if mailbox_id:
            query = query.where(EmailMessage.mailbox_id == mailbox_id)

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
