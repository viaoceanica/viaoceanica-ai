// src/index.ts
import express from "express";
import { createServer } from "http";
import cors from "cors";
var PORT = parseInt(process.env.MOD_GESTAO_EMAIL_PORT || "4002");
var AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://ai-service:4010";
var LOCAL_CHAT_MODEL = process.env.GESTAO_EMAIL_CHAT_MODEL || "qwen2.5:14b-instruct";
var app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
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
function extractContext(req) {
  const userId = req.headers["x-viao-user-id"];
  const tenantId = req.headers["x-viao-tenant-id"];
  if (!userId || !tenantId) return null;
  return {
    userId: Number(userId),
    tenantId: Number(tenantId),
    requestId: req.headers["x-viao-request-id"] || "unknown"
  };
}
function requireContext(req, res, next) {
  const ctx = extractContext(req);
  if (!ctx) {
    return res.status(401).json({ success: false, error: { code: "MISSING_CONTEXT" } });
  }
  req.ctx = ctx;
  next();
}
async function callAI(ctx, endpoint, body) {
  const resp = await fetch(`${AI_SERVICE_URL}${endpoint}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-viao-tenant-id": String(ctx.tenantId),
      "x-viao-user-id": String(ctx.userId),
      "x-viao-module-key": "gestao-email",
      "x-viao-request-id": ctx.requestId
    },
    body: JSON.stringify(body)
  });
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`AI service error (${resp.status}): ${err}`);
  }
  return resp.json();
}
var apiRouter = express.Router();
apiRouter.use(requireContext);
apiRouter.get("/dashboard", async (req, res) => {
  const ctx = req.ctx;
  return res.json({
    success: true,
    data: {
      tenant_id: ctx.tenantId,
      summary: {
        campaigns_active: 0,
        emails_sent_month: 0,
        open_rate: 0,
        lists_count: 0
      },
      message: "M\xF3dulo Gest\xE3o Email \u2014 em desenvolvimento"
    }
  });
});
apiRouter.get("/campaigns", async (_req, res) => {
  return res.json({ success: true, data: [] });
});
apiRouter.post("/campaigns", async (_req, res) => {
  return res.json({ success: true, data: { message: "Funcionalidade em desenvolvimento" } });
});
apiRouter.get("/lists", async (_req, res) => {
  return res.json({ success: true, data: [] });
});
apiRouter.get("/templates", async (_req, res) => {
  return res.json({ success: true, data: [] });
});
apiRouter.post("/ai/generate-subjects", async (req, res) => {
  const ctx = req.ctx;
  const { topic, tone, count } = req.body;
  if (!topic) {
    return res.status(400).json({ success: false, error: { code: "MISSING_FIELD", message: "topic is required" } });
  }
  try {
    const result = await callAI(ctx, "/api/v1/chat/completions", {
      messages: [
        {
          role: "system",
          content: `Voc\xEA \xE9 um especialista em email marketing. Gere ${count || 5} linhas de assunto para emails em portugu\xEAs. Cada linha deve ser apelativa, concisa (m\xE1ximo 60 caracteres) e otimizada para taxa de abertura. Responda em JSON: {"subjects": ["...", "..."]}`
        },
        {
          role: "user",
          content: `Tema: ${topic}${tone ? `. Tom: ${tone}` : ""}`
        }
      ],
      model: LOCAL_CHAT_MODEL,
      response_format: { type: "json_object" }
    });
    const content = result.choices?.[0]?.message?.content || "{}";
    let subjects;
    try {
      subjects = JSON.parse(content);
    } catch {
      subjects = { subjects: [content] };
    }
    return res.json({ success: true, data: subjects });
  } catch (error) {
    console.error("[Gest\xE3o Email] AI subjects error:", error.message);
    return res.status(502).json({ success: false, error: { code: "AI_ERROR", message: error.message } });
  }
});
apiRouter.post("/ai/generate-email-body", async (req, res) => {
  const ctx = req.ctx;
  const { subject, audience, purpose, style } = req.body;
  if (!subject) {
    return res.status(400).json({ success: false, error: { code: "MISSING_FIELD", message: "subject is required" } });
  }
  try {
    const result = await callAI(ctx, "/api/v1/chat/completions", {
      messages: [
        {
          role: "system",
          content: "Voc\xEA \xE9 um copywriter profissional especializado em email marketing. Gere o corpo de um email em HTML simples (sem CSS complexo, compat\xEDvel com clientes de email). O email deve ser profissional, persuasivo e em portugu\xEAs."
        },
        {
          role: "user",
          content: `Assunto: ${subject}${audience ? `. P\xFAblico-alvo: ${audience}` : ""}${purpose ? `. Objetivo: ${purpose}` : ""}${style ? `. Estilo: ${style}` : ""}`
        }
      ],
      model: LOCAL_CHAT_MODEL
    });
    const body = result.choices?.[0]?.message?.content || "";
    return res.json({ success: true, data: { html_body: body } });
  } catch (error) {
    console.error("[Gest\xE3o Email] AI body error:", error.message);
    return res.status(502).json({ success: false, error: { code: "AI_ERROR", message: error.message } });
  }
});
apiRouter.post("/ai/ab-test-suggestions", async (req, res) => {
  const ctx = req.ctx;
  const { originalSubject, originalBody, metric } = req.body;
  try {
    const result = await callAI(ctx, "/api/v1/chat/completions", {
      messages: [
        {
          role: "system",
          content: 'Voc\xEA \xE9 um especialista em otimiza\xE7\xE3o de email marketing. Sugira varia\xE7\xF5es para teste A/B. Responda em JSON: {"variations": [{"subject": "...", "changes": "...", "expected_impact": "..."}]}'
        },
        {
          role: "user",
          content: `Email original - Assunto: "${originalSubject || "N/A"}". Corpo: "${(originalBody || "").substring(0, 500)}". M\xE9trica a otimizar: ${metric || "taxa de abertura"}. Sugira 3 varia\xE7\xF5es.`
        }
      ],
      model: LOCAL_CHAT_MODEL,
      response_format: { type: "json_object" }
    });
    const content = result.choices?.[0]?.message?.content || "{}";
    let suggestions;
    try {
      suggestions = JSON.parse(content);
    } catch {
      suggestions = { raw: content };
    }
    return res.json({ success: true, data: suggestions });
  } catch (error) {
    console.error("[Gest\xE3o Email] AI A/B error:", error.message);
    return res.status(502).json({ success: false, error: { code: "AI_ERROR", message: error.message } });
  }
});
app.use("/api/v1", apiRouter);
var server = createServer(app);
server.listen(PORT, () => {
  console.log(`[Mod Gest\xE3o Email] Running on http://localhost:${PORT}`);
  console.log(`[Mod Gest\xE3o Email] AI Service: ${AI_SERVICE_URL}`);
});
export {
  app
};
