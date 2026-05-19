/**
 * Via Oceânica AI — Módulo Gestão Email
 *
 * Domain: Email campaign management — templates, lists, automations, analytics
 *
 * Follows Module Contract v1.
 * Calls centralized AI service for content generation.
 */

import express from "express";
import { createServer } from "http";
import cors from "cors";

const PORT = parseInt(process.env.MOD_GESTAO_EMAIL_PORT || "4002");
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://ai-service:4010";
const LOCAL_CHAT_MODEL = process.env.GESTAO_EMAIL_CHAT_MODEL || "qwen2.5:14b-instruct";

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ─── Health & Readiness ─────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "mod-gestao-email", version: "1.1.0", uptime_seconds: Math.floor(process.uptime()) });
});

app.get("/ready", async (_req, res) => {
  let aiStatus = "unknown";
  try {
    const resp = await fetch(`${AI_SERVICE_URL}/health`);
    if (resp.ok) aiStatus = "ok";
    else aiStatus = "degraded";
  } catch {
    aiStatus = "unreachable";
  }
  res.json({ status: "ready", dependencies: { database: "ok", ai_service: aiStatus } });
});

// ─── Middleware ──────────────────────────────────────────────────────

interface ModuleContext {
  userId: number;
  tenantId: number;
  requestId: string;
}

function extractContext(req: express.Request): ModuleContext | null {
  const userId = req.headers["x-viao-user-id"];
  const tenantId = req.headers["x-viao-tenant-id"];
  if (!userId || !tenantId) return null;
  return {
    userId: Number(userId),
    tenantId: Number(tenantId),
    requestId: (req.headers["x-viao-request-id"] as string) || "unknown",
  };
}

function requireContext(req: express.Request, res: express.Response, next: Function) {
  const ctx = extractContext(req);
  if (!ctx) {
    return res.status(401).json({ success: false, error: { code: "MISSING_CONTEXT" } });
  }
  (req as any).ctx = ctx;
  next();
}

// ─── AI Service Helper ──────────────────────────────────────────────

