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
import pg from "pg";

const PORT = parseInt(process.env.AI_SERVICE_PORT || "4010");
const DATABASE_URL = process.env.DATABASE_URL || "";
const AI_API_KEY = process.env.AI_PROVIDER_API_KEY || "";
const AI_BASE_URL = process.env.AI_PROVIDER_BASE_URL || "https://api.openai.com/v1";

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ─── Database Pool ──────────────────────────────────────────────────

let pool: pg.Pool | null = null;

async function getPool(): Promise<pg.Pool> {
  if (!pool && DATABASE_URL) {
    pool = new pg.Pool({ connectionString: DATABASE_URL, max: 5 });
    // Initialize metering tables if they don't exist
    await initMeteringTables();
  }
  if (!pool) throw new Error("DATABASE_URL not configured");
  return pool;
}

async function initMeteringTables() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_usage_events (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      module_key VARCHAR(100) NOT NULL DEFAULT 'platform',
      request_id VARCHAR(255),
      provider VARCHAR(50) NOT NULL DEFAULT 'openai',
      model VARCHAR(100) NOT NULL,
      endpoint VARCHAR(100) NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      estimated_cost_usd NUMERIC(10, 6) NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'success',
      error_message TEXT,
      duration_ms INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_ai_usage_tenant_created
      ON ai_usage_events (tenant_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_module
      ON ai_usage_events (module_key, created_at DESC);

    CREATE TABLE IF NOT EXISTS ai_usage_summaries (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      module_key VARCHAR(100) NOT NULL,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      total_requests INTEGER NOT NULL DEFAULT 0,
      total_prompt_tokens INTEGER NOT NULL DEFAULT 0,
      total_completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      total_cost_usd NUMERIC(12, 4) NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(tenant_id, module_key, period_start)
    );
  `);
  console.log("[AI Service] Metering tables initialized");
}

// ─── Cost Estimation ────────────────────────────────────────────────

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 0.0025, output: 0.01 },
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-4-turbo": { input: 0.01, output: 0.03 },
  "gpt-4": { input: 0.03, output: 0.06 },
  "gpt-3.5-turbo": { input: 0.0005, output: 0.0015 },
  "text-embedding-3-small": { input: 0.00002, output: 0 },
  "text-embedding-3-large": { input: 0.00013, output: 0 },
};

function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const costs = MODEL_COSTS[model] || MODEL_COSTS["gpt-4o-mini"];
  return (promptTokens / 1000) * costs.input + (completionTokens / 1000) * costs.output;
}

// ─── Metering ───────────────────────────────────────────────────────

async function recordUsageEvent(event: {
  tenantId: number;
  userId: number;
  moduleKey: string;
  requestId: string;
  provider: string;
  model: string;
  endpoint: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  status: string;
  errorMessage?: string;
  durationMs: number;
}) {
  try {
    const db = await getPool();
    await db.query(
      `INSERT INTO ai_usage_events
        (tenant_id, user_id, module_key, request_id, provider, model, endpoint,
         prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd,
         status, error_message, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        event.tenantId, event.userId, event.moduleKey, event.requestId,
        event.provider, event.model, event.endpoint,
        event.promptTokens, event.completionTokens, event.totalTokens,
        event.estimatedCostUsd, event.status, event.errorMessage || null,
        event.durationMs,
      ]
    );

    // Update monthly summary
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];

    await db.query(
      `INSERT INTO ai_usage_summaries
        (tenant_id, module_key, period_start, period_end,
         total_requests, total_prompt_tokens, total_completion_tokens,
         total_tokens, total_cost_usd)
       VALUES ($1,$2,$3,$4,1,$5,$6,$7,$8)
       ON CONFLICT (tenant_id, module_key, period_start)
       DO UPDATE SET
         total_requests = ai_usage_summaries.total_requests + 1,
         total_prompt_tokens = ai_usage_summaries.total_prompt_tokens + $5,
         total_completion_tokens = ai_usage_summaries.total_completion_tokens + $6,
         total_tokens = ai_usage_summaries.total_tokens + $7,
         total_cost_usd = ai_usage_summaries.total_cost_usd + $8,
         updated_at = NOW()`,
      [
        event.tenantId, event.moduleKey, periodStart, periodEnd,
        event.promptTokens, event.completionTokens, event.totalTokens,
        event.estimatedCostUsd,
      ]
    );
  } catch (err) {
    console.error("[AI Service] Failed to record usage event:", err);
  }
}

// ─── Upstream AI Call ───────────────────────────────────────────────

