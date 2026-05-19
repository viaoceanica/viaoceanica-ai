// src/index.ts
import express from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { createServer } from "http";
import { parse as parseCookie } from "cookie";
import { jwtVerify } from "jose";
import { nanoid } from "nanoid";
import { createClient } from "redis";
var PORT = parseInt(process.env.GATEWAY_PORT || "3000");
var JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "change-me");
var COOKIE_NAME = process.env.COOKIE_NAME || "app_session_id";
var REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
var PLATFORM_CORE_URL = process.env.PLATFORM_CORE_URL || "http://platform-core:4000";
var AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://ai-service:4010";
var BILLING_SERVICE_URL = process.env.BILLING_SERVICE_URL || "http://billing:4020";
function getModuleUrl(moduleKey) {
  const envKey = `MOD_${moduleKey.toUpperCase().replace(/-/g, "_")}_URL`;
  return process.env[envKey];
}
function getModuleFrontendUrl(moduleKey) {
  const envKey = `MOD_${moduleKey.toUpperCase().replace(/-/g, "_")}_FRONTEND_URL`;
  return process.env[envKey] || `http://${moduleKey}-frontend:3000`;
}
var redis = null;
async function getRedis() {
  if (!redis) {
    redis = createClient({ url: REDIS_URL });
    redis.on("error", (err) => console.error("[Gateway] Redis error:", err));
    await redis.connect();
  }
  return redis;
}
async function validateSession(cookieHeader) {
  if (!cookieHeader) return null;
  const cookies = parseCookie(cookieHeader);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    const r = await getRedis();
    const cached = await r.get(`session:${token.slice(-16)}`);
    if (cached) return JSON.parse(cached);
    const { payload } = await jwtVerify(token, JWT_SECRET, { algorithms: ["HS256"] });
    const session = {
      userId: payload.userId,
      email: payload.email,
      name: payload.name || "",
      tenantId: payload.tenantId,
      platformRole: payload.platformRole,
      companyRole: payload.companyRole
    };
    await r.setEx(`session:${token.slice(-16)}`, 300, JSON.stringify(session));
    return session;
  } catch {
    return null;
  }
}
async function resolveTenantContext(session, requestId) {
  return {
    userId: String(session.userId),
    tenantId: String(session.tenantId || 0),
    sessionId: requestId,
    platformRoles: session.platformRole || "user",
    companyRole: session.companyRole || "member",
    moduleEntitlements: ""
    // Resolved by platform-core entitlements service
  };
}
var app = express();
app.set("trust proxy", true);
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "gateway", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
});
var PUBLIC_PATHS = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/auth/verify-reset-token",
  "/health",
  "/ready"
];
app.use(async (req, res, next) => {
  const requestId = nanoid(12);
  req.headers["x-viao-request-id"] = requestId;
  if (PUBLIC_PATHS.some((p) => req.path.startsWith(p))) {
    return next();
  }
  if (req.path.match(/\.(js|css|png|jpg|svg|ico|woff2?)$/)) {
    return next();
  }
  const session = await validateSession(req.headers.cookie);
  if (!session) {
    if (req.path.startsWith("/api/")) {
      return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Session invalid or expired" } });
    }
    return next();
  }
  const ctx = await resolveTenantContext(session, requestId);
  req.headers["x-viao-user-id"] = ctx.userId;
  req.headers["x-viao-tenant-id"] = ctx.tenantId;
  req.headers["x-viao-session-id"] = ctx.sessionId;
  req.headers["x-viao-platform-roles"] = ctx.platformRoles;
  req.headers["x-viao-company-role"] = ctx.companyRole;
  req.headers["x-viao-module-entitlements"] = ctx.moduleEntitlements;
  next();
});
app.use(
  "/api/platform",
  createProxyMiddleware({
    target: PLATFORM_CORE_URL,
    changeOrigin: true,
    pathRewrite: (_path) => `/api/v1${_path}`
  })
);
app.use(
  "/api/auth",
  createProxyMiddleware({
    target: PLATFORM_CORE_URL,
    changeOrigin: true,
    pathRewrite: (_path) => `/api/auth${_path}`
  })
);
app.use(
  "/api/ai",
  createProxyMiddleware({
    target: AI_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: (_path) => `/api/v1${_path}`
  })
);
app.use(
  "/api/billing",
  createProxyMiddleware({
    target: BILLING_SERVICE_URL,
    changeOrigin: true,
    pathRewrite: (_path) => `/api/v1${_path}`
  })
);
app.use("/api/module/:moduleKey", async (req, res, next) => {
  const moduleKey = req.params.moduleKey;
  const targetUrl = getModuleUrl(moduleKey);
  if (!targetUrl) {
    return res.status(404).json({
      success: false,
      error: { code: "MODULE_NOT_FOUND", message: `Module '${moduleKey}' is not registered or not running` }
    });
  }
  const tenantId = req.headers["x-viao-tenant-id"];
  if (tenantId && tenantId !== "0") {
    try {
      const checkUrl = `${PLATFORM_CORE_URL}/api/v1/entitlements/check?tenantId=${tenantId}&moduleKey=${moduleKey}`;
      const checkRes = await fetch(checkUrl);
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        if (checkData.success && !checkData.data?.enabled) {
          return res.status(403).json({
            success: false,
            error: { code: "MODULE_DISABLED", message: `Module '${moduleKey}' is not enabled for your company` }
          });
        }
      }
    } catch {
      console.warn(`[Gateway] Entitlement check failed for module '${moduleKey}', allowing through (fail-open)`);
    }
  }
  return createProxyMiddleware({
    target: targetUrl,
    changeOrigin: true,
    pathRewrite: (_path) => `/api/v1${_path}`
  })(req, res, next);
});
app.use("/module/:moduleKey", async (req, res, next) => {
  const moduleKey = req.params.moduleKey;
  const targetUrl = getModuleFrontendUrl(moduleKey);
  if (!targetUrl) {
    return res.status(404).json({
      success: false,
      error: { code: "MODULE_NOT_FOUND", message: `Module frontend '${moduleKey}' is not registered or not running` }
    });
  }
  return createProxyMiddleware({
    target: targetUrl,
    changeOrigin: true,
    ws: true
  })(req, res, next);
});
var SHELL_URL = process.env.SHELL_URL || "http://shell:3001";
app.use(
  createProxyMiddleware({
    target: SHELL_URL,
    changeOrigin: true,
    ws: true
    // WebSocket support for HMR
  })
);
var server = createServer(app);
server.listen(PORT, () => {
  console.log(`[Gateway] Running on http://localhost:${PORT}`);
  console.log(`[Gateway] Platform Core \u2192 ${PLATFORM_CORE_URL}`);
  console.log(`[Gateway] AI Service \u2192 ${AI_SERVICE_URL}`);
});
export {
  app
};
