from __future__ import annotations

import base64
import csv
import hashlib
import hmac
import json
import time
import io
import os
import re
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any, Literal, Optional
from uuid import uuid4

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String, Text, create_engine, select, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker
from sqlalchemy.pool import StaticPool

MODULE_KEY = "social-media"
MODULE_VERSION = "1.0.0"
PORT = int(os.getenv("MOD_SOCIAL_MEDIA_PORT", "4005"))
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+pysqlite:///./social_media.db")
AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://ai-service:4010").rstrip("/")
AI_AGENT_ID = os.getenv("AI_AGENT_ID", MODULE_KEY)
AI_MODEL = os.getenv("AI_MODEL", os.getenv("SOCIAL_MEDIA_AI_MODEL", "gpt-4o-mini"))
AI_IMAGE_MODEL = os.getenv("AI_IMAGE_MODEL", os.getenv("SOCIAL_MEDIA_IMAGE_MODEL", "dall-e-3"))
AI_TIMEOUT_SECONDS = float(os.getenv("AI_TIMEOUT_SECONDS", "150"))
EXPORT_TOKEN_SECRET = os.getenv("EXPORT_TOKEN_SECRET", os.getenv("SECRET_KEY", "social-media-dev-secret"))
EXPORT_TOKEN_TTL_SECONDS = int(os.getenv("EXPORT_TOKEN_TTL_SECONDS", "900"))
ALLOW_DEMO_TENANT = os.getenv("ALLOW_DEMO_TENANT", "false").lower() in {"1", "true", "yes", "on"}
_start_time = time.time()

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine_kwargs = {"future": True, "pool_pre_ping": True, "connect_args": connect_args}
if DATABASE_URL == "sqlite+pysqlite:///:memory:":
    engine_kwargs["poolclass"] = StaticPool
engine = create_engine(DATABASE_URL, **engine_kwargs)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


class Brand(Base):
    __tablename__ = "social_brands"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    sector: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    audience: Mapped[str] = mapped_column(Text)
    products_services: Mapped[list[str]] = mapped_column(JSON, default=list)
    tone: Mapped[str] = mapped_column(String(255))
    preferred_words: Mapped[list[str]] = mapped_column(JSON, default=list)
    forbidden_words: Mapped[list[str]] = mapped_column(JSON, default=list)
    differentiators: Mapped[list[str]] = mapped_column(JSON, default=list)
    example_posts: Mapped[list[str]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class Campaign(Base):
    __tablename__ = "social_campaigns"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    brand_id: Mapped[str] = mapped_column(String(36), ForeignKey("social_brands.id"), index=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    goal: Mapped[str] = mapped_column(String(100), default="notoriedade")
    start_date: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    end_date: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    channels: Mapped[list[str]] = mapped_column(JSON, default=list)
    central_message: Mapped[str] = mapped_column(Text, default="")
    specific_audience: Mapped[str] = mapped_column(Text, default="")
    frequency: Mapped[str] = mapped_column(String(100), default="")
    brief: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(32), default="active", index=True)
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


PostStatus = Literal["draft", "in_review", "changes_requested", "approved", "ready_to_publish", "published_manually", "archived"]


class Post(Base):
    __tablename__ = "social_posts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    brand_id: Mapped[str] = mapped_column(String(36), ForeignKey("social_brands.id"), index=True)
    campaign_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("social_campaigns.id"), nullable=True, index=True)
    platform: Mapped[str] = mapped_column(String(64), index=True)
    format: Mapped[str] = mapped_column(String(64), default="feed")
    title: Mapped[str] = mapped_column(String(255), default="")
    hook: Mapped[str] = mapped_column(String(255), default="")
    body: Mapped[str] = mapped_column(Text)
    cta: Mapped[str] = mapped_column(String(500), default="")
    hashtags: Mapped[list[str]] = mapped_column(JSON, default=list)
    scheduled_at: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)
    asset_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    public_notes: Mapped[str] = mapped_column(Text, default="")
    internal_notes: Mapped[str] = mapped_column(Text, default="")
    quality_check: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    approved_by: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    published_manually_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, onupdate=utcnow)


class PostVersion(Base):
    __tablename__ = "social_post_versions"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    post_id: Mapped[str] = mapped_column(String(36), ForeignKey("social_posts.id"), index=True)
    version_number: Mapped[int] = mapped_column(Integer)
    body: Mapped[str] = mapped_column(Text)
    cta: Mapped[str] = mapped_column(String(500), default="")
    hashtags: Mapped[list[str]] = mapped_column(JSON, default=list)
    source: Mapped[str] = mapped_column(String(64), default="human")
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Approval(Base):
    __tablename__ = "social_approvals"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    post_id: Mapped[str] = mapped_column(String(36), ForeignKey("social_posts.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(64))
    decision: Mapped[str] = mapped_column(String(32))
    comment: Mapped[str] = mapped_column(Text, default="")
    previous_status: Mapped[str] = mapped_column(String(32))
    new_status: Mapped[str] = mapped_column(String(32))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Comment(Base):
    __tablename__ = "social_comments"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    post_id: Mapped[str] = mapped_column(String(36), ForeignKey("social_posts.id"), index=True)
    user_id: Mapped[str] = mapped_column(String(64))
    comment: Mapped[str] = mapped_column(Text)
    visibility: Mapped[str] = mapped_column(String(32), default="internal")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Idea(Base):
    __tablename__ = "social_ideas"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    brand_id: Mapped[str] = mapped_column(String(36), ForeignKey("social_brands.id"), index=True)
    campaign_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("social_campaigns.id"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(64), default="manual")
    status: Mapped[str] = mapped_column(String(32), default="new")
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class AiGeneration(Base):
    __tablename__ = "social_ai_generations"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    user_id: Mapped[str] = mapped_column(String(64), index=True)
    brand_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    campaign_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    post_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(64), index=True)
    prompt: Mapped[str] = mapped_column(Text)
    response: Mapped[str] = mapped_column(Text)
    model: Mapped[str] = mapped_column(String(128), default="")
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ManualMetric(Base):
    __tablename__ = "social_manual_metrics"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    tenant_id: Mapped[str] = mapped_column(String(64), index=True)
    post_id: Mapped[str] = mapped_column(String(36), ForeignKey("social_posts.id"), index=True)
    reach: Mapped[int] = mapped_column(Integer, default=0)
    impressions: Mapped[int] = mapped_column(Integer, default=0)
    likes: Mapped[int] = mapped_column(Integer, default=0)
    comments_count: Mapped[int] = mapped_column(Integer, default=0)
    shares: Mapped[int] = mapped_column(Integer, default=0)
    clicks: Mapped[int] = mapped_column(Integer, default=0)
    leads: Mapped[int] = mapped_column(Integer, default=0)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ModuleContext(BaseModel):
    tenant_id: str
    user_id: str
    session_id: str = ""
    platform_roles: list[str] = Field(default_factory=list)
    company_role: str = "member"
    request_id: str = ""


class BrandCreate(BaseModel):
    name: str = Field(min_length=1)
    sector: str = Field(min_length=1)
    description: str = ""
    audience: str = Field(min_length=1)
    products_services: list[str] = Field(default_factory=list)
    tone: str = Field(min_length=1)
    preferred_words: list[str] = Field(default_factory=list)
    forbidden_words: list[str] = Field(default_factory=list)
    differentiators: list[str] = Field(default_factory=list)
    example_posts: list[str] = Field(default_factory=list)


class CampaignCreate(BaseModel):
    brand_id: str
    name: str = Field(min_length=1)
    goal: str = "notoriedade"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    channels: list[str] = Field(default_factory=list)
    central_message: str = ""
    specific_audience: str = ""
    frequency: str = ""
    brief: str = ""


class IdeaCreate(BaseModel):
    brand_id: str
    campaign_id: Optional[str] = None
    title: str = Field(min_length=1)
    description: str = ""
    source: str = "manual"


class IdeaToPostRequest(BaseModel):
    platform: str = "linkedin"
    format: str = "texto"
    cta: str = ""
    scheduled_at: Optional[str] = None


class DuplicatePostRequest(BaseModel):
    platform: Optional[str] = None
    scheduled_at: Optional[str] = None


class PostCreate(BaseModel):
    brand_id: str
    campaign_id: Optional[str] = None
    platform: str = Field(min_length=1)
    format: str = "feed"
    title: str = ""
    hook: str = ""
    body: str = Field(min_length=1)
    cta: str = ""
    hashtags: list[str] = Field(default_factory=list)
    scheduled_at: Optional[str] = None
    asset_url: Optional[str] = None
    public_notes: str = ""
    internal_notes: str = ""


class PostPatch(BaseModel):
    brand_id: Optional[str] = None
    campaign_id: Optional[str] = None
    platform: Optional[str] = None
    format: Optional[str] = None
    title: Optional[str] = None
    hook: Optional[str] = None
    body: Optional[str] = None
    cta: Optional[str] = None
    hashtags: Optional[list[str]] = None
    scheduled_at: Optional[str] = None
    status: Optional[PostStatus] = None
    asset_url: Optional[str] = None
    public_notes: Optional[str] = None
    internal_notes: Optional[str] = None


class ApprovalRequest(BaseModel):
    comment: str = ""


class CommentCreate(BaseModel):
    comment: str = Field(min_length=1)
    visibility: str = "internal"


class AiRequest(BaseModel):
    brand_id: Optional[str] = None
    campaign_id: Optional[str] = None
    post_id: Optional[str] = None
    topic: str = ""
    platform: str = "instagram"
    format: str = "feed"
    number: int = Field(default=5, ge=1, le=20)
    text: str = ""
    persist: bool = False


class FullPostGenerateRequest(BaseModel):
    brand_id: Optional[str] = None
    platform: str = "facebook"
    format: str = "feed"
    topic: str = ""
    objective: str = ""
    persist: bool = True
    generate_image: bool = True
    scheduled_at: Optional[str] = None


class ManualMetricCreate(BaseModel):
    post_id: str
    reach: int = Field(default=0, ge=0)
    impressions: int = Field(default=0, ge=0)
    likes: int = Field(default=0, ge=0)
    comments_count: int = Field(default=0, ge=0)
    shares: int = Field(default=0, ge=0)
    clicks: int = Field(default=0, ge=0)
    leads: int = Field(default=0, ge=0)
    notes: str = ""


class ManualMetricPatch(BaseModel):
    reach: Optional[int] = Field(default=None, ge=0)
    impressions: Optional[int] = Field(default=None, ge=0)
    likes: Optional[int] = Field(default=None, ge=0)
    comments_count: Optional[int] = Field(default=None, ge=0)
    shares: Optional[int] = Field(default=None, ge=0)
    clicks: Optional[int] = Field(default=None, ge=0)
    leads: Optional[int] = Field(default=None, ge=0)
    notes: Optional[str] = None


def ok(data: Any) -> dict[str, Any]:
    return {"success": True, "data": data}


def to_dict(obj: Any) -> dict[str, Any]:
    data = {c.name: getattr(obj, c.name) for c in obj.__table__.columns}
    for key, value in list(data.items()):
        if isinstance(value, datetime):
            data[key] = value.isoformat() + "Z"
    return data


def get_db():
    with SessionLocal() as session:
        yield session


def parse_csv_header(value: str | None) -> list[str]:
    if not value:
        return []
    return [part.strip() for part in value.split(",") if part.strip()]


def get_context(request: Request) -> ModuleContext:
    tenant_id = request.headers.get("x-viao-tenant-id")
    user_id = request.headers.get("x-viao-user-id")
    if (not tenant_id or not user_id) and ALLOW_DEMO_TENANT:
        tenant_id = tenant_id or "demo"
        user_id = user_id or "demo-user"
    if not tenant_id or not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "MISSING_VIAO_CONTEXT", "message": "Contexto de autenticação da plataforma em falta."},
        )
    return ModuleContext(
        tenant_id=str(tenant_id),
        user_id=str(user_id),
        session_id=request.headers.get("x-viao-session-id", ""),
        platform_roles=parse_csv_header(request.headers.get("x-viao-platform-roles")),
        company_role=request.headers.get("x-viao-company-role", request.headers.get("x-viao-company-roles", "member")),
        request_id=request.headers.get("x-viao-request-id", ""),
    )


