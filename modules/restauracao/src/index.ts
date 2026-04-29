/**
 * Via Oceânica AI — Módulo Restauração
 *
 * Domain: Restaurant management — menus, reservations, inventory, daily operations
 *
 * This module follows the Module Contract v1:
 * - Receives trusted x-viao-* headers from the gateway
 * - Does NOT implement independent authentication
 * - Owns its own database tables (rest_*)
 * - Calls the centralized AI service for AI operations
 */

import express from "express";
import { createServer } from "http";
import cors from "cors";

const PORT = parseInt(process.env.MOD_RESTAURACAO_PORT || "4001");
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://ai-service:4010";
const LOCAL_CHAT_MODEL = process.env.RESTAURACAO_CHAT_MODEL || "qwen2.5:14b-instruct";

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ─── Health & Readiness ─────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "mod-restauracao", version: "1.1.0", uptime_seconds: Math.floor(process.uptime()) });
});

app.get("/ready", async (_req, res) => {
  // Check AI service connectivity
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

// ─── Middleware: Extract trusted context ─────────────────────────────

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
    return res.status(401).json({ success: false, error: { code: "MISSING_CONTEXT", message: "Trusted headers not found" } });
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
      "x-viao-module-key": "restauracao",
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
        active_menus: 0,
        reservations_today: 0,
        inventory_alerts: 0,
        daily_revenue: 0,
      },
      message: "Módulo Restauração — em desenvolvimento",
    },
  });
});

// Menus CRUD (placeholder)
apiRouter.get("/menus", async (req, res) => {
  return res.json({ success: true, data: [] });
});

apiRouter.post("/menus", async (req, res) => {
  return res.json({ success: true, data: { message: "Funcionalidade em desenvolvimento" } });
});

// Reservations (placeholder)
apiRouter.get("/reservations", async (req, res) => {
  return res.json({ success: true, data: [] });
});

// Inventory (placeholder)
apiRouter.get("/inventory", async (req, res) => {
  return res.json({ success: true, data: [] });
});

// ─── AI-Powered Endpoints ───────────────────────────────────────────

// Generate menu description using AI
apiRouter.post("/ai/generate-menu-description", async (req, res) => {
  const ctx = (req as any).ctx as ModuleContext;
  const { itemName, ingredients, style } = req.body;

  if (!itemName) {
    return res.status(400).json({ success: false, error: { code: "MISSING_FIELD", message: "itemName is required" } });
  }

  try {
    const result = await callAI(ctx, "/api/v1/chat/completions", {
      messages: [
        {
          role: "system",
          content: "Você é um especialista em gastronomia portuguesa. Gere descrições apelativas para menus de restaurante em português. Seja criativo mas conciso (máximo 2 frases).",
        },
        {
          role: "user",
          content: `Gere uma descrição para o prato "${itemName}"${ingredients ? ` com os ingredientes: ${ingredients}` : ""}${style ? `. Estilo: ${style}` : ""}`,
        },
      ],
      model: LOCAL_CHAT_MODEL,
    });

    const description = result.choices?.[0]?.message?.content || "Descrição não disponível";
    return res.json({ success: true, data: { description } });
  } catch (error: any) {
    console.error("[Restauração] AI error:", error.message);
    return res.status(502).json({ success: false, error: { code: "AI_ERROR", message: error.message } });
  }
});

// AI-powered menu translation
apiRouter.post("/ai/translate-menu", async (req, res) => {
  const ctx = (req as any).ctx as ModuleContext;
  const { items, targetLanguage } = req.body;

  if (!items || !targetLanguage) {
    return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "items and targetLanguage are required" } });
  }

  try {
    const result = await callAI(ctx, "/api/v1/chat/completions", {
      messages: [
        {
          role: "system",
          content: `Você é um tradutor especializado em menus de restaurante. Traduza os itens do menu para ${targetLanguage}. Responda em JSON com o formato: [{"original": "...", "translated": "...", "description": "..."}]`,
        },
        {
          role: "user",
          content: `Traduza estes itens do menu para ${targetLanguage}: ${JSON.stringify(items)}`,
        },
      ],
      model: LOCAL_CHAT_MODEL,
      response_format: { type: "json_object" },
    });

    const content = result.choices?.[0]?.message?.content || "{}";
    let translations;
    try {
      translations = JSON.parse(content);
    } catch {
      translations = { raw: content };
    }
    return res.json({ success: true, data: { translations } });
  } catch (error: any) {
    console.error("[Restauração] AI translation error:", error.message);
    return res.status(502).json({ success: false, error: { code: "AI_ERROR", message: error.message } });
  }
});

// AI-powered inventory suggestions
apiRouter.post("/ai/inventory-suggestions", async (req, res) => {
  const ctx = (req as any).ctx as ModuleContext;
  const { currentInventory, menuItems } = req.body;

  try {
    const result = await callAI(ctx, "/api/v1/chat/completions", {
      messages: [
        {
          role: "system",
          content: "Você é um consultor de gestão de restaurantes. Analise o inventário e menu para sugerir compras e otimizações. Responda em português de forma prática e concisa.",
        },
        {
          role: "user",
          content: `Inventário atual: ${JSON.stringify(currentInventory || [])}. Menu ativo: ${JSON.stringify(menuItems || [])}. Sugira compras necessárias e otimizações.`,
        },
      ],
      model: LOCAL_CHAT_MODEL,
    });

    const suggestions = result.choices?.[0]?.message?.content || "Sem sugestões disponíveis";
    return res.json({ success: true, data: { suggestions } });
  } catch (error: any) {
    console.error("[Restauração] AI inventory error:", error.message);
    return res.status(502).json({ success: false, error: { code: "AI_ERROR", message: error.message } });
  }
});

app.use("/api/v1", apiRouter);

// ─── Start ──────────────────────────────────────────────────────────

const server = createServer(app);

server.listen(PORT, () => {
  console.log(`[Mod Restauração] Running on http://localhost:${PORT}`);
  console.log(`[Mod Restauração] AI Service: ${AI_SERVICE_URL}`);
});

export { app };
