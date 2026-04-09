"""
Via Oceânica AI — Módulo Contabilidade (Module Contract v1 wrapper)

This wraps the existing ViaContab FastAPI app to comply with the module contract:
1. /health and /ready at root level (module contract)
2. x-viao-* headers middleware for tenant context
3. The original routes remain at /api/tenants/{tenant_id}/... for backward compatibility
4. The gateway routes: /api/module/contabilidade/* → mod-contabilidade:4003/api/v1/*
   So the gateway path /api/module/contabilidade/tenants/{tid}/invoices
   arrives here as /api/v1/tenants/{tid}/invoices

Strategy: We import the original app and add module contract endpoints + middleware to it.
The original app already has /api/health and /api/ready, we add /health and /ready at root.
We add a route prefix alias: /api/v1/* that maps to the same handlers as /api/*.
"""
from __future__ import annotations

import time
from collections import defaultdict
from fastapi import Depends, Request, Response
from fastapi.routing import APIRoute
from sqlalchemy import text

from .main import app  # Import the original ViaContab app
from .database import get_session
from .middleware import ViaoContextMiddleware

_start_time = time.time()

# ─── Add x-viao-* context middleware ─────────────────────────────────
app.add_middleware(ViaoContextMiddleware)

# ─── Module Contract: /health and /ready at root ─────────────────────

@app.get("/health", tags=["module-contract"])
def module_health():
    return {
        "status": "ok",
        "service": "mod-contabilidade",
        "version": "1.0.0",
        "uptime_seconds": int(time.time() - _start_time),
    }

@app.get("/ready", tags=["module-contract"])
def module_ready(session=Depends(get_session)):
    session.execute(text("SELECT 1"))
    return {
        "status": "ready",
        "dependencies": {"database": "ok"},
    }

# ─── Route Aliases: /api/v1/* → same handlers as /api/* ─────────────
# The gateway does: /api/module/contabilidade/X → /api/v1/X
# So we need /api/v1/tenants/{tid}/invoices to work.
# We duplicate existing routes with /api/v1 prefix, preserving ALL methods.

# Collect all routes per path to handle multi-method endpoints
_path_routes: dict[str, list[APIRoute]] = defaultdict(list)
for route in list(app.routes):
    if isinstance(route, APIRoute) and route.path.startswith("/api/"):
        _path_routes[route.path].append(route)

# Track already-added v1 paths to avoid duplicates
_existing_v1_paths: set[tuple[str, frozenset[str]]] = set()
for route in app.routes:
    if isinstance(route, APIRoute) and route.path.startswith("/api/v1/"):
        methods = frozenset(route.methods) if route.methods else frozenset(["GET"])
        _existing_v1_paths.add((route.path, methods))

for original_path, routes in _path_routes.items():
    new_path = "/api/v1" + original_path[4:]  # /api/foo → /api/v1/foo
    for route in routes:
        methods = frozenset(route.methods) if route.methods else frozenset(["GET"])
        key = (new_path, methods)
        if key not in _existing_v1_paths:
            app.add_api_route(
                new_path,
                route.endpoint,
                methods=list(methods),
                response_model=route.response_model,
                tags=route.tags or ["v1-alias"],
                dependencies=route.dependencies,
            )
            _existing_v1_paths.add(key)

# ─── Override the app title ──────────────────────────────────────────
app.title = "Via Oceânica — Módulo Contabilidade"
app.version = "1.0.0"