def require_reviewer(ctx: ModuleContext):
    allowed = {"owner", "admin", "gestor", "manager", "reviewer", "revisor"}
    roles = {ctx.company_role, *ctx.platform_roles}
    if not (roles & allowed):
        raise HTTPException(status_code=403, detail={"code": "FORBIDDEN", "message": "Sem permissão para aprovar conteúdos."})


def get_brand_or_404(db: Session, ctx: ModuleContext, brand_id: str) -> Brand:
    brand = db.scalar(select(Brand).where(Brand.id == brand_id, Brand.tenant_id == ctx.tenant_id))
    if not brand:
        raise HTTPException(status_code=404, detail={"code": "BRAND_NOT_FOUND", "message": "Marca não encontrada."})
    return brand


def get_campaign_or_404(db: Session, ctx: ModuleContext, campaign_id: str) -> Campaign:
    campaign = db.scalar(select(Campaign).where(Campaign.id == campaign_id, Campaign.tenant_id == ctx.tenant_id))
    if not campaign:
        raise HTTPException(status_code=404, detail={"code": "CAMPAIGN_NOT_FOUND", "message": "Campanha não encontrada."})
    return campaign


def get_post_or_404(db: Session, ctx: ModuleContext, post_id: str) -> Post:
    post = db.scalar(select(Post).where(Post.id == post_id, Post.tenant_id == ctx.tenant_id))
    if not post:
        raise HTTPException(status_code=404, detail={"code": "POST_NOT_FOUND", "message": "Publicação não encontrada."})
    return post


def get_idea_or_404(db: Session, ctx: ModuleContext, idea_id: str) -> Idea:
    idea = db.scalar(select(Idea).where(Idea.id == idea_id, Idea.tenant_id == ctx.tenant_id))
    if not idea:
        raise HTTPException(status_code=404, detail={"code": "IDEA_NOT_FOUND", "message": "Ideia não encontrada."})
    return idea


def get_metric_or_404(db: Session, ctx: ModuleContext, metric_id: str) -> ManualMetric:
    metric = db.scalar(select(ManualMetric).where(ManualMetric.id == metric_id, ManualMetric.tenant_id == ctx.tenant_id))
    if not metric:
        raise HTTPException(status_code=404, detail={"code": "METRIC_NOT_FOUND", "message": "Métrica não encontrada."})
    return metric


def delete_post_tree(db: Session, ctx: ModuleContext, post: Post) -> None:
    for model in (ManualMetric, PostVersion, Approval, Comment):
        for row in db.scalars(select(model).where(model.tenant_id == ctx.tenant_id, model.post_id == post.id)).all():
            db.delete(row)
    db.flush()
    for generation in db.scalars(select(AiGeneration).where(AiGeneration.tenant_id == ctx.tenant_id, AiGeneration.post_id == post.id)).all():
        generation.post_id = None
    db.flush()
    db.delete(post)
    db.flush()


def matches_query(value: str, query: str) -> bool:
    return normalize_text(query) in normalize_text(value or "")


def normalize_text(value: str) -> str:
    return value.casefold().strip()


def forbidden_variants(word: str) -> set[str]:
    normalized = normalize_text(word)
    variants = {normalized}
    if normalized.endswith("o") and len(normalized) > 3:
        stem = normalized[:-1]
        variants.update({stem + "a", stem + "os", stem + "as"})
    return variants


def validate_post_content(post_data: PostCreate | Post, brand: Brand) -> dict[str, Any]:
    body = post_data.body or ""
    platform = normalize_text(post_data.platform or "")
    fmt = normalize_text(post_data.format or "")
    hashtags = post_data.hashtags or []
    warnings: list[str] = []
    errors: list[str] = []
    suggestions: list[str] = []
    body_norm = normalize_text(body)
    forbidden_hits = [
        word
        for word in brand.forbidden_words
        if word and any(variant in body_norm for variant in forbidden_variants(word))
    ]
    if forbidden_hits:
        warnings.append("Foram encontradas palavras proibidas da marca: " + ", ".join(forbidden_hits))
    if not (post_data.cta or "").strip():
        warnings.append("Falta uma chamada para ação clara.")
    if platform == "instagram":
        if len(body) > 2200:
            warnings.append("A legenda pode estar demasiado longa para Instagram.")
        if len(hashtags) > 15:
            warnings.append("O número de hashtags pode ser excessivo para Instagram.")
        if fmt in {"feed", "carrossel"} and not getattr(post_data, "asset_url", None):
            suggestions.append("Associe uma imagem ou asset visual antes da publicação manual.")
    if platform in {"x", "twitter"} and len(body) > 280:
        errors.append("O texto excede o limite recomendado para X/Twitter.")
    if platform == "linkedin" and len(body.split("\n")) < 2 and len(body) > 300:
        suggestions.append("Considere dividir o texto em parágrafos curtos para LinkedIn.")
    if platform == "tiktok" and not (post_data.hook or "").strip():
        warnings.append("TikTok deve ter um hook inicial explícito.")
    score = max(0, 100 - len(warnings) * 10 - len(errors) * 25)
    return {"score": score, "warnings": warnings, "errors": errors, "suggestions": suggestions}