async function callAI(ctx: ModuleContext, endpoint: string, body: any): Promise<any> {
  const resp = await fetch(`${AI_SERVICE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-viao-tenant-id": String(ctx.tenantId),
      "x-viao-user-id": String(ctx.userId),
      "x-viao-module-key": "gestao-email",
      "x-viao-request-id": ctx.requestId,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`AI service error (${resp.status}): ${err}`);
  }
  return resp.json();
}

// ─── API v1 Routes ──────────────────────────────────────────────────

const apiRouter = express.Router();
apiRouter.use(requireContext);

// Dashboard summary
apiRouter.get("/dashboard", async (req, res) => {
  const ctx = (req as any).ctx as ModuleContext;
  return res.json({
    success: true,
    data: {
      tenant_id: ctx.tenantId,
      summary: {
        campaigns_active: 0,
        emails_sent_month: 0,
        open_rate: 0,
        lists_count: 0,
      },
      message: "Módulo Gestão Email — em desenvolvimento",
    },
  });
});

// Campaigns (placeholder)
apiRouter.get("/campaigns", async (_req, res) => {
  return res.json({ success: true, data: [] });
});

apiRouter.post("/campaigns", async (_req, res) => {
  return res.json({ success: true, data: { message: "Funcionalidade em desenvolvimento" } });
});

// Email lists (placeholder)
apiRouter.get("/lists", async (_req, res) => {
  return res.json({ success: true, data: [] });
});

// Templates (placeholder)
apiRouter.get("/templates", async (_req, res) => {
  return res.json({ success: true, data: [] });
});

// ─── AI-Powered Endpoints ───────────────────────────────────────────

// Generate email subject lines using AI
apiRouter.post("/ai/generate-subjects", async (req, res) => {
  const ctx = (req as any).ctx as ModuleContext;
  const { topic, tone, count } = req.body;

  if (!topic) {
    return res.status(400).json({ success: false, error: { code: "MISSING_FIELD", message: "topic is required" } });
  }

  try {
    const result = await callAI(ctx, "/api/v1/chat/completions", {
      messages: [
        {
          role: "system",
          content: `Você é um especialista em email marketing. Gere ${count || 5} linhas de assunto para emails em português. Cada linha deve ser apelativa, concisa (máximo 60 caracteres) e otimizada para taxa de abertura. Responda em JSON: {"subjects": ["...", "..."]}`,
        },
        {
          role: "user",
          content: `Tema: ${topic}${tone ? `. Tom: ${tone}` : ""}`,
        },
      ],
      model: LOCAL_CHAT_MODEL,
      response_format: { type: "json_object" },
    });

    const content = result.choices?.[0]?.message?.content || "{}";
    let subjects;
    try {
      subjects = JSON.parse(content);
    } catch {
      subjects = { subjects: [content] };
    }
    return res.json({ success: true, data: subjects });
  } catch (error: any) {
    console.error("[Gestão Email] AI subjects error:", error.message);
    return res.status(502).json({ success: false, error: { code: "AI_ERROR", message: error.message } });
  }
});

// Generate email body content using AI
apiRouter.post("/ai/generate-email-body", async (req, res) => {
  const ctx = (req as any).ctx as ModuleContext;
  const { subject, audience, purpose, style } = req.body;

  if (!subject) {
    return res.status(400).json({ success: false, error: { code: "MISSING_FIELD", message: "subject is required" } });
  }

  try {
    const result = await callAI(ctx, "/api/v1/chat/completions", {
      messages: [
        {
          role: "system",
          content: "Você é um copywriter profissional especializado em email marketing. Gere o corpo de um email em HTML simples (sem CSS complexo, compatível com clientes de email). O email deve ser profissional, persuasivo e em português.",
        },
        {
          role: "user",
          content: `Assunto: ${subject}${audience ? `. Público-alvo: ${audience}` : ""}${purpose ? `. Objetivo: ${purpose}` : ""}${style ? `. Estilo: ${style}` : ""}`,
        },
      ],
      model: LOCAL_CHAT_MODEL,
    });

    const body = result.choices?.[0]?.message?.content || "";
    return res.json({ success: true, data: { html_body: body } });
  } catch (error: any) {
    console.error("[Gestão Email] AI body error:", error.message);
    return res.status(502).json({ success: false, error: { code: "AI_ERROR", message: error.message } });
  }
});

// AI-powered A/B test suggestions
apiRouter.post("/ai/ab-test-suggestions", async (req, res) => {
  const ctx = (req as any).ctx as ModuleContext;
  const { originalSubject, originalBody, metric } = req.body;

  try {
    const result = await callAI(ctx, "/api/v1/chat/completions", {
      messages: [
        {
          role: "system",
          content: "Você é um especialista em otimização de email marketing. Sugira variações para teste A/B. Responda em JSON: {\"variations\": [{\"subject\": \"...\", \"changes\": \"...\", \"expected_impact\": \"...\"}]}",
        },
        {
          role: "user",
          content: `Email original - Assunto: "${originalSubject || "N/A"}". Corpo: "${(originalBody || "").substring(0, 500)}". Métrica a otimizar: ${metric || "taxa de abertura"}. Sugira 3 variações.`,
        },
      ],
      model: LOCAL_CHAT_MODEL,
      response_format: { type: "json_object" },
    });

    const content = result.choices?.[0]?.message?.content || "{}";
    let suggestions;
    try {
      suggestions = JSON.parse(content);
    } catch {
      suggestions = { raw: content };
    }
    return res.json({ success: true, data: suggestions });
  } catch (error: any) {
    console.error("[Gestão Email] AI A/B error:", error.message);
    return res.status(502).json({ success: false, error: { code: "AI_ERROR", message: error.message } });
  }
});

app.use("/api/v1", apiRouter);

// ─── Start ──────────────────────────────────────────────────────────

const server = createServer(app);

server.listen(PORT, () => {
  console.log(`[Mod Gestão Email] Running on http://localhost:${PORT}`);
  console.log(`[Mod Gestão Email] AI Service: ${AI_SERVICE_URL}`);
});

export { app };
