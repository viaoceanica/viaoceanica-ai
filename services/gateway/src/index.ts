/**
 * Via Oceânica AI — API Gateway
 *
 * Responsibilities:
 * 1. Validate session (JWT cookie) on every request
 * 2. Resolve tenant context (company, roles, entitlements)
 * 3. Inject trusted x-viao-* headers
 * 4. Proxy requests to platform-core or module backends
 * 5. Rate limiting and request tracing
 */

import express from "express";
import { createProxyMiddleware, Options } from "http-proxy-middleware";
import { createServer } from "http";
import { parse as parseCookie } from "cookie";
import { jwtVerify } from "jose";
import { nanoid } from "nanoid";
import { createClient } from "redis";

// ─── Config ─────────────────────────────────────────────────────────

const PORT = parseInt(process.env.GATEWAY_PORT || "3000");
const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "change-me");
const COOKIE_NAME = process.env.COOKIE_NAME || "app_session_id";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

const PLATFORM_CORE_URL = process.env.PLATFORM_CORE_URL || "http://platform-core:4000";
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://ai-service:4010";
const BILLING_SERVICE_URL = process.env.BILLING_SERVICE_URL || "http://billing:4020";

// Module backends are resolved dynamically from the registry
// Format: MOD_<MODULE_KEY_UPPER>_URL=http://mod-restauracao:4001
function getModuleUrl(moduleKey: string): string | undefined {
  const envKey = `MOD_${moduleKey.toUpperCase().replace(/-/g, "_")}_URL`;
  return process.env[envKey];
}

// ─── Redis Client (for session cache & rate limiting) ───────────────

let redis: ReturnType<typeof createClient> | null = null;

async function getRedis() {
  if (!redis) {
    redis = createClient({ url: REDIS_URL });
    redis.on("error", (err) => console.error("[Gateway] Redis error:", err));
    await redis.connect();
  }
  return redis;
}

// ─── Session Validation ─────────────────────────────────────────────

interface SessionPayload {
  userId: number;
  email: string;
  name: string;
  tenantId?: number;
  platformRole?: string;
  companyRole?: string;
}

async function validateSession(cookieHeader: string | undefined): Promise<SessionPayload | null> {
  if (!cookieHeader) return null;

  const cookies = parseCookie(cookieHeader);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;

  try {
    // Check Redis cache first
    const r = await getRedis();
    const cached = await r.get(`session:${token.slice(-16)}`);
    if (cached) return JSON.parse(cached);

    // Verify JWT
    const { payload } = await jwtVerify(token, JWT_SECRET, { algorithms: ["HS256"] });
    const session: SessionPayload = {
      userId: payload.userId as number,
      email: payload.email as string,
      name: (payload.name as string) || "",
      tenantId: payload.tenantId as number | undefined,
      platformRole: payload.platformRole as string | undefined,
      companyRole: payload.companyRole as string | undefined,
    };

    // Cache for 5 minutes
    await r.setEx(`session:${token.slice(-16)}`, 300, JSON.stringify(session));
    return session;
  } catch {
    return null;
  }
}

// ─── Tenant Context Resolution ──────────────────────────────────────

interface TenantContext {
  userId: string;
  tenantId: string;
  sessionId: string;
  platformRoles: string;
  moduleEntitlements: string;
}

async function resolveTenantContext(session: SessionPayload, requestId: string): Promise<TenantContext> {
  // In production, this would call platform-core to resolve full context
  // For now, we derive from the JWT payload
  return {
    userId: String(session.userId),
    tenantId: String(session.tenantId || 0),
    sessionId: requestId,
    platformRoles: session.platformRole || "user",
    moduleEntitlements: "", // Resolved by platform-core entitlements service
  };
}

// ─── Gateway App ────────────────────────────────────────────────────

const app = express();

// Trust proxy for x-forwarded-* headers
app.set("trust proxy", true);

// Health check (no auth required)
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "gateway", timestamp: new Date().toISOString() });
});

// ─── Auth Middleware ─────────────────────────────────────────────────

// Public routes that don't require authentication
const PUBLIC_PATHS = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/forgot-password",
  "/health",
  "/ready",
];

app.use(async (req, res, next) => {
  const requestId = nanoid(12);
  req.headers["x-viao-request-id"] = requestId;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => req.path.startsWith(p))) {
    return next();
  }

  // Allow static assets
  if (req.path.match(/\.(js|css|png|jpg|svg|ico|woff2?)$/)) {
    return next();
  }

  // Validate session
  const session = await validateSession(req.headers.cookie);

  if (!session) {
    // For API requests, return 401
    if (req.path.startsWith("/api/")) {
      return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Session invalid or expired" } });
    }
    // For page requests, let the shell handle the redirect
    return next();
  }

  // Resolve tenant context
  const ctx = await resolveTenantContext(session, requestId);

  // Inject trusted headers
  req.headers["x-viao-user-id"] = ctx.userId;
  req.headers["x-viao-tenant-id"] = ctx.tenantId;
  req.headers["x-viao-session-id"] = ctx.sessionId;
  req.headers["x-viao-platform-roles"] = ctx.platformRoles;
  req.headers["x-viao-module-entitlements"] = ctx.moduleEntitlements;

  next();
});

// ─── Route Proxying ─────────────────────────────────────────────────

// Platform Core API
app.use(
  "/api/platform",
  createProxyMiddleware({
    target: PLATFORM_CORE_URL,
    changeOrigin: true,
    pathRewrite: { "^/api/platform": "/api/v1" },
  } as Options)
);

// Auth routes → Platform Core
app.use(
  "/api/auth",
  createProxyMiddleware({
    target: PLATFORM_CORE_URL,
    changeOrigin: true,
    pathRewrite: { "^/api/auth": "/api/auth" },
  } as Options)
);

// AI Service
app.use(
  "/api/ai",
  createProxyMiddleware({
    target: AI_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/api/ai": "/api/v1" },
  } as Options)
);

// Billing Service
app.use(
  "/api/billing",
  createProxyMiddleware({
    target: BILLING_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: { "^/api/billing": "/api/v1" },
  } as Options)
);

// Module API routes: /api/module/<module_key>/* → module backend
app.use("/api/module/:moduleKey", (req, res, next) => {
  const moduleKey = req.params.moduleKey;
  const targetUrl = getModuleUrl(moduleKey);

  if (!targetUrl) {
    return res.status(404).json({
      success: false,
      error: { code: "MODULE_NOT_FOUND", message: `Module '${moduleKey}' is not registered or not running` },
    });
  }

  return createProxyMiddleware({
    target: targetUrl,
    changeOrigin: true,
    pathRewrite: { [`^/api/module/${moduleKey}`]: "/api/v1" },
  } as Options)(req, res, next);
});

// ─── Shell (SPA Fallback) ───────────────────────────────────────────
// In production, the shell is served by nginx.
// In development, this proxies to the shell dev server.

const SHELL_URL = process.env.SHELL_URL || "http://shell:3001";

app.use(
  createProxyMiddleware({
    target: SHELL_URL,
    changeOrigin: true,
    ws: true, // WebSocket support for HMR
  } as Options)
);

// ─── Start ──────────────────────────────────────────────────────────

const server = createServer(app);

server.listen(PORT, () => {
  console.log(`[Gateway] Running on http://localhost:${PORT}`);
  console.log(`[Gateway] Platform Core → ${PLATFORM_CORE_URL}`);
  console.log(`[Gateway] AI Service → ${AI_SERVICE_URL}`);
});

export { app };