def create_version(db: Session, post: Post, ctx: ModuleContext, source: str = "human") -> None:
    last = db.scalar(select(PostVersion.version_number).where(PostVersion.post_id == post.id).order_by(PostVersion.version_number.desc())) or 0
    db.add(PostVersion(
        tenant_id=post.tenant_id,
        post_id=post.id,
        version_number=int(last) + 1,
        body=post.body,
        cta=post.cta,
        hashtags=post.hashtags,
        source=source,
        created_by=ctx.user_id,
    ))


def build_prompt(action: str, req: AiRequest, brand: Optional[Brand], campaign: Optional[Campaign], post: Optional[Post]) -> str:
    brand_block = ""
    if brand:
        brand_block = (
            f"Marca: {brand.name}\nSetor: {brand.sector}\nPúblico-alvo: {brand.audience}\n"
            f"Tom de voz: {brand.tone}\nPalavras preferidas: {', '.join(brand.preferred_words or [])}\n"
            f"Palavras proibidas: {', '.join(brand.forbidden_words or [])}\n"
        )
    campaign_block = ""
    if campaign:
        campaign_block = f"Campanha: {campaign.name}\nObjetivo: {campaign.goal}\nMensagem central: {campaign.central_message}\nBriefing: {campaign.brief}\n"
    post_block = f"Publicação atual: {post.body}\n" if post else ""
    instructions = {
        "ideas": f"Propõe exatamente {req.number} ideias de publicações para {req.platform}. Responde em formato numerado: '1. Título — objetivo e texto curto'. Não incluas introdução nem conclusão.",
        "post": f"Cria uma publicação para {req.platform} no formato {req.format} sobre: {req.topic}.",
        "variations": "Cria 3 variações alternativas mantendo a mensagem principal.",
        "adapt": f"Adapta o conteúdo para {req.platform}, respeitando comportamento e limites da plataforma.",
        "evaluate": "Avalia clareza, adequação à marca, CTA, risco de promessa exagerada e palavras proibidas.",
    }.get(action, "Ajuda a melhorar este conteúdo para redes sociais.")
    return (
        "Responde em português de Portugal, com linguagem profissional e prática.\n"
        "Não publiques automaticamente em redes sociais; prepara apenas conteúdo para revisão humana.\n\n"
        f"{brand_block}{campaign_block}{post_block}Pedido: {instructions}\nTexto/tema: {req.text or req.topic}\n"
    )


def local_ai_backup(action: str, prompt: str) -> str:
    topic_match = re.search(r"Texto/tema:\s*(.+)", prompt)
    topic = topic_match.group(1).strip() if topic_match else "o tema definido"
    brand_match = re.search(r"Marca:\s*(.+)", prompt)
    brand = brand_match.group(1).strip() if brand_match else "a marca"
    platform_match = re.search(r"publica(?:ções|ção) para ([^,\n.]+)", prompt, flags=re.IGNORECASE)
    platform = platform_match.group(1).strip() if platform_match else "redes sociais"
    if action == "ideas":
        return "\n".join([
            f"1. Prova social sobre {topic} — mostrar um resultado concreto de {brand}, explicar o problema inicial, a solução aplicada e terminar com CTA para diagnóstico.",
            f"2. Dica prática para PMEs — partilhar 3 recomendações acionáveis sobre {topic}, com linguagem simples e convite para guardar a publicação.",
            f"3. Bastidores de confiança — explicar como {brand} trabalha {topic}, destacando segurança, acompanhamento e próximos passos para contacto.",
        ])
    if action == "post":
        return f"{brand} ajuda PMEs com {topic}. Mostre o desafio, explique o benefício principal e termine com uma chamada para ação clara para {platform}."
    if action == "full_post":
        return json.dumps(fallback_full_post(brand, topic, platform), ensure_ascii=False)
    return f"Conteúdo sugerido para {platform}: destaque {topic}, alinhe com a marca {brand}, inclua benefício, prova e chamada para ação."


def fallback_full_post(brand_name: str, topic: str, platform: str) -> dict[str, Any]:
    clean_topic = (topic or "conteúdo para redes sociais").strip()
    clean_brand = (brand_name or "a marca").strip()
    title = f"{clean_brand}: {clean_topic}"[:120]
    return {
        "title": title,
        "hook": f"O seu negócio precisa de comunicar {clean_topic} com clareza e confiança.",
        "body": (f"{clean_brand} preparou uma mensagem pensada para quem procura {clean_topic}.\n\n"
                 "Nesta publicação destacamos o problema, explicamos a solução de forma simples e mostramos o próximo passo para o cliente agir sem fricção.\n\n"
                 "Guarde esta ideia para o próximo planeamento de conteúdos e adapte-a ao calendário da campanha."),
        "cta": "Fale connosco para preparar a próxima publicação da sua campanha.",
        "hashtags": ["#MarketingDigital", "#RedesSociais", "#Conteudo", "#PME"],
        "reference_links": [
            {"title": f"Website de {clean_brand}", "url": "https://www.viaoceanica.com"},
            {"title": "Boas práticas Meta Business", "url": "https://www.facebook.com/business/help"},
            {"title": "LinkedIn Marketing Solutions", "url": "https://business.linkedin.com/marketing-solutions"},
        ],
        "image_prompt": f"Imagem profissional para {platform}: {clean_brand}, {clean_topic}, visual limpo, moderno, sem texto pequeno, formato redes sociais",
        "alt_text": f"Imagem promocional sobre {clean_topic} para {clean_brand}.",
    }


def parse_full_post_response(reply: str, brand: Brand, campaign: Campaign, req: FullPostGenerateRequest) -> dict[str, Any]:
    text = (reply or "").strip()
    candidate = text
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.DOTALL)
    if match:
        candidate = match.group(1)
    elif "{" in text and "}" in text:
        candidate = text[text.find("{"):text.rfind("}") + 1]
    try:
        data = json.loads(candidate)
    except Exception:
        data = fallback_full_post(brand.name, req.topic or campaign.brief or campaign.central_message or campaign.name, req.platform)
        if len(text) > 40:
            data["body"] = text
    fallback = fallback_full_post(brand.name, req.topic or campaign.brief or campaign.central_message or campaign.name, req.platform)
    def clean_str(key: str, limit: int | None = None) -> str:
        value = data.get(key) or fallback[key]
        if isinstance(value, list):
            value = " ".join(str(v) for v in value)
        value = str(value).strip()
        return value[:limit] if limit else value
    hashtags = data.get("hashtags") or fallback["hashtags"]
    if isinstance(hashtags, str):
        hashtags = [part.strip() for part in re.split(r"[\s,]+", hashtags) if part.strip()]
    hashtags = [tag if str(tag).startswith("#") else f"#{tag}" for tag in hashtags if str(tag).strip()][:12]
    refs = data.get("reference_links") or fallback["reference_links"]
    clean_refs: list[dict[str, str]] = []
    if isinstance(refs, list):
        for item in refs[:5]:
            if isinstance(item, dict):
                title = str(item.get("title") or item.get("label") or item.get("url") or "Referência").strip()
                url = str(item.get("url") or "").strip()
            else:
                title, url = "Referência", str(item).strip()
            if url and not re.match(r"https?://", url):
                url = "https://" + url.lstrip("/")
            if url:
                clean_refs.append({"title": title[:120], "url": url[:500]})
    if not clean_refs:
        clean_refs = fallback["reference_links"]
    return {"title": clean_str("title", 180), "hook": clean_str("hook", 255), "body": clean_str("body"), "cta": clean_str("cta", 500), "hashtags": hashtags, "reference_links": clean_refs, "image_prompt": clean_str("image_prompt"), "alt_text": clean_str("alt_text", 255)}


