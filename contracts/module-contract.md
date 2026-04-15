# Module Contract v1 — Via Oceânica AI Platform

This document defines the standard contract that every module (standard or custom) must conform to in order to be registered, deployed, and operated within the Via Oceânica AI platform.

## 1. Module Manifest

Every module must provide a manifest file (`module-manifest.json`) at its root. The platform registry consumes this manifest during module onboarding.

### Required Fields

| Field | Type | Description |
|---|---|---|
| `module_key` | string | Unique identifier (lowercase, kebab-case). Example: `restauracao` |
| `name` | string | Human-readable display name. Example: `Restauração` |
| `version` | string | Semantic version. Example: `1.0.0` |
| `description` | string | Short description of the module's purpose |
| `route` | string | Frontend route prefix. Example: `/module/restauracao` |
| `frontend_mount_type` | enum | `iframe` or `microfrontend` or `internal` |
| `backend_service_url` | string | Internal Docker network URL. Example: `http://mod-restauracao:4001` |
| `health_endpoint` | string | Health check path. Default: `/health` |
| `readiness_endpoint` | string | Readiness check path. Default: `/ready` |
| `status` | enum | `active`, `maintenance`, `deprecated` |
| `icon` | string | Lucide icon name for sidebar display |
| `capabilities` | string[] | List of capabilities: `ai`, `storage`, `notifications` |
| `min_plan` | string | Minimum plan required. `null` for all plans |
| `tenant_restricted` | boolean | If true, only available to named tenants |

## 2. API Contract

### 2.1 Required Endpoints

Every module backend must expose:

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Returns `{ "status": "ok" }` with 200, or 503 if unhealthy |
| `/ready` | GET | Returns `{ "status": "ready" }` with 200 when ready to serve traffic |
| `/api/v1/*` | * | Module business API under versioned prefix |

### 2.2 Request Headers (Trusted Context)

The gateway forwards these headers on every request. Modules must NOT authenticate users independently.

| Header | Type | Description |
|---|---|---|
| `x-viao-user-id` | string | Authenticated user ID |
| `x-viao-tenant-id` | string | Active tenant (company) ID |
| `x-viao-session-id` | string | Platform session ID |
| `x-viao-platform-roles` | string | Comma-separated platform roles |
| `x-viao-module-entitlements` | string | Comma-separated entitled module keys |
| `x-viao-request-id` | string | Unique request trace ID |

### 2.3 Response Standards

All API responses must follow:

```json
{
  "success": true,
  "data": { ... }
}
```

Error responses:

```json
{
  "success": false,
  "error": {
    "code": "MODULE_ERROR_CODE",
    "message": "Human-readable message"
  }
}
```

## 3. Auth Context Contract

Modules receive pre-authenticated context from the gateway. The trust boundary is:

1. User authenticates with the platform (shell/gateway).
2. Gateway validates session and resolves tenant, roles, and entitlements.
3. Gateway forwards trusted headers to the module.
4. Module performs domain-specific authorization for fine-grained actions.

Modules must NOT:
- Implement independent login flows.
- Read or write session cookies.
- Call external identity providers directly.

Modules MAY:
- Define module-scoped permissions for fine-grained business actions.
- Maintain a local permissions table for domain-specific access control.

## 4. Frontend Mount Contract

### 4.1 Mount Types

| Type | Description |
|---|---|
| `iframe` | Module frontend loaded in an iframe within the shell |
| `microfrontend` | Module frontend loaded as a JS bundle into the shell |
| `internal` | Module UI is part of the shell codebase (for platform-owned modules) |

### 4.2 Shell Communication

The shell provides to mounted module frontends:
- Active tenant context
- Authenticated user context
- Theme tokens (CSS custom properties)
- Navigation API for cross-module routing

## 5. Health and Readiness Contract

### 5.1 Health Check (`/health`)

Returns the operational status of the module. Used by Docker and the platform for liveness monitoring.

```json
{ "status": "ok", "version": "1.0.0", "uptime_seconds": 12345 }
```

### 5.2 Readiness Check (`/ready`)

Returns whether the module is ready to accept traffic. Used during startup and rolling deployments.

```json
{ "status": "ready", "dependencies": { "database": "ok", "cache": "ok" } }
```

## 6. Observability Contract

Every module must:
- Log to stdout/stderr in structured JSON format.
- Include `request_id`, `tenant_id`, and `module_key` in all log entries.
- Expose basic metrics (request count, latency, error rate) via `/metrics` if applicable.

## 7. Database Ownership

- Each module owns its own database(s).
- No direct cross-module database access.
- Cross-module interaction happens through APIs only.
- Each module owns its migrations, backup strategy, and restore procedure.

## 8. AI Service Integration

- Modules must call the centralized platform AI service for AI operations.
- Direct calls to AI providers are not permitted.
- The AI service handles metering, policy, and cost control.

## 9. Docker Contract

- Every module runs in its own Docker container.
- Dockerfile must declare CPU and memory requests/limits.
- Health checks must be defined in the Dockerfile or docker-compose.
- Stateful data must be externalized (PostgreSQL, Redis, S3).
- No persistent state inside the container filesystem.
