"""
Via Oceânica AI — Módulo Helpdesk (Module Contract v1)

Phase 1 integration parity with ViaContab:
- Root /health and /ready endpoints
- Trusted x-viao-* header extraction with standalone fallback
- /api/v1 routes for gateway compatibility
- Basic tenant/admin-safe diagnostics surface
"""
from __future__ import annotations

import contextvars
import logging
import os
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from ai_client import ask_assistant

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("helpdesk")

PORT = int(os.getenv("MOD_HELPDESK_PORT", "4001"))
DATABASE_URL = os.getenv("DATABASE_URL", "")
AI_AGENT_ID = os.getenv("AI_AGENT_ID", "helpdesk")
DEFAULT_TENANT = os.getenv("DEFAULT_TENANT_ID", "demo")
_start_time = time.time()


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


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("[helpdesk] Starting on port %s", PORT)
    yield
    logger.info("[helpdesk] Shutting down")


app = FastAPI(
    title="Via Oceânica — Módulo Helpdesk",
    description="Helpdesk module contract wrapper",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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

    if ctx.company_role not in {"owner", "admin"}:
        raise HTTPException(status_code=403, detail="Acesso reservado a administradores da empresa")

    return ctx


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
        "version": "1.0.0",
        "uptime_seconds": int(time.time() - _start_time),
    }


@app.get("/ready", tags=["module-contract"])
async def ready():
    database_state = "configured" if DATABASE_URL else "not-configured"
    return {"status": "ready", "dependencies": {"database": database_state}}


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


@app.get("/api/v1/tenants/{tenant_id}/admin/summary")
async def admin_summary(tenant_id: str):
    ctx = require_tenant_admin(tenant_id)
    return {
        "success": True,
        "data": {
            "module": "helpdesk",
            "tenant_id": tenant_id,
            "admin_access": True,
            "company_role": ctx.company_role,
            "platform_roles": ctx.platform_roles,
            "message": "Área de administração do Helpdesk pronta para expansão",
        },
    }


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