def generated_image_data_url(title: str, prompt: str, brand_name: str) -> str:
    def esc(value: str) -> str:
        return (value or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")
    title = esc(title[:70]); brand_name = esc(brand_name[:50]); prompt = esc(prompt[:130])
    digest = hashlib.sha256(f"{title}|{prompt}|{brand_name}".encode("utf-8")).hexdigest()
    c1, c2, c3 = f"#{digest[:6]}", f"#{digest[6:12]}", f"#{digest[12:18]}"
    svg = (
        f"<svg xmlns='http://www.w3.org/2000/svg' width='1200' height='1200' viewBox='0 0 1200 1200'>"
        f"<defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='{c1}'/><stop offset='0.55' stop-color='{c2}'/><stop offset='1' stop-color='{c3}'/></linearGradient></defs>"
        "<rect width='1200' height='1200' fill='url(#g)'/><circle cx='1010' cy='170' r='220' fill='rgba(255,255,255,0.16)'/><circle cx='180' cy='1060' r='280' fill='rgba(255,255,255,0.12)'/>"
        f"<rect x='90' y='760' width='1020' height='270' rx='38' fill='rgba(255,255,255,0.88)'/><text x='120' y='835' fill='#0f172a' font-family='Arial, sans-serif' font-size='34' font-weight='700'>{brand_name}</text>"
        f"<foreignObject x='120' y='875' width='960' height='105'><div xmlns='http://www.w3.org/1999/xhtml' style='font: 700 54px Arial, sans-serif; color: #0f172a; line-height:1.05;'>{title}</div></foreignObject>"
        f"<foreignObject x='120' y='980' width='960' height='60'><div xmlns='http://www.w3.org/1999/xhtml' style='font: 24px Arial, sans-serif; color: #334155; line-height:1.2;'>{prompt}</div></foreignObject></svg>"
    )
    return "data:image/svg+xml;base64," + base64.b64encode(svg.encode("utf-8")).decode("ascii")



IMAGE_PROMPT_GUARDRAIL_SUFFIX = (
    " Composição segura e profissional para redes sociais: focar em ambiente, produto, serviço, textura, paisagem, "
    "arquitetura, objetos simples ou composição abstrata relevante; sem pessoas em primeiro plano; sem mãos visíveis; "
    "sem pés visíveis; sem dedos; sem rostos em close-up; sem texto; sem letras; sem palavras; sem cartazes; "
    "sem ecrãs legíveis; sem logótipos não fornecidos; sem embalagens com rótulos legíveis; evitar artefactos típicos de IA; "
    "usar poucos objetos, iluminação coerente, composição editorial limpa, aspeto natural e não genérico."
)

_IMAGE_PROMPT_RISK_PATTERNS = [
    r"\bvisible\s+hands?\b",
    r"\bhands?\b",
    r"\bfingers?\b",
    r"\bvisible\s+feet\b",
    r"\bfeet\b",
    r"\bfoot\b",
    r"\btoes?\b",
    r"\breadable\s+text\b",
    r"\btext\s*[\'\"][^\'\"]*[\'\"]",
    r"[\'\"][A-Za-z0-9 ]{2,}[\'\"]",
    r"\bposter\b",
    r"\bsign\b",
    r"\bsignage\b",
    r"\bbanner\b",
    r"\bwords?\b",
    r"\bletters?\b",
    r"\blogos?\b",
]


def apply_image_prompt_guardrails(prompt: str) -> str:
    """Make social-post image prompts safer for current AI image-model limits."""
    cleaned = re.sub(r"\s+", " ", (prompt or "").strip())
    for pattern in _IMAGE_PROMPT_RISK_PATTERNS:
        cleaned = re.sub(pattern, "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\s*[,;:.]\s*[,;:.]+", ". ", cleaned)
    cleaned = re.sub(r"\s{2,}", " ", cleaned).strip(" ,;.-")
    if not cleaned:
        cleaned = "Imagem editorial abstrata e relevante para a campanha, com ambiente profissional, objetos simples e luz natural"
    guarded = f"{cleaned}.{IMAGE_PROMPT_GUARDRAIL_SUFFIX}"
    return re.sub(r"\s+", " ", guarded).strip()[:1800]

def parse_image_prompt_response(reply: str, fallback_prompt: str, fallback_alt: str) -> dict[str, str]:
    text = (reply or "").strip()
    candidate = text
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.DOTALL)
    if match:
        candidate = match.group(1)
    elif "{" in text and "}" in text:
        candidate = text[text.find("{"):text.rfind("}") + 1]
    try:
        data = json.loads(candidate)
    except Exception:
        data = {"image_prompt": text or fallback_prompt, "alt_text": fallback_alt}
    prompt = str(data.get("image_prompt") or data.get("prompt") or fallback_prompt).strip()
    alt_text = str(data.get("alt_text") or data.get("alt") or fallback_alt).strip()
    prompt = apply_image_prompt_guardrails(prompt)
    return {"image_prompt": prompt, "alt_text": alt_text[:255]}


async def call_image_service(ctx: ModuleContext, prompt: str) -> tuple[str | None, str, dict[str, Any]]:
    prompt = apply_image_prompt_guardrails(prompt)
    try:
        async with httpx.AsyncClient(timeout=AI_TIMEOUT_SECONDS) as client:
            resp = await client.post(
                f"{AI_SERVICE_URL}/api/v1/images/generations",
                headers={
                    "Content-Type": "application/json",
                    "X-OpenClaw-Agent": AI_AGENT_ID,
                    "X-Viao-Tenant-Id": stable_numeric_id(ctx.tenant_id),
                    "X-Viao-User-Id": stable_numeric_id(ctx.user_id),
                    "X-Viao-Module-Key": MODULE_KEY,
                    "X-Viao-Request-Id": ctx.request_id,
                },
                json={
                    "model": AI_IMAGE_MODEL,
                    "prompt": prompt,
                    "n": 1,
                    "size": "1024x1024",
                    "response_format": "b64_json",
                },
            )
            resp.raise_for_status()
            payload = resp.json()
            data = payload.get("data") if isinstance(payload, dict) else payload
            image_items = data.get("data") if isinstance(data, dict) else None
            if isinstance(image_items, list) and image_items:
                first = image_items[0]
                if isinstance(first, dict):
                    if first.get("b64_json"):
                        mime_type = str(first.get("mime_type") or "image/png").split(";", 1)[0]
                        if not mime_type.startswith("image/"):
                            mime_type = "image/png"
                        return f"data:{mime_type};base64," + first["b64_json"], data.get("model") or AI_IMAGE_MODEL if isinstance(data, dict) else AI_IMAGE_MODEL, {"fallback": False, "provider": data.get("provider") if isinstance(data, dict) else None, "mime_type": mime_type}
                    if first.get("url"):
                        return first["url"], data.get("model") or AI_IMAGE_MODEL if isinstance(data, dict) else AI_IMAGE_MODEL, {"fallback": False, "provider": data.get("provider") if isinstance(data, dict) else None}
            return None, AI_IMAGE_MODEL, {"fallback": True, "error": "NO_IMAGE_IN_RESPONSE"}
    except Exception as exc:
        return None, "fallback-local-svg", {"fallback": True, "error": exc.__class__.__name__, "detail": str(exc)[:300]}


async def call_ai_service(ctx: ModuleContext, prompt: str, action: str) -> tuple[str, str, dict[str, Any]]:
    try:
        async with httpx.AsyncClient(timeout=AI_TIMEOUT_SECONDS) as client:
            resp = await client.post(
                f"{AI_SERVICE_URL}/api/v1/chat/completions",
                headers={
                    "Content-Type": "application/json",
                    "X-OpenClaw-Agent": AI_AGENT_ID,
                    "X-Viao-Tenant-Id": stable_numeric_id(ctx.tenant_id),
                    "X-Viao-User-Id": stable_numeric_id(ctx.user_id),
                    "X-Viao-Module-Key": MODULE_KEY,
                    "X-Viao-Request-Id": ctx.request_id,
                },
                json={
                    "model": AI_MODEL,
                    "temperature": 0.7,
                    "max_tokens": 1400,
                    "messages": [
                        {"role": "system", "content": "És o assistente do módulo Redes Sociais da Via Oceânica AI. Responde em português de Portugal, de forma concreta e diretamente utilizável."},
                        {"role": "user", "content": prompt},
                    ],
                    "user": f"{ctx.tenant_id}:{ctx.user_id}:{action}",
                },
            )
            resp.raise_for_status()
            data = resp.json()
            nested = data.get("data") if isinstance(data, dict) else None
            content = ""
            if isinstance(nested, dict) and isinstance(nested.get("reply"), str):
                content = nested["reply"]
            if not content:
                choices = (nested or data).get("choices", []) if isinstance((nested or data), dict) else []
                if choices:
                    content = choices[0].get("message", {}).get("content", "")
            return content or local_ai_backup(action, prompt), (nested or data).get("model", AI_MODEL) if isinstance((nested or data), dict) else AI_MODEL, {"fallback": False}
    except Exception as exc:
        backup = local_ai_backup(action, prompt)
        return backup, "fallback-local-structured", {"fallback": True, "error": exc.__class__.__name__, "detail": str(exc)[:300]}


