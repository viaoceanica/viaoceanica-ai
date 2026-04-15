# ADR-001: Microservices Architecture with API Gateway

**Status:** Accepted  
**Date:** 2026-04-09  
**Authors:** Via Oceânica AI Team

## Context

The Via Oceânica AI platform needs to serve multiple independent business modules (Contabilidade, Restauração, Gestão Email) to different tenants. Each module has distinct domain logic, data models, and scaling requirements. The platform also requires centralized authentication, billing, and AI services shared across all modules.

## Decision

We adopt a **microservices architecture** with an API Gateway pattern. Each module runs as an independent Docker container with its own codebase and database tables. A centralized gateway handles routing, authentication, and tenant context injection.

## Architecture

| Component | Role | Port | Technology |
|-----------|------|------|------------|
| nginx | Reverse proxy, TLS termination, rate limiting | 80/443 | Nginx Alpine |
| gateway | API routing, auth, tenant context injection | 3000 | Node.js + Express |
| platform-core | Users, teams, companies, auth, password reset | 4000 | Node.js + Express + Drizzle |
| ai-service | Centralized AI proxy with metering | 4010 | Node.js + Express + pg |
| billing | Billing profiles, invoices, token management | 4020 | Node.js + Express |
| mod-restauracao | Restaurant management module | 4001 | Node.js + Express |
| mod-gestao-email | Email campaign management module | 4002 | Node.js + Express |
| mod-contabilidade | Accounting/bookkeeping module (Python) | 4003 | Python + FastAPI |
| shell | Frontend SPA | 3001 | React + Vite (static) |
| contabilidade-frontend | ViaContab frontend (iframe) | 7100 | Next.js |

## Consequences

**Positive:** Independent scaling per module, technology flexibility (Python for contabilidade), isolated failure domains, clear ownership boundaries.

**Negative:** Increased operational complexity, inter-service communication overhead, need for distributed tracing (future), more complex local development setup.

## Alternatives Considered

1. **Monolithic application** — rejected due to scaling limitations and module independence requirements.
2. **Serverless functions** — rejected due to cold start latency concerns and need for persistent connections to databases and vector stores.

---

# ADR-002: Multi-Tenant Architecture with Shared Database

**Status:** Accepted  
**Date:** 2026-04-09

## Context

The platform serves multiple companies (tenants). Each tenant should have isolated data while sharing the same infrastructure to minimize operational costs.

## Decision

We use a **shared database with tenant_id column isolation**. All tenant-scoped tables include a `tenant_id` column, and all queries are filtered by tenant. The gateway injects `x-viao-tenant-id` headers from the authenticated session.

## Consequences

**Positive:** Lower infrastructure cost, simpler backup/restore, easier schema migrations across all tenants.

**Negative:** Requires disciplined query patterns (always filter by tenant_id), risk of data leakage if queries miss the tenant filter, no per-tenant database-level isolation.

## Mitigations

All module middleware extracts and validates `x-viao-tenant-id` from trusted gateway headers. Database queries use parameterized tenant filters. Future: row-level security policies in PostgreSQL.

---

# ADR-003: Centralized AI Service with Usage Metering

**Status:** Accepted  
**Date:** 2026-04-09

## Context

Multiple modules need AI capabilities (LLM, embeddings, image generation). Direct API calls from each module would make it difficult to track usage, enforce quotas, and manage costs.

## Decision

All AI operations go through a centralized **ai-service** that proxies requests to upstream providers (OpenAI), meters token usage per tenant and module, estimates costs, and stores usage events in `ai_usage_events` and monthly summaries in `ai_usage_summaries`.

## Cost Model

| Model | Input ($/1K tokens) | Output ($/1K tokens) |
|-------|---------------------|----------------------|
| gpt-4o | 0.0025 | 0.01 |
| gpt-4o-mini | 0.00015 | 0.0006 |
| text-embedding-3-small | 0.00002 | — |
| dall-e-3 (standard) | $0.04/image | — |

## Consequences

**Positive:** Single point for quota enforcement, cost tracking, provider switching, audit logging.

**Negative:** Additional network hop for AI calls, single point of failure for AI operations (mitigated by health checks and restart policies).

---

# ADR-004: Module Contract and Communication Pattern

**Status:** Accepted  
**Date:** 2026-04-09

## Context

Modules need a standardized way to communicate with the platform and with each other.

## Decision

We define a **Module Contract v1** that all modules must follow:

1. **No independent authentication** — modules trust gateway-injected headers (`x-viao-user-id`, `x-viao-tenant-id`, `x-viao-request-id`, `x-viao-module-key`).
2. **Health endpoints** — every module exposes `GET /health` and `GET /ready`.
3. **API versioning** — all module APIs are under `/api/v1/`.
4. **Tenant isolation** — all data operations are scoped by `tenant_id`.
5. **AI calls** — modules call the centralized ai-service, never upstream providers directly.

## Consequences

**Positive:** Consistent security model, simplified module development, clear boundaries.

**Negative:** Modules cannot function independently outside the platform (by design).

---

# ADR-005: SMTP Email Service for Transactional Emails

**Status:** Accepted  
**Date:** 2026-04-09

## Context

The platform needs to send transactional emails (password recovery, notifications). A reliable email delivery mechanism is required.

## Decision

We use **Nodemailer with SMTP** (mail.viaoceanica.com:587 with STARTTLS) for transactional emails. The email service is integrated into platform-core and sends HTML-formatted emails with Via Oceânica branding.

## Consequences

**Positive:** Direct control over email delivery, no third-party email API dependency, branded email templates.

**Negative:** SMTP deliverability depends on DNS/SPF/DKIM configuration, no built-in bounce handling (future improvement).
