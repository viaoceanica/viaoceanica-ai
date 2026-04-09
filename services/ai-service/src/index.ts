/**
 * Via Oceânica AI — Centralized AI Service
 *
 * Responsibilities:
 * 1. Proxy AI requests to upstream providers (OpenAI, etc.)
 * 2. Meter token usage per tenant and per module
 * 3. Enforce rate limits and quotas
 * 4. Log all AI interactions for audit
 * 5. Provide a unified API for all modules
 */

import express from "express";
import { createServer } from "http";
import cors from "cors";

const PORT = parseInt(process.env.AI_SERVICE_PORT || "4010");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ─── Health ─────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "ai-service", timestamp: new Date().toISOString() });
});

app.get("/ready", (_req, res) => {
  res.json({ status: "ready", dependencies: { upstream_ai: "ok" } });
});

// ─── Middleware: Extract tenant context ─────────────────────────────

interface TenantContext {
  userId: number;
  tenantId: number;
  moduleKey?: string;
  requestId: string;
}

function extractContext(req: express.Request): TenantContext | null {
  const userId = req.headers["x-viao-user-id"];
  const tenantId = req.headers["x-viao-tenant-id"];
  const requestId = (req.headers["x-viao-request-id"] as string) || "unknown";

  if (!userId || !tenantId) return null;

  return {
    userId: Number(userId),
    tenantId: Number(tenantId),
    moduleKey: req.headers["x-viao-module-key"] as string | undefined,
    requestId,
  };
}

// ─── POST /api/v1/chat/completions — Metered chat completion ────────

app.post("/api/v1/chat/completions", async (req, res) => {
  const ctx = extractContext(req);
  if (!ctx) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Missing tenant context" } });
  }

  try {
    const { messages, model, temperature, max_tokens, response_format } = req.body;

    // TODO: Check tenant quota before proceeding
    // TODO: Call upstream AI provider
    // TODO: Meter token usage
    // TODO: Log interaction

    // Placeholder response
    return res.json({
      success: true,
      data: {
        id: `chat-${ctx.requestId}`,
        choices: [
          {
            message: {
              role: "assistant",
              content: "[AI Service] Placeholder — upstream provider not yet configured.",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
        metering: {
          tenant_id: ctx.tenantId,
          module_key: ctx.moduleKey || "platform",
          tokens_consumed: 0,
          tokens_remaining: -1, // -1 = unlimited / not yet enforced
        },
      },
    });
  } catch (error) {
    console.error("[AI Service] Chat completion error:", error);
    return res.status(500).json({ success: false, error: { code: "AI_ERROR", message: "Erro no serviço de IA" } });
  }
});

// ─── POST /api/v1/embeddings — Metered embeddings ───────────────────

app.post("/api/v1/embeddings", async (req, res) => {
  const ctx = extractContext(req);
  if (!ctx) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED" } });
  }

  // TODO: Implement embeddings proxy with metering
  return res.json({
    success: true,
    data: {
      embeddings: [],
      metering: { tenant_id: ctx.tenantId, tokens_consumed: 0 },
    },
  });
});

// ─── POST /api/v1/images/generate — Metered image generation ────────

app.post("/api/v1/images/generate", async (req, res) => {
  const ctx = extractContext(req);
  if (!ctx) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED" } });
  }

  // TODO: Implement image generation proxy with metering
  return res.json({
    success: true,
    data: {
      images: [],
      metering: { tenant_id: ctx.tenantId, tokens_consumed: 0 },
    },
  });
});

// ─── GET /api/v1/usage — Tenant usage stats ─────────────────────────

app.get("/api/v1/usage", async (req, res) => {
  const ctx = extractContext(req);
  if (!ctx) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED" } });
  }

  // TODO: Query metering database for tenant usage
  return res.json({
    success: true,
    data: {
      tenant_id: ctx.tenantId,
      period: "current_month",
      total_tokens: 0,
      by_module: {},
      by_user: {},
    },
  });
});

// ─── Start ──────────────────────────────────────────────────────────

const server = createServer(app);

server.listen(PORT, () => {
  console.log(`[AI Service] Running on http://localhost:${PORT}`);
});

export { app };