def stable_numeric_id(value: str, minimum: int = 1) -> str:
    try:
        number = int(str(value))
        if number > 0:
            return str(number)
    except (TypeError, ValueError):
        pass
    digest = hashlib.sha256(str(value).encode("utf-8")).hexdigest()
    return str(int(digest[:12], 16) % 2_000_000_000 + minimum)


def export_token_payload(ctx: ModuleContext, issued_at: int | None = None) -> str:
    ts = int(issued_at or time.time())
    body = f"{ctx.tenant_id}:{ctx.user_id}:{ts}"
    sig = hmac.new(EXPORT_TOKEN_SECRET.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{body}:{sig}".encode("utf-8")).decode("ascii")


def context_from_export_token(token: str | None) -> ModuleContext | None:
    if not token:
        return None
    try:
        raw = base64.urlsafe_b64decode(token.encode("ascii")).decode("utf-8")
        tenant_id, user_id, ts_text, sig = raw.rsplit(":", 3)
        body = f"{tenant_id}:{user_id}:{ts_text}"
        expected = hmac.new(EXPORT_TOKEN_SECRET.encode("utf-8"), body.encode("utf-8"), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected):
            return None
        if int(time.time()) - int(ts_text) > EXPORT_TOKEN_TTL_SECONDS:
            return None
        return ModuleContext(tenant_id=tenant_id, user_id=user_id, session_id="download", platform_roles=[], company_role="member", request_id="download")
    except Exception:
        return None


def clean_ai_text(value: str) -> str:
    text_value = re.sub(r"^[#\s>*-]+", "", value.strip())
    text_value = text_value.replace("**", "").replace("__", "").strip()
    return text_value


def parse_ai_ideas(reply: str, limit: int) -> list[tuple[str, str]]:
    heading_pattern = re.compile(
        r"(?im)^\s*(?:[-*]\s*)?(?:#{1,6}\s*)?(?:\*\*)?(?:ideia\s*)?(\d+)[\.)]?\s*(?:[:\-–—]\s*)?(.*?)(?:\*\*)?\s*$"
    )
    raw_matches = [match for match in heading_pattern.finditer(reply) if clean_ai_text(match.group(2))]
    ideas: list[tuple[str, str]] = []
    if raw_matches:
        for index, match in enumerate(raw_matches[:limit]):
            title = clean_ai_text(match.group(2))[:255]
            section_start = match.end()
            section_end = raw_matches[index + 1].start() if index + 1 < len(raw_matches) else len(reply)
            description = clean_ai_text(reply[section_start:section_end].replace("---", " "))
            if title:
                ideas.append((title, description))
        return ideas

    preface_markers = ("claro", "aqui estão", "seguem", "propostas", "ambas as ideias")
    for raw_line in reply.splitlines():
        line = clean_ai_text(raw_line)
        if not line:
            continue
        if any(line.lower().startswith(marker) for marker in preface_markers):
            continue
        if ":" in line:
            title, description = line.split(":", 1)
        elif "—" in line:
            title, description = line.split("—", 1)
        elif "-" in line:
            title, description = line.split("-", 1)
        else:
            title, description = line, ""
        title = clean_ai_text(title)
        if title[:2].isdigit() and title[2:3] in {".", ")"}:
            title = title[3:].strip()
        if title and not title.lower().startswith("sugestão gerada localmente"):
            ideas.append((title[:255], clean_ai_text(description)))
        if len(ideas) >= limit:
            break
    if not ideas and reply.strip():
        ideas.append(("Sugestão de conteúdo", reply.strip()))
    return ideas


def csv_safe(value: Any) -> str:
    text_value = "" if value is None else str(value)
    if text_value.startswith(("=", "+", "-", "@")):
        return "'" + text_value
    return text_value


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="Via Oceânica — Módulo Redes Sociais", version=MODULE_VERSION, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "mod-social-media", "version": MODULE_VERSION, "uptime_seconds": int(time.time() - _start_time)}