async function callUpstreamChat(body: {
  messages: Array<{ role: string; content: string }>;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  response_format?: unknown;
}): Promise<{ data: any; durationMs: number }> {
  const start = Date.now();
  const model = body.model || "gpt-4o-mini";

  const response = await fetch(`${AI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      messages: body.messages,
      temperature: body.temperature ?? 0.7,
      max_tokens: body.max_tokens,
      response_format: body.response_format,
    }),
  });

  const durationMs = Date.now() - start;

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Upstream AI error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return { data, durationMs };
}

async function callUpstreamEmbeddings(body: {
  input: string | string[];
  model?: string;
}): Promise<{ data: any; durationMs: number }> {
  const start = Date.now();
  const model = body.model || "text-embedding-3-small";

  const response = await fetch(`${AI_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${AI_API_KEY}`,
    },
    body: JSON.stringify({ model, input: body.input }),
  });

  const durationMs = Date.now() - start;

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Upstream embeddings error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return { data, durationMs };
}

// ─── Health ─────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "ai-service", timestamp: new Date().toISOString() });
});

app.get("/ready", async (_req, res) => {
  const checks: Record<string, string> = {};

  // Check DB
  try {
    const db = await getPool();
    await db.query("SELECT 1");
    checks.database = "ok";
  } catch {
    checks.database = "unavailable";
  }

  // Check upstream AI
  checks.upstream_ai = AI_API_KEY ? "configured" : "not_configured";

  const allOk = checks.database === "ok";
  res.status(allOk ? 200 : 503).json({ status: allOk ? "ready" : "degraded", dependencies: checks });
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
  const requestId = (req.headers["x-viao-request-id"] as string) || `req-${Date.now()}`;

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

  const model = req.body.model || "gpt-4o-mini";

  // If no API key configured, return informative error
  if (!AI_API_KEY) {
    return res.status(503).json({
      success: false,
      error: {
        code: "AI_NOT_CONFIGURED",
        message: "Serviço de IA não configurado. Contacte o administrador.",
      },
    });
  }

  try {
    const { data, durationMs } = await callUpstreamChat(req.body);

    const usage = data.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
    const cost = estimateCost(model, usage.prompt_tokens, usage.completion_tokens);

    // Record metering event
    await recordUsageEvent({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      moduleKey: ctx.moduleKey || "platform",
      requestId: ctx.requestId,
      provider: "openai",
      model,
      endpoint: "chat/completions",
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      estimatedCostUsd: cost,
      status: "success",
      durationMs,
    });

    return res.json({
      success: true,
      data: {
        ...data,
        metering: {
          tenant_id: ctx.tenantId,
          module_key: ctx.moduleKey || "platform",
          tokens_consumed: usage.total_tokens,
          estimated_cost_usd: cost,
        },
      },
    });
  } catch (error: any) {
    // Record failed event
    await recordUsageEvent({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      moduleKey: ctx.moduleKey || "platform",
      requestId: ctx.requestId,
      provider: "openai",
      model,
      endpoint: "chat/completions",
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      status: "error",
      errorMessage: error.message,
      durationMs: 0,
    });

    console.error("[AI Service] Chat completion error:", error.message);
    return res.status(500).json({ success: false, error: { code: "AI_ERROR", message: "Erro no serviço de IA" } });
  }
});

// ─── POST /api/v1/embeddings — Metered embeddings ───────────────────

app.post("/api/v1/embeddings", async (req, res) => {
  const ctx = extractContext(req);
  if (!ctx) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED" } });
  }

  if (!AI_API_KEY) {
    return res.status(503).json({
      success: false,
      error: { code: "AI_NOT_CONFIGURED", message: "Serviço de IA não configurado." },
    });
  }

  const model = req.body.model || "text-embedding-3-small";

  try {
    const { data, durationMs } = await callUpstreamEmbeddings(req.body);

    const usage = data.usage || { prompt_tokens: 0, total_tokens: 0 };
    const cost = estimateCost(model, usage.prompt_tokens || usage.total_tokens, 0);

    await recordUsageEvent({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      moduleKey: ctx.moduleKey || "platform",
      requestId: ctx.requestId,
      provider: "openai",
      model,
      endpoint: "embeddings",
      promptTokens: usage.prompt_tokens || usage.total_tokens,
      completionTokens: 0,
      totalTokens: usage.total_tokens,
      estimatedCostUsd: cost,
      status: "success",
      durationMs,
    });

    return res.json({
      success: true,
      data: {
        ...data,
        metering: {
          tenant_id: ctx.tenantId,
          tokens_consumed: usage.total_tokens,
          estimated_cost_usd: cost,
        },
      },
    });
  } catch (error: any) {
    console.error("[AI Service] Embeddings error:", error.message);
    return res.status(500).json({ success: false, error: { code: "AI_ERROR", message: "Erro no serviço de IA" } });
  }
});

// ─── POST /api/v1/images/generate — Metered image generation ────────

app.post("/api/v1/images/generate", async (req, res) => {
  const ctx = extractContext(req);
  if (!ctx) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED" } });
  }

  if (!AI_API_KEY) {
    return res.status(503).json({
      success: false,
      error: { code: "AI_NOT_CONFIGURED", message: "Serviço de IA não configurado." },
    });
  }

  const model = req.body.model || "dall-e-3";
  const start = Date.now();

  try {
    const response = await fetch(`${AI_BASE_URL}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${AI_API_KEY}`,
      },
      body: JSON.stringify({
        model,
        prompt: req.body.prompt,
        n: req.body.n || 1,
        size: req.body.size || "1024x1024",
        quality: req.body.quality || "standard",
      }),
    });

    const durationMs = Date.now() - start;

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Upstream image error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    // DALL-E 3 costs: $0.04 standard, $0.08 HD per image
    const costPerImage = req.body.quality === "hd" ? 0.08 : 0.04;
    const totalCost = costPerImage * (req.body.n || 1);

    await recordUsageEvent({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      moduleKey: ctx.moduleKey || "platform",
      requestId: ctx.requestId,
      provider: "openai",
      model,
      endpoint: "images/generations",
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: totalCost,
      status: "success",
      durationMs,
    });

    return res.json({
      success: true,
      data: {
        ...data,
        metering: {
          tenant_id: ctx.tenantId,
          images_generated: req.body.n || 1,
          estimated_cost_usd: totalCost,
        },
      },
    });
  } catch (error: any) {
    console.error("[AI Service] Image generation error:", error.message);
    return res.status(500).json({ success: false, error: { code: "AI_ERROR", message: "Erro na geração de imagem" } });
  }
});

// ─── GET /api/v1/usage — Tenant usage stats ─────────────────────────

app.get("/api/v1/usage", async (req, res) => {
  const ctx = extractContext(req);
  if (!ctx) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED" } });
  }

  try {
    const db = await getPool();

    // Get current month summary
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];

    const summaryResult = await db.query(
      `SELECT module_key, total_requests, total_prompt_tokens, total_completion_tokens,
              total_tokens, total_cost_usd
       FROM ai_usage_summaries
       WHERE tenant_id = $1 AND period_start = $2
       ORDER BY total_tokens DESC`,
      [ctx.tenantId, periodStart]
    );

    const byModule: Record<string, any> = {};
    let totalTokens = 0;
    let totalCost = 0;
    let totalRequests = 0;

    for (const row of summaryResult.rows) {
      byModule[row.module_key] = {
        requests: row.total_requests,
        prompt_tokens: row.total_prompt_tokens,
        completion_tokens: row.total_completion_tokens,
        total_tokens: row.total_tokens,
        cost_usd: parseFloat(row.total_cost_usd),
      };
      totalTokens += row.total_tokens;
      totalCost += parseFloat(row.total_cost_usd);
      totalRequests += row.total_requests;
    }

    // Get recent events for this tenant
    const recentResult = await db.query(
      `SELECT model, endpoint, prompt_tokens, completion_tokens, total_tokens,
              estimated_cost_usd, status, duration_ms, created_at
       FROM ai_usage_events
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [ctx.tenantId]
    );

    return res.json({
      success: true,
      data: {
        tenant_id: ctx.tenantId,
        period: "current_month",
        period_start: periodStart,
        total_requests: totalRequests,
        total_tokens: totalTokens,
        total_cost_usd: totalCost,
        by_module: byModule,
        recent_events: recentResult.rows,
      },
    });
  } catch (error: any) {
    console.error("[AI Service] Usage query error:", error.message);
    return res.status(500).json({ success: false, error: { code: "QUERY_ERROR", message: "Erro ao consultar consumo" } });
  }
});

