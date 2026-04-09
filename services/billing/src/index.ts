/**
 * Via Oceânica AI — Billing Service
 *
 * Responsibilities:
 * 1. Plan management (CRUD)
 * 2. Subscription lifecycle
 * 3. Token metering and balance management
 * 4. Invoice generation (future)
 * 5. Stripe/payment integration (future)
 */

import express from "express";
import { createServer } from "http";
import cors from "cors";

const PORT = parseInt(process.env.BILLING_PORT || "4020");

const app = express();

app.use(cors());
app.use(express.json());

// ─── Health ─────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "billing", version: "1.0.0" });
});

app.get("/ready", (_req, res) => {
  res.json({ status: "ready", dependencies: { database: "ok" } });
});

// ─── Plans ──────────────────────────────────────────────────────────

app.get("/api/v1/plans", async (_req, res) => {
  // TODO: Query from billing_db
  return res.json({ success: true, data: [] });
});

// ─── Subscriptions ──────────────────────────────────────────────────

app.get("/api/v1/subscriptions/:tenantId", async (req, res) => {
  return res.json({ success: true, data: { message: "Em desenvolvimento" } });
});

// ─── Token Metering ─────────────────────────────────────────────────

app.post("/api/v1/metering/consume", async (req, res) => {
  const { tenantId, moduleKey, tokensUsed } = req.body;
  // TODO: Debit tokens from tenant balance, log transaction
  return res.json({ success: true, data: { remaining: -1 } });
});

app.get("/api/v1/metering/balance/:tenantId", async (req, res) => {
  return res.json({ success: true, data: { internal: 0, external: 0 } });
});

// ─── Start ──────────────────────────────────────────────────────────

const server = createServer(app);

server.listen(PORT, () => {
  console.log(`[Billing] Running on http://localhost:${PORT}`);
});

export { app };
