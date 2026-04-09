/**
 * Via Oceânica AI — Módulo Gestão Email
 *
 * Domain: Email campaign management — templates, lists, automations, analytics
 *
 * Follows Module Contract v1.
 */

import express from "express";
import { createServer } from "http";
import cors from "cors";

const PORT = parseInt(process.env.MOD_GESTAO_EMAIL_PORT || "4002");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ─── Health & Readiness ─────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "mod-gestao-email", version: "1.0.0", uptime_seconds: Math.floor(process.uptime()) });
});

app.get("/ready", async (_req, res) => {
  res.json({ status: "ready", dependencies: { database: "ok" } });
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

app.use("/api/v1", apiRouter);

// ─── Start ──────────────────────────────────────────────────────────

const server = createServer(app);

server.listen(PORT, () => {
  console.log(`[Mod Gestão Email] Running on http://localhost:${PORT}`);
});

export { app };
