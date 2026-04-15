# Via Oceânica AI — Architecture

## Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        nginx (80/443)                            │
│                     Reverse Proxy + SSL                          │
└──────────────────────────┬───────────────────────────────────────┘
                           │
┌──────────────────────────▼───────────────────────────────────────┐
│                     Gateway (3000)                                │
│  - Session validation (JWT)                                      │
│  - Inject x-viao-* headers                                       │
│  - Route to services by path prefix                              │
│  - Module registry lookup                                        │
│  - Rate limiting (Redis)                                         │
└──┬───────────┬───────────┬───────────┬───────────┬──────────────┘
   │           │           │           │           │
   ▼           ▼           ▼           ▼           ▼
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│Platform│ │  AI    │ │Billing │ │  Mod   │ │  Mod   │
│ Core   │ │Service │ │Service │ │Restaur.│ │G.Email │
│ (4000) │ │ (4010) │ │ (4020) │ │ (4001) │ │ (4002) │
└────────┘ └────────┘ └────────┘ └────────┘ └────────┘
     │                     │
     ▼                     ▼
┌─────────────────────────────────────┐
│      PostgreSQL (Supabase)          │
│  platform_db │ billing_db │ mod_*   │
└─────────────────────────────────────┘
```

## Services

| Service | Port | Responsibility |
|---------|------|----------------|
| **nginx** | 80/443 | Reverse proxy, SSL termination, rate limiting |
| **Gateway** | 3000 | Session validation, header injection, routing |
| **Platform Core** | 4000 | Auth, tenants, teams, registry, entitlements |
| **AI Service** | 4010 | AI proxy with metering per tenant/module |
| **Billing** | 4020 | Plans, subscriptions, token management |
| **Shell** | 3001 | Frontend SPA (React + Vite) |
| **Mod Restauração** | 4001 | Restaurant management module |
| **Mod Gestão Email** | 4002 | Email campaign management module |

## Trust Boundary

All inter-service communication uses **trusted headers** injected by the gateway:

| Header | Description |
|--------|-------------|
| `x-viao-user-id` | Authenticated user ID |
| `x-viao-tenant-id` | Company/tenant ID |
| `x-viao-platform-roles` | Platform roles (e.g., "admin") |
| `x-viao-company-roles` | Company roles (e.g., "owner") |
| `x-viao-module-key` | Target module key |
| `x-viao-request-id` | Unique request ID for tracing |

Modules **MUST NOT** implement independent authentication. They trust the gateway headers.

## Module Contract v1

See `contracts/module-contract.md` for the full specification.

Each module:
- Has a `module-manifest.json` describing its capabilities
- Exposes `/health` and `/ready` endpoints
- Receives tenant context via `x-viao-*` headers
- Owns its own database (optional, can share platform_db)
- Calls the centralized AI Service for AI operations

## Database Strategy

- **platform_db**: Users, companies, teams, plans, tokens, registry, entitlements
- **billing_db**: Invoices, payment history (can share platform_db initially)
- **restauracao_db**: Module-specific data (menus, reservations, etc.)
- **gestao_email_db**: Module-specific data (campaigns, lists, templates)

All databases are PostgreSQL hosted on Supabase.

## Deployment

```bash
# Development
docker compose up -d

# Production (with nginx + SSL)
docker compose --profile production up -d
```

See `deploy/env-reference.md` for all required environment variables.

## Adding a New Module

1. Create directory under `modules/<module-key>/`
2. Add `module-manifest.json` following the schema in `contracts/`
3. Implement the module following Module Contract v1
4. Add a Dockerfile
5. Add the service to `docker-compose.yml`
6. Register the module in the gateway route map
7. Register in the platform-core module registry (via API or seed)
