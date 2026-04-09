/**
 * Via Oceânica AI — Módulo Restauração
 *
 * Domain: Restaurant management — menus, reservations, inventory, daily operations
 *
 * This module follows the Module Contract v1:
 * - Receives trusted x-viao-* headers from the gateway
 * - Does NOT implement independent authentication
 * - Owns its own database (restauracao_db)
 * - Calls the centralized AI service for AI operations
 */

import express from "express";
import { createServer } from "http";
import cors from "cors";

const PORT = parseInt(process.env.MOD_RESTAURACAO_PORT || "4001");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ─── Health & Readiness ─────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "mod-restauracao", version: "1.0.0", uptime_seconds: Math.floor(process.uptime()) });
});

app.get("/ready", async (_req, res) => {
  // TODO: Check database connectivity
  res.json({ status: "ready", dependencies: { database: "ok" } });
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

// ─── API v1 Routes ──────────────────────────────────────────────────

const apiRouter = express.Router();
apiRouter.use(requireContext);

// Dashboard summary
apiRouter.get("/dashboard", async (req, res) => {
  const ctx = (req as any).ctx as ModuleContext;
  // TODO: Query restauracao_db for tenant-specific data
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

app.use("/api/v1", apiRouter);

// ─── Start ──────────────────────────────────────────────────────────

const server = createServer(app);

server.listen(PORT, () => {
  console.log(`[Mod Restauração] Running on http://localhost:${PORT}`);
});

export { app };
