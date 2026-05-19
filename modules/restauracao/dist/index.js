// src/index.ts
import express from "express";
import { createServer } from "http";
import cors from "cors";
var PORT = parseInt(process.env.MOD_RESTAURACAO_PORT || "4001");
var AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://ai-service:4010";
var LOCAL_CHAT_MODEL = process.env.RESTAURACAO_CHAT_MODEL || "qwen2.5:14b-instruct";
var app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "mod-restauracao", version: "1.1.0", uptime_seconds: Math.floor(process.uptime()) });
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
    return res.status(401).json({ success: false, error: { code: "MISSING_CONTEXT", message: "Trusted headers not found" } });
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
      "x-viao-module-key": "restauracao",
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
        active_menus: 0,
        reservations_today: 0,
        inventory_alerts: 0,
        daily_revenue: 0
      },
      message: "M\xF3dulo Restaura\xE7\xE3o \u2014 em desenvolvimento"
    }
  });
});
apiRouter.get("/menus", async (req, res) => {
  return res.json({ success: true, data: [] });
});
apiRouter.post("/menus", async (req, res) => {
  return res.json({ success: true, data: { message: "Funcionalidade em desenvolvimento" } });
});
apiRouter.get("/reservations", async (req, res) => {
  return res.json({ success: true, data: [] });
});
apiRouter.get("/inventory", async (req, res) => {
  return res.json({ success: true, data: [] });
});
apiRouter.post("/ai/generate-menu-description", async (req, res) => {
  const ctx = req.ctx;
  const { itemName, ingredients, style } = req.body;
  if (!itemName) {
    return res.status(400).json({ success: false, error: { code: "MISSING_FIELD", message: "itemName is required" } });
  }
  try {
    const result = await callAI(ctx, "/api/v1/chat/completions", {
      messages: [
        {
          role: "system",
          content: "Voc\xEA \xE9 um especialista em gastronomia portuguesa. Gere descri\xE7\xF5es apelativas para menus de restaurante em portugu\xEAs. Seja criativo mas conciso (m\xE1ximo 2 frases)."
        },
        {
          role: "user",
          content: `Gere uma descri\xE7\xE3o para o prato "${itemName}"${ingredients ? ` com os ingredientes: ${ingredients}` : ""}${style ? `. Estilo: ${style}` : ""}`
        }
      ],
      model: LOCAL_CHAT_MODEL
    });
    const description = result.choices?.[0]?.message?.content || "Descri\xE7\xE3o n\xE3o dispon\xEDvel";
    return res.json({ success: true, data: { description } });
  } catch (error) {
    console.error("[Restaura\xE7\xE3o] AI error:", error.message);
    return res.status(502).json({ success: false, error: { code: "AI_ERROR", message: error.message } });
  }
});
apiRouter.post("/ai/translate-menu", async (req, res) => {
  const ctx = req.ctx;
  const { items, targetLanguage } = req.body;
  if (!items || !targetLanguage) {
    return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "items and targetLanguage are required" } });
  }
  try {
    const result = await callAI(ctx, "/api/v1/chat/completions", {
      messages: [
        {
          role: "system",
          content: `Voc\xEA \xE9 um tradutor especializado em menus de restaurante. Traduza os itens do menu para ${targetLanguage}. Responda em JSON com o formato: [{"original": "...", "translated": "...", "description": "..."}]`
        },
        {
          role: "user",
          content: `Traduza estes itens do menu para ${targetLanguage}: ${JSON.stringify(items)}`
        }
      ],
      model: LOCAL_CHAT_MODEL,
      response_format: { type: "json_object" }
    });
    const content = result.choices?.[0]?.message?.content || "{}";
    let translations;
    try {
      translations = JSON.parse(content);
    } catch {
      translations = { raw: content };
    }
    return res.json({ success: true, data: { translations } });
  } catch (error) {
    console.error("[Restaura\xE7\xE3o] AI translation error:", error.message);
    return res.status(502).json({ success: false, error: { code: "AI_ERROR", message: error.message } });
  }
});
apiRouter.post("/ai/inventory-suggestions", async (req, res) => {
  const ctx = req.ctx;
  const { currentInventory, menuItems } = req.body;
  try {
    const result = await callAI(ctx, "/api/v1/chat/completions", {
      messages: [
        {
          role: "system",
          content: "Voc\xEA \xE9 um consultor de gest\xE3o de restaurantes. Analise o invent\xE1rio e menu para sugerir compras e otimiza\xE7\xF5es. Responda em portugu\xEAs de forma pr\xE1tica e concisa."
        },
        {
          role: "user",
          content: `Invent\xE1rio atual: ${JSON.stringify(currentInventory || [])}. Menu ativo: ${JSON.stringify(menuItems || [])}. Sugira compras necess\xE1rias e otimiza\xE7\xF5es.`
        }
      ],
      model: LOCAL_CHAT_MODEL
    });
    const suggestions = result.choices?.[0]?.message?.content || "Sem sugest\xF5es dispon\xEDveis";
    return res.json({ success: true, data: { suggestions } });
  } catch (error) {
    console.error("[Restaura\xE7\xE3o] AI inventory error:", error.message);
    return res.status(502).json({ success: false, error: { code: "AI_ERROR", message: error.message } });
  }
});
app.use("/api/v1", apiRouter);
var server = createServer(app);
server.listen(PORT, () => {
  console.log(`[Mod Restaura\xE7\xE3o] Running on http://localhost:${PORT}`);
  console.log(`[Mod Restaura\xE7\xE3o] AI Service: ${AI_SERVICE_URL}`);
});
export {
  app
};
