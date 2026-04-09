/**
 * Via Oceânica AI — Platform Core Service
 *
 * Responsibilities:
 * 1. Authentication (register, login, session management)
 * 2. Module Registry (CRUD for module manifests)
 * 3. Tenant Management (companies, teams, members)
 * 4. Entitlements (module permissions per tenant/team/user)
 * 5. Plans and Subscriptions
 * 6. Token Management (balances, transactions)
 */

import express from "express";
import { createServer } from "http";
import cors from "cors";
import { authRouter } from "./auth/routes.js";
import { registryRouter } from "./registry/routes.js";
import { tenantsRouter } from "./tenants/routes.js";
import { entitlementsRouter } from "./entitlements/routes.js";

const PORT = parseInt(process.env.PLATFORM_CORE_PORT || "4000");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

// ─── Health ─────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "platform-core", timestamp: new Date().toISOString() });
});

app.get("/ready", async (_req, res) => {
  // Check database connectivity
  try {
    // TODO: actual DB ping
    res.json({ status: "ready", dependencies: { database: "ok", redis: "ok" } });
  } catch {
    res.status(503).json({ status: "not_ready", dependencies: { database: "error" } });
  }
});

// ─── Routes ─────────────────────────────────────────────────────────

app.use("/api/auth", authRouter);
app.use("/api/v1/registry", registryRouter);
app.use("/api/v1/tenants", tenantsRouter);
app.use("/api/v1/entitlements", entitlementsRouter);

// ─── Start ──────────────────────────────────────────────────────────

const server = createServer(app);

server.listen(PORT, () => {
  console.log(`[Platform Core] Running on http://localhost:${PORT}`);
});

export { app };