// ─── GET /api/v1/usage/admin — Admin: all tenants usage ─────────────

app.get("/api/v1/usage/admin", async (req, res) => {
  try {
    const db = await getPool();
    const now = new Date();
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];

    const result = await db.query(
      `SELECT tenant_id, 
              SUM(total_requests) as total_requests,
              SUM(total_tokens) as total_tokens,
              SUM(total_cost_usd) as total_cost_usd
       FROM ai_usage_summaries
       WHERE period_start = $1
       GROUP BY tenant_id
       ORDER BY total_tokens DESC`,
      [periodStart]
    );

    return res.json({
      success: true,
      data: {
        period: "current_month",
        period_start: periodStart,
        tenants: result.rows.map((r) => ({
          tenant_id: r.tenant_id,
          total_requests: r.total_requests,
          total_tokens: r.total_tokens,
          total_cost_usd: parseFloat(r.total_cost_usd),
        })),
      },
    });
  } catch (error: any) {
    console.error("[AI Service] Admin usage error:", error.message);
    return res.status(500).json({ success: false, error: { code: "QUERY_ERROR" } });
  }
});

// ─── Start ──────────────────────────────────────────────────────────

const server = createServer(app);

server.listen(PORT, async () => {
  console.log(`[AI Service] Running on http://localhost:${PORT}`);

  // Initialize DB connection and metering tables
  if (DATABASE_URL) {
    try {
      await getPool();
      console.log("[AI Service] Database connected, metering tables ready");
    } catch (err) {
      console.error("[AI Service] Database initialization failed:", err);
    }
  } else {
    console.warn("[AI Service] DATABASE_URL not set — metering disabled");
  }
});

export { app };