@app.get("/ready")
def ready(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ready", "dependencies": {"database": "ok"}}


@app.get("/api/v1/context")
def context(ctx: ModuleContext = Depends(get_context)):
    return ok(ctx.model_dump())


@app.get("/api/v1/status")
def api_status(ctx: ModuleContext = Depends(get_context)):
    return ok({"module": MODULE_KEY, "tenant_id": ctx.tenant_id, "user_id": ctx.user_id, "copy_language": "pt-PT"})


@app.get("/api/v1/dashboard")
def dashboard(ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    counts = {
        "brands": len(db.scalars(select(Brand).where(Brand.tenant_id == ctx.tenant_id)).all()),
        "campaigns": len(db.scalars(select(Campaign).where(Campaign.tenant_id == ctx.tenant_id)).all()),
        "posts": len(db.scalars(select(Post).where(Post.tenant_id == ctx.tenant_id)).all()),
        "pending_approvals": len(db.scalars(select(Post).where(Post.tenant_id == ctx.tenant_id, Post.status == "in_review")).all()),
    }
    return ok(counts)


@app.get("/api/v1/brands")
def list_brands(ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    return ok([to_dict(item) for item in db.scalars(select(Brand).where(Brand.tenant_id == ctx.tenant_id).order_by(Brand.created_at.desc())).all()])


@app.post("/api/v1/brands", status_code=201)
def create_brand(payload: BrandCreate, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    brand = Brand(tenant_id=ctx.tenant_id, created_by=ctx.user_id, **payload.model_dump())
    db.add(brand); db.commit(); db.refresh(brand)
    return ok(to_dict(brand))


@app.get("/api/v1/brands/{brand_id}")
def get_brand(brand_id: str, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    return ok(to_dict(get_brand_or_404(db, ctx, brand_id)))


@app.patch("/api/v1/brands/{brand_id}")
def update_brand(brand_id: str, payload: dict[str, Any], ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    brand = get_brand_or_404(db, ctx, brand_id)
    allowed = set(BrandCreate.model_fields) | {"status"}
    for key, value in payload.items():
        if key in allowed:
            setattr(brand, key, value)
    db.commit(); db.refresh(brand)
    return ok(to_dict(brand))


@app.delete("/api/v1/brands/{brand_id}", status_code=204)
def delete_brand(brand_id: str, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    brand = get_brand_or_404(db, ctx, brand_id)
    for metric in db.scalars(select(ManualMetric).join(Post, ManualMetric.post_id == Post.id).where(ManualMetric.tenant_id == ctx.tenant_id, Post.brand_id == brand.id)).all():
        db.delete(metric)
    for model in (PostVersion, Approval, Comment):
        for row in db.scalars(select(model).join(Post, model.post_id == Post.id).where(model.tenant_id == ctx.tenant_id, Post.brand_id == brand.id)).all():
            db.delete(row)
    for generation in db.scalars(select(AiGeneration).where(AiGeneration.tenant_id == ctx.tenant_id, AiGeneration.brand_id == brand.id)).all():
        db.delete(generation)
    for post in db.scalars(select(Post).where(Post.tenant_id == ctx.tenant_id, Post.brand_id == brand.id)).all():
        delete_post_tree(db, ctx, post)
    db.flush()
    for idea in db.scalars(select(Idea).where(Idea.tenant_id == ctx.tenant_id, Idea.brand_id == brand.id)).all():
        db.delete(idea)
    for campaign in db.scalars(select(Campaign).where(Campaign.tenant_id == ctx.tenant_id, Campaign.brand_id == brand.id)).all():
        db.delete(campaign)
    db.flush()
    db.delete(brand); db.commit()
    return Response(status_code=204)


@app.get("/api/v1/campaigns")
def list_campaigns(ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    return ok([to_dict(item) for item in db.scalars(select(Campaign).where(Campaign.tenant_id == ctx.tenant_id).order_by(Campaign.created_at.desc())).all()])


@app.post("/api/v1/campaigns", status_code=201)
def create_campaign(payload: CampaignCreate, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    get_brand_or_404(db, ctx, payload.brand_id)
    campaign = Campaign(tenant_id=ctx.tenant_id, created_by=ctx.user_id, **payload.model_dump())
    db.add(campaign); db.commit(); db.refresh(campaign)
    return ok(to_dict(campaign))


@app.get("/api/v1/campaigns/{campaign_id}")
def get_campaign(campaign_id: str, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    return ok(to_dict(get_campaign_or_404(db, ctx, campaign_id)))


@app.patch("/api/v1/campaigns/{campaign_id}")
def update_campaign(campaign_id: str, payload: dict[str, Any], ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    campaign = get_campaign_or_404(db, ctx, campaign_id)
    allowed = set(CampaignCreate.model_fields) - {"brand_id"} | {"status"}
    for key, value in payload.items():
        if key in allowed:
            setattr(campaign, key, value)
    db.commit(); db.refresh(campaign)
    return ok(to_dict(campaign))


@app.delete("/api/v1/campaigns/{campaign_id}", status_code=204)
def delete_campaign(campaign_id: str, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    campaign = get_campaign_or_404(db, ctx, campaign_id)
    for post in db.scalars(select(Post).where(Post.tenant_id == ctx.tenant_id, Post.campaign_id == campaign.id)).all():
        delete_post_tree(db, ctx, post)
    db.flush()
    for idea in db.scalars(select(Idea).where(Idea.tenant_id == ctx.tenant_id, Idea.campaign_id == campaign.id)).all():
        db.delete(idea)
    for generation in db.scalars(select(AiGeneration).where(AiGeneration.tenant_id == ctx.tenant_id, AiGeneration.campaign_id == campaign.id)).all():
        db.delete(generation)
    db.flush()
    db.delete(campaign); db.commit()
    return Response(status_code=204)


@app.get("/api/v1/ideas")
def list_ideas(ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    rows = db.scalars(select(Idea).where(Idea.tenant_id == ctx.tenant_id).order_by(Idea.created_at.desc())).all()
    return ok([to_dict(row) for row in rows])


@app.post("/api/v1/ideas", status_code=201)
def create_idea(payload: IdeaCreate, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    get_brand_or_404(db, ctx, payload.brand_id)
    if payload.campaign_id:
        campaign = get_campaign_or_404(db, ctx, payload.campaign_id)
        if campaign.brand_id != payload.brand_id:
            raise HTTPException(status_code=400, detail={"code": "CAMPAIGN_BRAND_MISMATCH", "message": "A campanha não pertence à marca selecionada."})
    idea = Idea(tenant_id=ctx.tenant_id, created_by=ctx.user_id, **payload.model_dump())
    db.add(idea); db.commit(); db.refresh(idea)
    return ok(to_dict(idea))


@app.get("/api/v1/ideas/{idea_id}")
def get_idea(idea_id: str, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    return ok(to_dict(get_idea_or_404(db, ctx, idea_id)))


@app.patch("/api/v1/ideas/{idea_id}")
def update_idea(idea_id: str, payload: dict[str, Any], ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    idea = get_idea_or_404(db, ctx, idea_id)
    allowed = {"brand_id", "campaign_id", "title", "description", "source", "status"}
    next_brand_id = payload.get("brand_id", idea.brand_id)
    next_campaign_id = payload.get("campaign_id", idea.campaign_id)
    if next_brand_id:
        get_brand_or_404(db, ctx, next_brand_id)
    if next_campaign_id:
        campaign = get_campaign_or_404(db, ctx, next_campaign_id)
        if campaign.brand_id != next_brand_id:
            raise HTTPException(status_code=400, detail={"code": "CAMPAIGN_BRAND_MISMATCH", "message": "A campanha não pertence à marca selecionada."})
    for key, value in payload.items():
        if key in allowed:
            setattr(idea, key, value)
    db.commit(); db.refresh(idea)
    return ok(to_dict(idea))


@app.delete("/api/v1/ideas/{idea_id}", status_code=204)
def delete_idea(idea_id: str, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    idea = get_idea_or_404(db, ctx, idea_id)
    db.delete(idea); db.commit()
    return Response(status_code=204)


@app.post("/api/v1/ideas/{idea_id}/convert-to-post", status_code=201)
def convert_idea_to_post(idea_id: str, payload: IdeaToPostRequest, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    idea = get_idea_or_404(db, ctx, idea_id)
    brand = get_brand_or_404(db, ctx, idea.brand_id)
    body = f"{idea.title}: {idea.description}".strip().rstrip(":")
    post_payload = PostCreate(
        brand_id=idea.brand_id,
        campaign_id=idea.campaign_id,
        platform=payload.platform,
        format=payload.format,
        body=body,
        cta=payload.cta,
        scheduled_at=payload.scheduled_at,
        hashtags=[],
    )
    quality = validate_post_content(post_payload, brand)
    post = Post(tenant_id=ctx.tenant_id, created_by=ctx.user_id, quality_check=quality, **post_payload.model_dump())
    idea.status = "converted"
    db.add(post); db.flush(); create_version(db, post, ctx, "idea")
    db.commit(); db.refresh(post)
    return ok(to_dict(post))


@app.get("/api/v1/library")
def library(query: str = "", ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    items: list[dict[str, Any]] = []
    ideas = db.scalars(select(Idea).where(Idea.tenant_id == ctx.tenant_id)).all()
    posts = db.scalars(select(Post).where(Post.tenant_id == ctx.tenant_id)).all()
    for idea in ideas:
        haystack = f"{idea.title} {idea.description}"
        if not query or matches_query(haystack, query):
            items.append({"type": "idea", "id": idea.id, "title": idea.title, "description": idea.description, "status": idea.status})
    for post in posts:
        haystack = f"{post.title} {post.body} {post.cta} {' '.join(post.hashtags or [])}"
        if not query or matches_query(haystack, query):
            items.append({"type": "post", "id": post.id, "title": post.title or post.platform, "description": post.body, "status": post.status})
        if post.cta and (not query or matches_query(post.cta, query) or matches_query(post.body, query)):
            items.append({"type": "cta", "id": post.id, "title": "CTA aprovado", "description": post.cta, "status": post.status})
    return ok(items)


@app.post("/api/v1/campaigns/{campaign_id}/generate-full-post", status_code=201)
async def generate_full_campaign_post(campaign_id: str, payload: FullPostGenerateRequest, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    campaign = get_campaign_or_404(db, ctx, campaign_id)
    brand_id = payload.brand_id or campaign.brand_id
    brand = get_brand_or_404(db, ctx, brand_id)
    if campaign.brand_id != brand.id:
        raise HTTPException(status_code=400, detail={"code": "CAMPAIGN_BRAND_MISMATCH", "message": "A campanha não pertence à marca selecionada."})
    topic = payload.topic or campaign.brief or campaign.central_message or campaign.name

    text_prompt = (
        "PASSO 1: cria apenas o texto de uma publicação completa pronta para revisão humana. "
        "Responde APENAS em JSON válido, sem markdown. "
        "Inclui estes campos: title, hook, body, cta, hashtags (array), reference_links (array de objetos title/url). "
        "Não incluas image_prompt neste passo. O body deve ser completo, com parágrafos, benefício, prova/argumento e contexto suficiente. "
        "As reference_links devem ser links úteis para revisão ou apoio da publicação; não inventes fontes factuais específicas se não tiveres base.\n\n"
        f"Marca: {brand.name}\nSetor: {brand.sector}\nDescrição: {brand.description}\nPúblico-alvo: {brand.audience}\nTom: {brand.tone}\n"
        f"Produtos/serviços: {', '.join(brand.products_services or [])}\nDiferenciadores: {', '.join(brand.differentiators or [])}\n"
        f"Campanha: {campaign.name}\nObjetivo: {payload.objective or campaign.goal}\nMensagem central: {campaign.central_message}\nBrief: {campaign.brief}\n"
        f"Plataforma: {payload.platform}\nFormato: {payload.format}\nTema: {topic}\n"
    )
    text_reply, text_model, text_meta = await call_ai_service(ctx, text_prompt, "full_post")
    generated = parse_full_post_response(text_reply, brand, campaign, payload)

    image_model = None
    image_meta: dict[str, Any] = {"skipped": True}
    image_url = None
    if payload.generate_image:
        image_prompt_prompt = (
            "PASSO 2: transforma o texto aprovado abaixo num prompt visual para gerar UMA imagem de redes sociais. "
            "Responde APENAS em JSON válido com image_prompt e alt_text. "
            "O prompt deve ser descritivo, alinhado com a marca e campanha, e otimizado para evitar defeitos comuns de IA. "
            "Evita mãos, pés, dedos, rostos em close-up, pessoas em primeiro plano, texto, letras, palavras, sinais, cartazes, mockups ilegíveis, e logótipos não fornecidos. "
            "Prefere composições editoriais com ambiente, produto/serviço, objetos simples, textura, paisagem ou abstração relevante. "
            "Inclui composição, ambiente, estilo, cores, assunto principal e restrições.\n\n"
            f"Marca: {brand.name}; setor: {brand.sector}; tom: {brand.tone}; público: {brand.audience}.\n"
            f"Campanha: {campaign.name}; objetivo: {payload.objective or campaign.goal}; mensagem central: {campaign.central_message}.\n"
            f"Plataforma/formato: {payload.platform} / {payload.format}.\n"
            f"Texto da publicação JSON: {json.dumps(generated, ensure_ascii=False)}"
        )
        image_prompt_reply, image_prompt_model, image_prompt_meta = await call_ai_service(ctx, image_prompt_prompt, "image_prompt")
        image_fields = parse_image_prompt_response(image_prompt_reply, generated.get("image_prompt") or fallback_full_post(brand.name, topic, payload.platform)["image_prompt"], generated.get("alt_text") or f"Imagem promocional para {brand.name}.")
        generated["image_prompt"] = image_fields["image_prompt"]
        generated["alt_text"] = image_fields["alt_text"]

        image_url, image_model, image_meta = await call_image_service(ctx, generated["image_prompt"])
        if not image_url:
            image_url = generated_image_data_url(generated["title"], generated["image_prompt"], brand.name)
        image_meta = {"image_prompt_model": image_prompt_model, "image_prompt_meta": image_prompt_meta, "image_generation_model": image_model or AI_IMAGE_MODEL, "image_generation_meta": image_meta}

    post_payload = PostCreate(
        brand_id=brand.id,
        campaign_id=campaign.id,
        platform=payload.platform,
        format=payload.format,
        title=generated["title"],
        hook=generated["hook"],
        body=generated["body"],
        cta=generated["cta"],
        hashtags=generated["hashtags"],
        scheduled_at=payload.scheduled_at,
        asset_url=image_url,
        public_notes=json.dumps({"reference_links": generated["reference_links"], "alt_text": generated["alt_text"]}, ensure_ascii=False),
        internal_notes=json.dumps({"workflow": ["litellm_text_generation", "litellm_image_prompt_generation", "image_generation"], "ai_image_prompt": generated["image_prompt"], "ai_text_model": text_model, "ai_text_meta": text_meta, **image_meta}, ensure_ascii=False),
    )
    quality = validate_post_content(post_payload, brand)
    post = None
    if payload.persist:
        post = Post(tenant_id=ctx.tenant_id, created_by=ctx.user_id, quality_check=quality, **post_payload.model_dump())
        db.add(post); db.flush(); create_version(db, post, ctx, "ai_full_post")
    generation = AiGeneration(tenant_id=ctx.tenant_id, user_id=ctx.user_id, brand_id=brand.id, campaign_id=campaign.id, post_id=post.id if post else None, action="full_post", prompt=text_prompt, response=text_reply, model=text_model, metadata_json={"text": text_meta, "image": image_meta, "image_prompt": generated["image_prompt"]})
    db.add(generation); db.commit()
    if post:
        db.refresh(post)
    return ok({"post": to_dict(post) if post else post_payload.model_dump(), "full_post": generated, "image_url": image_url, "generation": to_dict(generation)})


@app.get("/api/v1/posts")
def list_posts(ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db), status_filter: Optional[str] = None):
    stmt = select(Post).where(Post.tenant_id == ctx.tenant_id)
    if status_filter:
        stmt = stmt.where(Post.status == status_filter)
    return ok([to_dict(item) for item in db.scalars(stmt.order_by(Post.created_at.desc())).all()])


@app.post("/api/v1/posts", status_code=201)
def create_post(payload: PostCreate, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    brand = get_brand_or_404(db, ctx, payload.brand_id)
    if payload.campaign_id:
        campaign = get_campaign_or_404(db, ctx, payload.campaign_id)
        if campaign.brand_id != payload.brand_id:
            raise HTTPException(status_code=400, detail={"code": "CAMPAIGN_BRAND_MISMATCH", "message": "A campanha não pertence à marca selecionada."})
    quality = validate_post_content(payload, brand)
    post = Post(tenant_id=ctx.tenant_id, created_by=ctx.user_id, quality_check=quality, **payload.model_dump())
    db.add(post); db.flush(); create_version(db, post, ctx, "initial"); db.commit(); db.refresh(post)
    return ok(to_dict(post))


@app.get("/api/v1/posts/{post_id}")
def get_post(post_id: str, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    return ok(to_dict(get_post_or_404(db, ctx, post_id)))


@app.patch("/api/v1/posts/{post_id}")
def update_post(post_id: str, payload: PostPatch, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    post = get_post_or_404(db, ctx, post_id)
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(post, key, value)
    brand = get_brand_or_404(db, ctx, post.brand_id)
    post.quality_check = validate_post_content(post, brand)
    create_version(db, post, ctx, "human")
    db.commit(); db.refresh(post)
    return ok(to_dict(post))


@app.delete("/api/v1/posts/{post_id}", status_code=204)
def delete_post(post_id: str, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    post = get_post_or_404(db, ctx, post_id)
    delete_post_tree(db, ctx, post)
    db.commit()
    return Response(status_code=204)


@app.post("/api/v1/posts/{post_id}/submit-review")
def submit_review(post_id: str, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    post = get_post_or_404(db, ctx, post_id)
    post.status = "in_review"
    db.commit(); db.refresh(post)
    return ok(to_dict(post))


@app.post("/api/v1/posts/{post_id}/approve")
def approve_post(post_id: str, payload: ApprovalRequest, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    require_reviewer(ctx)
    post = get_post_or_404(db, ctx, post_id)
    previous = post.status
    post.status = "approved"
    post.approved_by = ctx.user_id
    post.approved_at = utcnow()
    db.add(Approval(tenant_id=ctx.tenant_id, post_id=post.id, user_id=ctx.user_id, decision="approved", comment=payload.comment, previous_status=previous, new_status=post.status))
    db.commit(); db.refresh(post)
    return ok(to_dict(post))


@app.post("/api/v1/posts/{post_id}/request-changes")
def request_changes(post_id: str, payload: ApprovalRequest, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    require_reviewer(ctx)
    if not payload.comment.strip():
        raise HTTPException(status_code=400, detail={"code": "COMMENT_REQUIRED", "message": "É obrigatório indicar o motivo das alterações pedidas."})
    post = get_post_or_404(db, ctx, post_id)
    previous = post.status
    post.status = "changes_requested"
    db.add(Approval(tenant_id=ctx.tenant_id, post_id=post.id, user_id=ctx.user_id, decision="changes_requested", comment=payload.comment, previous_status=previous, new_status=post.status))
    db.commit(); db.refresh(post)
    return ok(to_dict(post))


@app.post("/api/v1/posts/{post_id}/mark-ready")
def mark_ready(post_id: str, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    post = get_post_or_404(db, ctx, post_id)
    if post.status not in {"approved", "ready_to_publish"}:
        raise HTTPException(status_code=400, detail={"code": "POST_NOT_APPROVED", "message": "Só publicações aprovadas podem ficar prontas para publicação manual."})
    post.status = "ready_to_publish"
    db.commit(); db.refresh(post)
    return ok(to_dict(post))


@app.post("/api/v1/posts/{post_id}/mark-published")
def mark_published(post_id: str, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    post = get_post_or_404(db, ctx, post_id)
    if post.status not in {"approved", "ready_to_publish", "published_manually"}:
        raise HTTPException(status_code=400, detail={"code": "POST_NOT_READY", "message": "A publicação ainda não está pronta para publicação manual."})
    post.status = "published_manually"
    post.published_manually_at = utcnow()
    db.commit(); db.refresh(post)
    return ok(to_dict(post))


@app.post("/api/v1/posts/{post_id}/duplicate", status_code=201)
def duplicate_post(post_id: str, payload: DuplicatePostRequest, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    original = get_post_or_404(db, ctx, post_id)
    brand = get_brand_or_404(db, ctx, original.brand_id)
    duplicate = Post(
        tenant_id=ctx.tenant_id,
        brand_id=original.brand_id,
        campaign_id=original.campaign_id,
        platform=payload.platform or original.platform,
        format=original.format,
        title=original.title,
        hook=original.hook,
        body=original.body,
        cta=original.cta,
        hashtags=list(original.hashtags or []),
        scheduled_at=payload.scheduled_at or original.scheduled_at,
        status="draft",
        asset_url=original.asset_url,
        public_notes=original.public_notes,
        internal_notes="",
        quality_check={},
        created_by=ctx.user_id,
    )
    duplicate.quality_check = validate_post_content(duplicate, brand)
    db.add(duplicate); db.flush(); create_version(db, duplicate, ctx, "duplicate")
    db.commit(); db.refresh(duplicate)
    return ok(to_dict(duplicate))


@app.get("/api/v1/posts/{post_id}/versions")
def list_versions(post_id: str, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    get_post_or_404(db, ctx, post_id)
    rows = db.scalars(select(PostVersion).where(PostVersion.post_id == post_id, PostVersion.tenant_id == ctx.tenant_id).order_by(PostVersion.version_number.desc())).all()
    return ok([to_dict(row) for row in rows])


@app.get("/api/v1/posts/{post_id}/comments")
def list_comments(post_id: str, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    get_post_or_404(db, ctx, post_id)
    rows = db.scalars(select(Comment).where(Comment.post_id == post_id, Comment.tenant_id == ctx.tenant_id).order_by(Comment.created_at.asc())).all()
    return ok([to_dict(row) for row in rows])


@app.post("/api/v1/posts/{post_id}/comments", status_code=201)
def add_comment(post_id: str, payload: CommentCreate, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    get_post_or_404(db, ctx, post_id)
    comment = Comment(tenant_id=ctx.tenant_id, post_id=post_id, user_id=ctx.user_id, comment=payload.comment, visibility=payload.visibility)
    db.add(comment); db.commit(); db.refresh(comment)
    return ok(to_dict(comment))


@app.get("/api/v1/calendar")
def calendar(ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    rows = db.scalars(select(Post).where(Post.tenant_id == ctx.tenant_id, Post.scheduled_at.isnot(None)).order_by(Post.scheduled_at.asc())).all()
    return ok([to_dict(row) for row in rows])


@app.patch("/api/v1/calendar/posts/{post_id}/schedule")
def schedule_post(post_id: str, payload: dict[str, Any], ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    post = get_post_or_404(db, ctx, post_id)
    post.scheduled_at = payload.get("scheduled_at")
    db.commit(); db.refresh(post)
    return ok(to_dict(post))


@app.post("/api/v1/ai/{action}")
async def ai_action(action: str, payload: AiRequest, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    brand = get_brand_or_404(db, ctx, payload.brand_id) if payload.brand_id else None
    campaign = get_campaign_or_404(db, ctx, payload.campaign_id) if payload.campaign_id else None
    post = get_post_or_404(db, ctx, payload.post_id) if payload.post_id else None
    prompt = build_prompt(action, payload, brand, campaign, post)
    reply, model, metadata = await call_ai_service(ctx, prompt, action)
    generation = AiGeneration(
        tenant_id=ctx.tenant_id,
        user_id=ctx.user_id,
        brand_id=payload.brand_id,
        campaign_id=payload.campaign_id,
        post_id=payload.post_id,
        action=action,
        prompt=prompt,
        response=reply,
        model=model,
        metadata_json=metadata,
    )
    db.add(generation)
    created_ideas: list[Idea] = []
    if action == "ideas" and payload.persist and payload.brand_id:
        for title, description in parse_ai_ideas(reply, payload.number):
            idea = Idea(
                tenant_id=ctx.tenant_id,
                brand_id=payload.brand_id,
                campaign_id=payload.campaign_id,
                title=title,
                description=description,
                source="ai",
                created_by=ctx.user_id,
            )
            db.add(idea)
            created_ideas.append(idea)
    db.commit(); db.refresh(generation)
    for idea in created_ideas:
        db.refresh(idea)
    return ok({"reply": reply, "generation": to_dict(generation), "created_ideas": [to_dict(idea) for idea in created_ideas]})


@app.get("/api/v1/ai/generations")
def list_ai_generations(ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    rows = db.scalars(select(AiGeneration).where(AiGeneration.tenant_id == ctx.tenant_id).order_by(AiGeneration.created_at.desc())).all()
    return ok([to_dict(row) for row in rows])


@app.get("/api/v1/reports/manual")
def list_metrics(ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    rows = db.scalars(select(ManualMetric).where(ManualMetric.tenant_id == ctx.tenant_id).order_by(ManualMetric.created_at.desc())).all()
    return ok([to_dict(row) for row in rows])


@app.post("/api/v1/reports/manual", status_code=201)
def create_metric(payload: ManualMetricCreate, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    get_post_or_404(db, ctx, payload.post_id)
    metric = ManualMetric(tenant_id=ctx.tenant_id, created_by=ctx.user_id, **payload.model_dump())
    db.add(metric); db.commit(); db.refresh(metric)
    return ok(to_dict(metric))


@app.get("/api/v1/reports/manual/{metric_id}")
def get_metric(metric_id: str, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    return ok(to_dict(get_metric_or_404(db, ctx, metric_id)))


@app.patch("/api/v1/reports/manual/{metric_id}")
def update_metric(metric_id: str, payload: ManualMetricPatch, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    metric = get_metric_or_404(db, ctx, metric_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(metric, key, value)
    db.commit(); db.refresh(metric)
    return ok(to_dict(metric))


@app.delete("/api/v1/reports/manual/{metric_id}", status_code=204)
def delete_metric(metric_id: str, ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    metric = get_metric_or_404(db, ctx, metric_id)
    db.delete(metric); db.commit()
    return Response(status_code=204)


@app.get("/api/v1/reports/summary")
def report_summary(group_by: str = "", ctx: ModuleContext = Depends(get_context), db: Session = Depends(get_db)):
    rows = db.scalars(select(ManualMetric).where(ManualMetric.tenant_id == ctx.tenant_id)).all()
    metric_keys = ["reach", "impressions", "likes", "comments_count", "shares", "clicks", "leads"]
    totals = {key: 0 for key in metric_keys}
    by_platform: dict[str, dict[str, int]] = {}
    for row in rows:
        post = db.scalar(select(Post).where(Post.id == row.post_id, Post.tenant_id == ctx.tenant_id))
        platform = post.platform if post else "desconhecida"
        platform_totals = by_platform.setdefault(platform, {key: 0 for key in metric_keys})
        for key in metric_keys:
            value = int(getattr(row, key) or 0)
            totals[key] += value
            platform_totals[key] += value
    return ok({"totals": totals, "records": len(rows), "by_platform": by_platform if group_by == "platform" else {}})


@app.post("/api/v1/exports/token", status_code=201)
def create_export_token(ctx: ModuleContext = Depends(get_context)):
    return ok({"token": export_token_payload(ctx), "expires_in": EXPORT_TOKEN_TTL_SECONDS})


@app.get("/api/v1/exports/csv")
def export_csv(campaign_id: Optional[str] = None, platform: Optional[str] = None, download_token: Optional[str] = None, request: Request = None, db: Session = Depends(get_db)):
    ctx = context_from_export_token(download_token)
    if ctx is None:
        ctx = get_context(request)
    stmt = select(Post).where(Post.tenant_id == ctx.tenant_id, Post.status.in_(["approved", "ready_to_publish"]))
    if campaign_id:
        stmt = stmt.where(Post.campaign_id == campaign_id)
    if platform:
        stmt = stmt.where(Post.platform == platform)
    rows = db.scalars(stmt.order_by(Post.scheduled_at.asc().nullslast())).all()
    output = io.StringIO()
    output.write("\ufeff")
    writer = csv.DictWriter(output, fieldnames=["data_sugerida", "plataforma", "formato", "texto", "hashtags", "cta", "asset", "notas_publicas", "estado"])
    writer.writeheader()
    for post in rows:
        writer.writerow({
            "data_sugerida": csv_safe(post.scheduled_at),
            "plataforma": csv_safe(post.platform),
            "formato": csv_safe(post.format),
            "texto": csv_safe(post.body),
            "hashtags": csv_safe(" ".join(post.hashtags or [])),
            "cta": csv_safe(post.cta),
            "asset": csv_safe(post.asset_url),
            "notas_publicas": csv_safe(post.public_notes),
            "estado": csv_safe(post.status),
        })
    return Response(content=output.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": "attachment; filename=publicacoes-aprovadas.csv"})


@app.exception_handler(HTTPException)
def http_exception_handler(_request: Request, exc: HTTPException):
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "HTTP_ERROR", "message": str(exc.detail)}
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=exc.status_code, content={"success": False, "error": detail})
