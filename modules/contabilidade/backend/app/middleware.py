"""
Via Oceânica Module Contract v1 — Middleware

Extracts trusted x-viao-* headers injected by the gateway and makes them
available as a thread-local context for all route handlers.

When running standalone (no gateway), falls back to X-Tenant-Id header
or a configurable default tenant for development.
"""
from __future__ import annotations

import contextvars
import os
from dataclasses import dataclass
from typing import Optional

from fastapi import Request, HTTPException
from starlette.middleware.base import BaseHTTPMiddleware

# ─── Context ─────────────────────────────────────────────────────────

@dataclass
class ModuleContext:
    user_id: str
    tenant_id: str
    session_id: str
    platform_roles: str
    module_entitlements: str
    request_id: str


_current_context: contextvars.ContextVar[Optional[ModuleContext]] = contextvars.ContextVar(
    "viao_module_context", default=None
)

DEFAULT_TENANT = os.getenv("DEFAULT_TENANT_ID", "demo")


def get_module_context() -> ModuleContext:
    """Return the current request's module context, or raise 401."""
    ctx = _current_context.get()
    if ctx is None:
        raise HTTPException(status_code=401, detail="Missing module context (x-viao-* headers)")
    return ctx


def get_tenant_id() -> str:
    """Shortcut: return the current tenant_id from context."""
    return get_module_context().tenant_id


# ─── Middleware ───────────────────────────────────────────────────────

# Paths that don't require authentication context
PUBLIC_PATHS = frozenset(["/health", "/ready", "/api/health", "/api/ready"])


class ViaoContextMiddleware(BaseHTTPMiddleware):
    """
    Extracts x-viao-* headers from the gateway and stores them in a
    context variable accessible by all downstream handlers.

    For standalone/dev mode, falls back to X-Tenant-Id header or DEFAULT_TENANT.
    """

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # Skip context for health/ready checks
        if path in PUBLIC_PATHS:
            return await call_next(request)

        # Try gateway headers first
        user_id = request.headers.get("x-viao-user-id", "")
        tenant_id = request.headers.get("x-viao-tenant-id", "")
        session_id = request.headers.get("x-viao-session-id", "")
        platform_roles = request.headers.get("x-viao-platform-roles", "")
        module_entitlements = request.headers.get("x-viao-module-entitlements", "")
        request_id = request.headers.get("x-viao-request-id", "")

        # Fallback: standalone mode — use X-Tenant-Id or default
        if not tenant_id:
            tenant_id = request.headers.get("x-tenant-id", "") or DEFAULT_TENANT

        if not user_id:
            user_id = "0"  # Anonymous in standalone mode

        ctx = ModuleContext(
            user_id=user_id,
            tenant_id=tenant_id,
            session_id=session_id or request_id or "unknown",
            platform_roles=platform_roles,
            module_entitlements=module_entitlements,
            request_id=request_id or "unknown",
        )

        token = _current_context.set(ctx)
        try:
            response = await call_next(request)
            return response
        finally:
            _current_context.reset(token)
