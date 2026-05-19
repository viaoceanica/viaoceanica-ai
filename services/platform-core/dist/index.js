// src/index.ts
import express from "express";
import { createServer } from "http";
import cors from "cors";

// src/auth/routes.ts
import { Router } from "express";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";

// src/db.ts
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
var _db = null;
async function getDb() {
  if (!_db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      console.warn("[Platform Core DB] DATABASE_URL not set");
      return null;
    }
    try {
      const client = postgres(connectionString);
      _db = drizzle(client);
    } catch (error) {
      console.error("[Platform Core DB] Connection failed:", error);
      return null;
    }
  }
  return _db;
}

// drizzle/schema.ts
import {
  pgTable,
  serial,
  varchar,
  text,
  integer,
  boolean,
  timestamp,
  pgEnum,
  jsonb,
  uniqueIndex
} from "drizzle-orm/pg-core";
var platformRoleEnum = pgEnum("platform_role", ["user", "admin"]);
var companyRoleEnum = pgEnum("company_role", ["owner", "admin", "member"]);
var invitationStatusEnum = pgEnum("invitation_status", ["pending", "accepted", "expired"]);
var tokenTypeEnum = pgEnum("token_type", ["credit", "debit"]);
var tokenSourceEnum = pgEnum("token_source", [
  "admin_grant",
  "plan_allocation",
  "usage",
  "refund",
  "external",
  "purchase"
]);
var moduleStatusEnum = pgEnum("module_status", ["active", "maintenance", "deprecated", "disabled"]);
var visibilityModeEnum = pgEnum("visibility_mode", ["global", "restricted"]);
var rolloutStateEnum = pgEnum("rollout_state", ["enabled", "disabled", "beta"]);
var plans = pgTable("plans", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description"),
  monthlyPrice: integer("monthly_price").default(0),
  yearlyPrice: integer("yearly_price").default(0),
  tokensPerMonth: integer("tokens_per_month").default(0),
  maxMembers: integer("max_members").default(5),
  maxTeams: integer("max_teams").default(1),
  maxModules: integer("max_modules").default(2),
  features: jsonb("features"),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
var companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  sector: varchar("sector", { length: 100 }),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 50 }),
  address: text("address"),
  website: varchar("website", { length: 500 }),
  planId: integer("plan_id").references(() => plans.id),
  tokensBalance: integer("tokens_balance").default(0).notNull(),
  externalTokensBalance: integer("external_tokens_balance").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
var users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 320 }).notNull().unique(),
  name: varchar("name", { length: 255 }),
  passwordHash: text("password_hash"),
  loginMethod: varchar("login_method", { length: 64 }).default("email"),
  platformRole: platformRoleEnum("platform_role").default("user").notNull(),
  companyId: integer("company_id").references(() => companies.id),
  companyRole: companyRoleEnum("company_role"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastSignedIn: timestamp("last_signed_in").defaultNow().notNull()
});
var teams = pgTable("teams", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
var teamMembers = pgTable("team_members", {
  id: serial("id").primaryKey(),
  teamId: integer("team_id").references(() => teams.id).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  role: varchar("role", { length: 50 }).default("member"),
  joinedAt: timestamp("joined_at").defaultNow().notNull()
});
var invitations = pgTable("invitations", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  teamId: integer("team_id").references(() => teams.id),
  email: varchar("email", { length: 320 }).notNull(),
  role: companyRoleEnum("role").default("member"),
  token: varchar("token", { length: 64 }).notNull().unique(),
  status: invitationStatusEnum("status").default("pending").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var tokenTransactions = pgTable("token_transactions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id).notNull(),
  type: tokenTypeEnum("type").notNull(),
  source: tokenSourceEnum("source").notNull(),
  amount: integer("amount").notNull(),
  description: text("description"),
  moduleKey: varchar("module_key", { length: 100 }),
  userId: integer("user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var moduleRegistry = pgTable("module_registry", {
  id: serial("id").primaryKey(),
  moduleKey: varchar("module_key", { length: 100 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  version: varchar("version", { length: 20 }).default("1.0.0"),
  route: varchar("route", { length: 255 }),
  frontendMountType: varchar("frontend_mount_type", { length: 50 }).default("internal"),
  backendServiceUrl: varchar("backend_service_url", { length: 500 }),
  healthEndpoint: varchar("health_endpoint", { length: 255 }).default("/health"),
  readinessEndpoint: varchar("readiness_endpoint", { length: 255 }).default("/ready"),
  icon: varchar("icon", { length: 100 }),
  status: moduleStatusEnum("status").default("active").notNull(),
  capabilities: jsonb("capabilities"),
  minPlan: varchar("min_plan", { length: 100 }),
  tenantRestricted: boolean("tenant_restricted").default(false),
  configSchema: jsonb("config_schema"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
var tenantModules = pgTable(
  "tenant_modules",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").references(() => companies.id).notNull(),
    moduleKey: varchar("module_key", { length: 100 }).notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    visibilityMode: visibilityModeEnum("visibility_mode").default("global"),
    rolloutState: rolloutStateEnum("rollout_state").default("enabled"),
    config: jsonb("config"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => ({
    tenantModuleUnique: uniqueIndex("tenant_module_unique").on(table.tenantId, table.moduleKey)
  })
);
var modulePermissions = pgTable("module_permissions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => companies.id).notNull(),
  moduleKey: varchar("module_key", { length: 100 }).notNull(),
  teamId: integer("team_id").references(() => teams.id),
  userId: integer("user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  token: varchar("token", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull()
});
var invoiceStatusEnum = pgEnum("invoice_status", ["draft", "pending", "paid", "overdue", "cancelled"]);
var paymentMethodTypeEnum = pgEnum("payment_method_type", ["bank_transfer", "credit_card", "mbway", "multibanco", "paypal", "other"]);
var billingCycleEnum = pgEnum("billing_cycle", ["monthly", "yearly"]);
var billingProfiles = pgTable("billing_profiles", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull().unique(),
  legalName: varchar("legal_name", { length: 255 }),
  nif: varchar("nif", { length: 20 }),
  address: text("address"),
  postalCode: varchar("postal_code", { length: 20 }),
  city: varchar("city", { length: 100 }),
  country: varchar("country", { length: 100 }).default("Portugal"),
  email: varchar("email", { length: 320 }),
  phone: varchar("phone", { length: 50 }),
  preferredPaymentMethod: paymentMethodTypeEnum("preferred_payment_method").default("bank_transfer"),
  billingCycle: billingCycleEnum("billing_cycle").default("monthly"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});
var invoices = pgTable("invoices", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id, { onDelete: "cascade" }).notNull(),
  invoiceNumber: varchar("invoice_number", { length: 50 }).notNull().unique(),
  status: invoiceStatusEnum("status").default("draft").notNull(),
  billingCycle: billingCycleEnum("billing_cycle").default("monthly"),
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  subtotal: integer("subtotal").default(0).notNull(),
  taxRate: integer("tax_rate").default(23),
  taxAmount: integer("tax_amount").default(0).notNull(),
  total: integer("total").default(0).notNull(),
  currency: varchar("currency", { length: 3 }).default("EUR"),
  planName: varchar("plan_name", { length: 100 }),
  planId: integer("plan_id").references(() => plans.id),
  lineItems: jsonb("line_items"),
  paidAt: timestamp("paid_at"),
  dueDate: timestamp("due_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull()
});

// src/auth/routes.ts
import { eq } from "drizzle-orm";
var router = Router();
var JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "change-me");
var COOKIE_NAME = process.env.COOKIE_NAME || "app_session_id";
async function createSessionToken(payload) {
  const expiresAt = Math.floor((Date.now() + 365 * 24 * 60 * 60 * 1e3) / 1e3);
  return new SignJWT(payload).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expiresAt).sign(JWT_SECRET);
}
var IS_PRODUCTION = process.env.NODE_ENV === "production" && process.env.FORCE_HTTPS === "true";
function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: IS_PRODUCTION ? "none" : "lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60 * 1e3
  });
}
router.post("/register", async (req, res) => {
  try {
    const { companyName, name, email, password, sector } = req.body;
    if (!companyName || !name || !email || !password) {
      return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "Todos os campos s\xE3o obrigat\xF3rios" } });
    }
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE", message: "Base de dados indispon\xEDvel" } });
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, error: { code: "EMAIL_EXISTS", message: "Este email j\xE1 est\xE1 registado" } });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const allPlans = await db.select().from(plans);
    const starterPlan = allPlans.find((p) => p.name.toLowerCase().includes("starter"));
    const companyResult = await db.insert(companies).values({
      name: companyName,
      sector: sector || null,
      email,
      planId: starterPlan?.id || null,
      tokensBalance: 0,
      externalTokensBalance: 0
    }).returning();
    const company = companyResult[0];
    const userResult = await db.insert(users).values({
      email,
      name,
      passwordHash,
      loginMethod: "email",
      platformRole: "user",
      companyId: company.id,
      companyRole: "owner",
      lastSignedIn: /* @__PURE__ */ new Date()
    }).returning();
    const user = userResult[0];
    const token = await createSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name || "",
      tenantId: company.id,
      platformRole: user.platformRole,
      companyRole: user.companyRole || "owner"
    });
    setSessionCookie(res, token);
    return res.json({
      success: true,
      data: {
        user: { id: user.id, name: user.name, email: user.email, platformRole: user.platformRole, companyRole: user.companyRole },
        company: { id: company.id, name: company.name }
      }
    });
  } catch (error) {
    console.error("[Auth] Register error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Erro interno" } });
  }
});
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "Email e password s\xE3o obrigat\xF3rios" } });
    }
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE", message: "Base de dados indispon\xEDvel" } });
    const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (result.length === 0) {
      return res.status(401).json({ success: false, error: { code: "INVALID_CREDENTIALS", message: "Credenciais inv\xE1lidas" } });
    }
    const user = result[0];
    if (!user.passwordHash) {
      return res.status(401).json({ success: false, error: { code: "INVALID_CREDENTIALS", message: "Credenciais inv\xE1lidas" } });
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ success: false, error: { code: "INVALID_CREDENTIALS", message: "Credenciais inv\xE1lidas" } });
    }
    await db.update(users).set({ lastSignedIn: /* @__PURE__ */ new Date() }).where(eq(users.id, user.id));
    const token = await createSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name || "",
      tenantId: user.companyId || void 0,
      platformRole: user.platformRole,
      companyRole: user.companyRole || void 0
    });
    setSessionCookie(res, token);
    return res.json({
      success: true,
      data: {
        user: { id: user.id, name: user.name, email: user.email, platformRole: user.platformRole, companyRole: user.companyRole }
      }
    });
  } catch (error) {
    console.error("[Auth] Login error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Erro interno" } });
  }
});
router.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: IS_PRODUCTION, sameSite: IS_PRODUCTION ? "none" : "lax", path: "/" });
  return res.json({ success: true });
});
router.get("/me", async (req, res) => {
  const userId = req.headers["x-viao-user-id"];
  if (!userId) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "N\xE3o autenticado" } });
  }
  const db = await getDb();
  if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE", message: "Base de dados indispon\xEDvel" } });
  const result = await db.select().from(users).where(eq(users.id, Number(userId))).limit(1);
  if (result.length === 0) {
    return res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "Utilizador n\xE3o encontrado" } });
  }
  const user = result[0];
  return res.json({
    success: true,
    data: {
      id: user.id,
      name: user.name,
      email: user.email,
      platformRole: user.platformRole,
      companyId: user.companyId,
      companyRole: user.companyRole,
      createdAt: user.createdAt,
      lastSignedIn: user.lastSignedIn
    }
  });
});
router.post("/change-password", async (req, res) => {
  const userId = req.headers["x-viao-user-id"];
  if (!userId) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "N\xE3o autenticado" } });
  }
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "Password atual e nova s\xE3o obrigat\xF3rias" } });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: { code: "WEAK_PASSWORD", message: "A nova password deve ter pelo menos 6 caracteres" } });
    }
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const result = await db.select().from(users).where(eq(users.id, Number(userId))).limit(1);
    if (result.length === 0) {
      return res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND" } });
    }
    const user = result[0];
    if (!user.passwordHash) {
      return res.status(400).json({ success: false, error: { code: "NO_PASSWORD", message: "Utilizador n\xE3o tem password definida" } });
    }
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ success: false, error: { code: "INVALID_PASSWORD", message: "Password atual incorreta" } });
    }
    const newHash = await bcrypt.hash(newPassword, 12);
    await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, Number(userId)));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Auth] Change password error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router.put("/profile", async (req, res) => {
  const userId = req.headers["x-viao-user-id"];
  if (!userId) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "N\xE3o autenticado" } });
  }
  try {
    const { name } = req.body;
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const updateData = {};
    if (name !== void 0) updateData.name = name;
    if (Object.keys(updateData).length > 0) {
      await db.update(users).set(updateData).where(eq(users.id, Number(userId)));
    }
    return res.json({ success: true });
  } catch (error) {
    console.error("[Auth] Update profile error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router.get("/profile", async (req, res) => {
  const userId = req.headers["x-viao-user-id"];
  if (!userId) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "N\xE3o autenticado" } });
  }
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const result = await db.select().from(users).where(eq(users.id, Number(userId))).limit(1);
    if (result.length === 0) {
      return res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND" } });
    }
    const user = result[0];
    let company = null;
    if (user.companyId) {
      const companyResult = await db.select().from(companies).where(eq(companies.id, user.companyId)).limit(1);
      company = companyResult[0] || null;
    }
    let plan = null;
    if (company?.planId) {
      const planResult = await db.select().from(plans).where(eq(plans.id, company.planId)).limit(1);
      plan = planResult[0] || null;
    }
    return res.json({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        platformRole: user.platformRole,
        companyId: user.companyId,
        companyRole: user.companyRole,
        companyName: company?.name || null,
        companySector: company?.sector || null,
        planName: plan?.name || null,
        createdAt: user.createdAt,
        lastSignedIn: user.lastSignedIn
      }
    });
  } catch (error) {
    console.error("[Auth] Get profile error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// src/registry/routes.ts
import { Router as Router2 } from "express";
import { eq as eq2 } from "drizzle-orm";

// src/registry/scaffold.ts
import archiver from "archiver";
import { PassThrough } from "stream";
function slugToUnderscore(slug) {
  return slug.replace(/-/g, "_");
}
function slugToUpperEnv(slug) {
  return slug.toUpperCase().replace(/-/g, "_");
}
function pythonMain(cfg) {
  return `"""
${cfg.name} \u2014 Backend Service
Via Oce\xE2nica AI Platform Module
"""
from fastapi import FastAPI, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("${cfg.slug}")

PORT = int(os.getenv("MOD_${slugToUpperEnv(cfg.slug)}_PORT", "${cfg.port}"))
DATABASE_URL = os.getenv("DATABASE_URL", "")

# \u2500\u2500\u2500 AI Service Configuration \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://ai-service:4010")
AI_AGENT_ID = os.getenv("AI_AGENT_ID", "${cfg.slug}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"[${cfg.slug}] Starting on port {PORT}")
    # Startup: connect DB, init resources
    yield
    # Shutdown: cleanup
    logger.info(f"[${cfg.slug}] Shutting down")

app = FastAPI(
    title="${cfg.name}",
    description="${cfg.description || ""}",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# \u2500\u2500\u2500 Platform Headers Middleware \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
@app.middleware("http")
async def extract_platform_headers(request: Request, call_next):
    """Extract x-viao-* headers injected by the gateway."""
    request.state.tenant_id = request.headers.get("x-viao-tenant-id")
    request.state.user_id = request.headers.get("x-viao-user-id")
    request.state.user_role = request.headers.get("x-viao-user-role")
    request.state.module_key = request.headers.get("x-viao-module-key")
    response = await call_next(request)
    return response

# \u2500\u2500\u2500 Health Endpoints \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
@app.get("/health")
async def health():
    return {"status": "ok", "service": "${cfg.slug}", "version": "1.0.0"}

@app.get("/ready")
async def ready():
    # TODO: Check database connectivity
    return {"status": "ready", "dependencies": {"database": "ok"}}

# \u2500\u2500\u2500 AI Integration \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
from ai_client import ask_assistant

@app.post("/api/v1/ai/chat")
async def ai_chat(request: Request):
    """Chat with the module-specific AI assistant via OpenClaw."""
    body = await request.json()
    message = body.get("message", "")
    session_id = body.get("session_id", f"{request.state.tenant_id}-{request.state.user_id}")

    response = await ask_assistant(
        message=message,
        session_id=session_id,
        agent_id=AI_AGENT_ID,
        context={
            "tenant_id": request.state.tenant_id,
            "user_id": request.state.user_id,
            "module": "${cfg.slug}",
        }
    )
    return {"success": True, "data": response}

# \u2500\u2500\u2500 API Routes \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
@app.get("/api/v1/status")
async def status(request: Request):
    return {
        "success": True,
        "data": {
            "module": "${cfg.slug}",
            "tenant_id": request.state.tenant_id,
            "message": "${cfg.name} est\xE1 operacional"
        }
    }

# TODO: Add your module-specific routes here
# Example:
# @app.get("/api/v1/items")
# async def list_items(request: Request):
#     tenant_id = request.state.tenant_id
#     return {"success": True, "data": []}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=PORT)
`;
}
function pythonAiClient(cfg) {
  return `"""
AI Client \u2014 OpenClaw Integration
Communicates with the OpenClaw gateway to leverage module-specific AI agents.
"""
import httpx
import os
import logging
from typing import Optional

logger = logging.getLogger("${cfg.slug}.ai")

AI_SERVICE_URL = os.getenv("AI_SERVICE_URL", "http://ai-service:4010")
AI_AGENT_ID = os.getenv("AI_AGENT_ID", "${cfg.slug}")


async def ask_assistant(
    message: str,
    session_id: str,
    agent_id: Optional[str] = None,
    context: Optional[dict] = None,
    model: str = "qwen2.5:14b-instruct",
) -> dict:
    """
    Send a message to the module's OpenClaw AI agent.

    Args:
        message: The user's message
        session_id: Unique session ID (typically tenant_id-user_id)
        agent_id: OpenClaw agent ID (defaults to module slug)
        context: Additional context to include in the system prompt
        model: Model identifier (default: local Ollama chat model)

    Returns:
        dict with 'reply' (str) and 'usage' (dict)
    """
    agent = agent_id or AI_AGENT_ID

    system_prompt = f"Est\xE1s a responder como assistente do m\xF3dulo {agent}."
    if context:
        system_prompt += f" Contexto: tenant_id={context.get('tenant_id')}, user_id={context.get('user_id')}, module={context.get('module')}"

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            response = await client.post(
                f"{AI_SERVICE_URL}/chat/completions",
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": message},
                    ],
                    "user": session_id,
                },
                headers={
                    "Content-Type": "application/json",
                    "X-OpenClaw-Agent": agent,
                },
            )
            response.raise_for_status()
            data = response.json()

            choice = data.get("choices", [{}])[0]
            return {
                "reply": choice.get("message", {}).get("content", ""),
                "usage": data.get("usage", {}),
                "model": data.get("model", model),
            }

    except httpx.HTTPStatusError as e:
        logger.error(f"AI request failed: {e.response.status_code} - {e.response.text}")
        return {"reply": "Desculpe, o assistente AI n\xE3o est\xE1 dispon\xEDvel neste momento.", "usage": {}, "error": str(e)}
    except Exception as e:
        logger.error(f"AI request error: {e}")
        return {"reply": "Erro ao comunicar com o assistente AI.", "usage": {}, "error": str(e)}
`;
}
function pythonRequirements(cfg) {
  const deps = [
    "fastapi>=0.104.0",
    "uvicorn[standard]>=0.24.0",
    "python-dotenv>=1.0.0",
    "httpx>=0.25.0"
  ];
  if (cfg.capabilities.includes("ai")) deps.push("openai>=1.3.0");
  if (cfg.capabilities.includes("storage")) deps.push("boto3>=1.29.0");
  if (cfg.capabilities.includes("email")) deps.push("aiosmtplib>=2.0.0");
  deps.push("asyncpg>=0.29.0", "sqlalchemy[asyncio]>=2.0.0");
  return deps.join("\n") + "\n";
}
function pythonDockerfile(cfg) {
  return `FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

EXPOSE ${cfg.port}

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "${cfg.port}"]
`;
}
function nodejsMain(cfg) {
  return `/**
 * ${cfg.name} \u2014 Backend Service
 * Via Oce\xE2nica AI Platform Module
 */
import express from "express";
import cors from "cors";
import { askAssistant } from "./ai-client.js";

const PORT = parseInt(process.env.MOD_${slugToUpperEnv(cfg.slug)}_PORT || "${cfg.port}");
const DATABASE_URL = process.env.DATABASE_URL || "";

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// \u2500\u2500\u2500 Platform Headers Middleware \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
app.use((req, _res, next) => {
  (req as any).tenantId = req.headers["x-viao-tenant-id"];
  (req as any).userId = req.headers["x-viao-user-id"];
  (req as any).userRole = req.headers["x-viao-user-role"];
  (req as any).moduleKey = req.headers["x-viao-module-key"];
  next();
});

// \u2500\u2500\u2500 Health Endpoints \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "${cfg.slug}", version: "1.0.0" });
});

app.get("/ready", (_req, res) => {
  // TODO: Check database connectivity
  res.json({ status: "ready", dependencies: { database: "ok" } });
});

// \u2500\u2500\u2500 AI Chat Endpoint \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
app.post("/api/v1/ai/chat", async (req, res) => {
  try {
    const { message, session_id } = req.body;
    const sessionId = session_id || \`\${(req as any).tenantId}-\${(req as any).userId}\`;

    const response = await askAssistant({
      message,
      sessionId,
      context: {
        tenantId: (req as any).tenantId,
        userId: (req as any).userId,
        module: "${cfg.slug}",
      },
    });

    res.json({ success: true, data: response });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// \u2500\u2500\u2500 API Routes \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
app.get("/api/v1/status", (req, res) => {
  res.json({
    success: true,
    data: {
      module: "${cfg.slug}",
      tenant_id: (req as any).tenantId,
      message: "${cfg.name} est\xE1 operacional"
    }
  });
});

// TODO: Add your module-specific routes here

app.listen(PORT, () => {
  console.log(\`[${cfg.slug}] Running on http://localhost:\${PORT}\`);
});
`;
}
function nodejsAiClient(cfg) {
  return `/**
 * AI Client \u2014 OpenClaw Integration
 * Communicates with the OpenClaw gateway to leverage module-specific AI agents.
 */

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://ai-service:4010";
const AI_AGENT_ID = process.env.AI_AGENT_ID || "${cfg.slug}";

interface AskAssistantParams {
  message: string;
  sessionId: string;
  agentId?: string;
  context?: {
    tenantId?: string;
    userId?: string;
    module?: string;
  };
  model?: string;
}

interface AskAssistantResponse {
  reply: string;
  usage: Record<string, number>;
  model?: string;
  error?: string;
}

/**
 * Send a message to the module's OpenClaw AI agent.
 *
 * @param params.message - The user's message
 * @param params.sessionId - Unique session ID (typically tenantId-userId)
 * @param params.agentId - OpenClaw agent ID (defaults to module slug)
 * @param params.context - Additional context for the system prompt
 * @param params.model - Model identifier (default: local Ollama chat model)
 */
export async function askAssistant(params: AskAssistantParams): Promise<AskAssistantResponse> {
  const { message, sessionId, agentId, context, model = "qwen2.5:14b-instruct" } = params;
  const agent = agentId || AI_AGENT_ID;

  let systemPrompt = \`Est\xE1s a responder como assistente do m\xF3dulo \${agent}.\`;
  if (context) {
    systemPrompt += \` Contexto: tenant_id=\${context.tenantId}, user_id=\${context.userId}, module=\${context.module}\`;
  }

  try {
    const response = await fetch(\`\${AI_SERVICE_URL}/chat/completions\`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-OpenClaw-Agent": agent,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: message },
        ],
        user: sessionId,
      }),
      signal: AbortSignal.timeout(60000),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(\`[ai-client] HTTP \${response.status}: \${errorText}\`);
      return {
        reply: "Desculpe, o assistente AI n\xE3o est\xE1 dispon\xEDvel neste momento.",
        usage: {},
        error: \`HTTP \${response.status}\`,
      };
    }

    const data = await response.json();
    const choice = data.choices?.[0];

    return {
      reply: choice?.message?.content || "",
      usage: data.usage || {},
      model: data.model || model,
    };
  } catch (error: any) {
    console.error(\`[ai-client] Error: \${error.message}\`);
    return {
      reply: "Erro ao comunicar com o assistente AI.",
      usage: {},
      error: error.message,
    };
  }
}
`;
}
function nodejsPackageJson(cfg) {
  const deps = {
    express: "^4.18.2",
    cors: "^2.8.5",
    tsx: "^4.7.0"
  };
  if (cfg.capabilities.includes("ai")) deps["openai"] = "^4.20.0";
  if (cfg.capabilities.includes("storage")) deps["@aws-sdk/client-s3"] = "^3.450.0";
  return JSON.stringify({
    name: `mod-${cfg.slug}`,
    version: "1.0.0",
    description: cfg.description || cfg.name,
    type: "module",
    scripts: {
      dev: `tsx watch src/index.ts`,
      start: `tsx src/index.ts`
    },
    dependencies: deps
  }, null, 2) + "\n";
}
function nodejsDockerfile(cfg) {
  return `FROM node:20-slim

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile || npm install

COPY . .

EXPOSE ${cfg.port}

CMD ["npm", "start"]
`;
}
function frontendNextConfig(cfg) {
  return `/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/module/${cfg.slug}",
  output: "standalone",
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: \`\${process.env.SERVER_API_BASE_URL || "http://mod-${cfg.slug}:${cfg.port}"}/api/:path*\`,
      },
    ];
  },
};

module.exports = nextConfig;
`;
}
function frontendPackageJson(cfg) {
  return JSON.stringify({
    name: `${cfg.slug}-frontend`,
    version: "1.0.0",
    private: true,
    scripts: {
      dev: "next dev",
      build: "next build",
      start: "next start -p 3000"
    },
    dependencies: {
      next: "^14.0.0",
      react: "^18.2.0",
      "react-dom": "^18.2.0"
    },
    devDependencies: {
      typescript: "^5.3.0",
      "@types/react": "^18.2.0",
      "@types/node": "^20.10.0"
    }
  }, null, 2) + "\n";
}
function frontendPage(cfg) {
  return `"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [status, setStatus] = useState<any>(null);

  useEffect(() => {
    fetch("/module/${cfg.slug}/api/v1/status")
      .then(r => r.json())
      .then(setStatus)
      .catch(console.error);
  }, []);

  return (
    <main style={{ padding: "2rem", fontFamily: "system-ui" }}>
      <h1>${cfg.name}</h1>
      <p>${cfg.description || "M\xF3dulo da plataforma Via Oce\xE2nica"}</p>
      {status && (
        <pre style={{ background: "#f4f4f4", padding: "1rem", borderRadius: "8px" }}>
          {JSON.stringify(status, null, 2)}
        </pre>
      )}
    </main>
  );
}
`;
}
function frontendLayout(cfg) {
  return `export const metadata = {
  title: "${cfg.name}",
  description: "${cfg.description || ""}",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt">
      <body>{children}</body>
    </html>
  );
}
`;
}
function frontendDockerfile(cfg) {
  return `FROM node:20-slim AS builder

WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && pnpm install --frozen-lockfile || npm install
COPY . .
RUN npm run build

FROM node:20-slim AS runner
WORKDIR /app
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
`;
}
function moduleManifest(cfg) {
  return JSON.stringify({
    module_key: cfg.slug,
    name: cfg.name,
    version: "1.0.0",
    description: cfg.description || "",
    route: `/module/${cfg.slug}`,
    frontend_mount_type: cfg.mountType,
    backend_service_url: `http://mod-${cfg.slug}:${cfg.port}`,
    health_endpoint: "/health",
    readiness_endpoint: "/ready",
    status: "active",
    icon: cfg.icon || "Package",
    capabilities: cfg.capabilities,
    ai_agent_id: cfg.slug,
    min_plan: null,
    tenant_restricted: false
  }, null, 2) + "\n";
}
function agentSoulMd(cfg) {
  return `# SOUL.md \u2014 Assistente ${cfg.name}

## Quem \xE9s
\xC9s o assistente especializado do m\xF3dulo "${cfg.name}" da plataforma Via Oce\xE2nica.
${cfg.description ? `A tua \xE1rea de especializa\xE7\xE3o: ${cfg.description}` : ""}

## Idioma
Responde sempre em portugu\xEAs europeu (pt-PT).

## Compet\xEAncias
- Ajudar utilizadores com quest\xF5es relacionadas com ${cfg.name}
- Analisar dados e fornecer recomenda\xE7\xF5es pr\xE1ticas
- Explicar conceitos do dom\xEDnio de forma clara e acess\xEDvel
- Sugerir melhorias baseadas nas melhores pr\xE1ticas do sector

## Comportamento
- S\xEA direto e orientado para resultados
- Usa linguagem profissional mas acess\xEDvel
- Quando relevante, apresenta dados em tabelas
- Se a informa\xE7\xE3o for insuficiente, pede esclarecimentos
- Nunca inventes dados \u2014 se n\xE3o sabes, diz que n\xE3o sabes

## Contexto da Plataforma
Est\xE1s integrado no m\xF3dulo "${cfg.name}" da Via Oce\xE2nica, uma plataforma SaaS multi-tenant para PMEs portuguesas.
Os utilizadores acedem a ti atrav\xE9s do chat integrado no m\xF3dulo.

## Limites
- N\xE3o acedes a dados de outros tenants ou m\xF3dulos
- N\xE3o executas opera\xE7\xF5es na base de dados \u2014 apenas aconselhas
- Recomenda sempre consultar um profissional para decis\xF5es cr\xEDticas
`;
}
function agentSetupScript(cfg) {
  return `#!/bin/bash
# \u2500\u2500\u2500 OpenClaw Agent Setup for ${cfg.name} \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
#
# This script creates and configures the OpenClaw agent for this module.
# Run this ONCE on the VPS after deploying the module.
#
# Prerequisites:
#   - OpenClaw installed and running on the VPS
#   - openclaw CLI available in PATH
#
# Usage:
#   chmod +x setup-agent.sh
#   ./setup-agent.sh
#

set -euo pipefail

AGENT_ID="${cfg.slug}"
AGENT_NAME="Assistente ${cfg.name}"
AGENT_EMOJI="${cfg.icon === "Utensils" ? "\u{1F37D}\uFE0F" : cfg.icon === "Calculator" ? "\u{1F4CA}" : cfg.icon === "Mail" ? "\u{1F4E7}" : "\u{1F916}"}"
WORKSPACE_DIR="/root/openclaw/workspace/agents/\${AGENT_ID}"
SOUL_FILE="$(dirname "$0")/SOUL.md"

echo "\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557"
echo "\u2551  OpenClaw Agent Setup \u2014 \${AGENT_NAME}"
echo "\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D"
echo ""

# 1. Create workspace directory
echo "\u2192 Creating workspace at \${WORKSPACE_DIR}..."
mkdir -p "\${WORKSPACE_DIR}"

# 2. Copy SOUL.md to workspace
if [ -f "\${SOUL_FILE}" ]; then
  cp "\${SOUL_FILE}" "\${WORKSPACE_DIR}/SOUL.md"
  echo "  \u2713 SOUL.md copied"
else
  echo "  \u26A0 SOUL.md not found at \${SOUL_FILE}, using default"
fi

# 3. Register agent with OpenClaw
echo "\u2192 Registering agent '\${AGENT_ID}'..."
openclaw agents add "\${AGENT_ID}" \\
  --workspace "\${WORKSPACE_DIR}" \\
  --model openai/gpt-5.4 \\
  --non-interactive

# 4. Set agent identity
echo "\u2192 Setting identity..."
openclaw agents set-identity \\
  --agent "\${AGENT_ID}" \\
  --name "\${AGENT_NAME}" \\
  --emoji "\${AGENT_EMOJI}"

# 5. Restart gateway to pick up new agent
echo "\u2192 Restarting OpenClaw gateway..."
openclaw gateway restart

echo ""
echo "\u2705 Agent '\${AGENT_ID}' registered and ready!"
echo ""
echo "Test with:"
echo "  openclaw agent --agent \${AGENT_ID} --message \\"Ol\xE1, teste de integra\xE7\xE3o\\""
echo ""
echo "The agent will be available at:"
echo "  POST http://localhost:4010/v1/chat/completions"
echo "  Header: X-OpenClaw-Agent: \${AGENT_ID}"
`;
}
function fullDockerCompose(cfg) {
  const keyUpper = slugToUpperEnv(cfg.slug);
  const slugUnder = slugToUnderscore(cfg.slug);
  const dbName = cfg.databaseMode === "separate" ? `viaoceanica_${slugUnder}` : "viaoceanica_platform";
  let yaml = `# \u2500\u2500\u2500 ${cfg.name} \u2014 Docker Compose \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
# Full docker-compose.yml for standalone development and deployment.
#
# Quick start:
#   cp .env.example .env
#   docker compose up -d
#
# This file includes:
#   - Backend service (mod-${cfg.slug})
${cfg.mountType === "iframe" ? `#   - Frontend service (${cfg.slug}-frontend)
` : ""}#   - PostgreSQL database
#   - Redis cache
#   - Volumes for data persistence
#
# For production deployment, merge these services into the main
# docker-compose.yml of the Via Oce\xE2nica platform.
# \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

x-common-env: &common-env
  NODE_ENV: \${NODE_ENV:-development}
  REDIS_URL: redis://redis:6379
  TZ: Europe/Lisbon

services:
  # \u2500\u2500\u2500 Module Backend \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  mod-${cfg.slug}:
    build:
      context: .
      dockerfile: Dockerfile
    restart: unless-stopped
    ports:
      - "\${MOD_${keyUpper}_PORT:-${cfg.port}}:${cfg.port}"
    environment:
      <<: *common-env
      MOD_${keyUpper}_PORT: "${cfg.port}"
      DATABASE_URL: postgresql://viaoceanica:\${POSTGRES_PASSWORD:-viao_db_2024_secure}@postgres:5432/${dbName}
      AI_SERVICE_URL: \${AI_SERVICE_URL:-http://ai-service:4010}
      AI_AGENT_ID: \${AI_AGENT_ID:-${cfg.slug}}
    extra_hosts:
      - "host.docker.internal:host-gateway"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 256M
        reservations:
          cpus: "0.1"
          memory: 64M
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:${cfg.port}/health"]
      interval: 15s
      timeout: 5s
      retries: 3
    volumes:
      - mod-${cfg.slug}-data:/app/data`;
  if (cfg.mountType === "iframe") {
    yaml += `

  # \u2500\u2500\u2500 Module Frontend \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  ${cfg.slug}-frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    restart: unless-stopped
    ports:
      - "\${FRONTEND_PORT:-3000}:3000"
    environment:
      SERVER_API_BASE_URL: http://mod-${cfg.slug}:${cfg.port}
    depends_on:
      mod-${cfg.slug}:
        condition: service_healthy
    deploy:
      resources:
        limits:
          cpus: "0.25"
          memory: 128M`;
  }
  yaml += `

  # \u2500\u2500\u2500 PostgreSQL \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: viaoceanica
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-viao_db_2024_secure}
      POSTGRES_DB: ${dbName}
    ports:
      - "\${POSTGRES_PORT:-5432}:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U viaoceanica -d ${dbName}"]
      interval: 10s
      timeout: 5s
      retries: 5

  # \u2500\u2500\u2500 Redis \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - "\${REDIS_PORT:-6379}:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

volumes:
  mod-${cfg.slug}-data:
  postgres-data:
  redis-data:
`;
  return yaml;
}
function dockerComposeSnippet(cfg) {
  const keyUpper = slugToUpperEnv(cfg.slug);
  const slugUnder = slugToUnderscore(cfg.slug);
  const dbUrl = cfg.databaseMode === "separate" ? `postgresql://viaoceanica:\${POSTGRES_PASSWORD:-viao_db_2024_secure}@postgres:5432/viaoceanica_${slugUnder}` : `postgresql://viaoceanica:\${POSTGRES_PASSWORD:-viao_db_2024_secure}@postgres:5432/viaoceanica_platform`;
  let yaml = `# \u2500\u2500\u2500 Add to the MAIN docker-compose.yml \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
# Copy this block into the "services:" section of the platform's
# docker-compose.yml at /opt/viaoceanica-ai/docker-compose.yml

  mod-${cfg.slug}:
    build:
      context: ./modules/${cfg.slug}
      dockerfile: Dockerfile
    restart: unless-stopped
    environment:
      <<: *common-env
      MOD_${keyUpper}_PORT: "${cfg.port}"
      DATABASE_URL: ${dbUrl}
      AI_SERVICE_URL: http://ai-service:4010
      AI_AGENT_ID: ${cfg.slug}
    extra_hosts:
      - "host.docker.internal:host-gateway"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    deploy:
      resources:
        limits:
          cpus: "0.5"
          memory: 256M
    healthcheck:
      test: ["CMD", "wget", "-q", "--spider", "http://localhost:${cfg.port}/health"]
      interval: 15s
      timeout: 5s
      retries: 3`;
  if (cfg.mountType === "iframe") {
    yaml += `

  ${cfg.slug}-frontend:
    build:
      context: ./modules/${cfg.slug}/frontend
      dockerfile: Dockerfile
    restart: unless-stopped
    environment:
      SERVER_API_BASE_URL: http://mod-${cfg.slug}:${cfg.port}
    depends_on:
      - mod-${cfg.slug}
    deploy:
      resources:
        limits:
          cpus: "0.25"
          memory: 128M`;
  }
  yaml += `

# \u2500\u2500\u2500 Add to gateway environment: \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
# MOD_${keyUpper}_URL: http://mod-${cfg.slug}:${cfg.port}
`;
  return yaml;
}
function nginxSnippet(cfg) {
  if (cfg.mountType !== "iframe") {
    return `# M\xF3dulos com montagem "${cfg.mountType}" n\xE3o necessitam de configura\xE7\xE3o nginx adicional.
`;
  }
  const slugUnder = slugToUnderscore(cfg.slug);
  return `# \u2500\u2500\u2500 Add to nginx.conf \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

upstream ${slugUnder}_frontend {
    server ${cfg.slug}-frontend:3000;
}

# Add inside server block, BEFORE the catch-all location /

location /module/${cfg.slug} {
    proxy_pass http://${slugUnder}_frontend;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
`;
}
function envExample(cfg) {
  const keyUpper = slugToUpperEnv(cfg.slug);
  return `# \u2500\u2500\u2500 ${cfg.name} \u2014 Environment Variables \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
# Copy this file to .env and adjust values as needed.

# Module
MOD_${keyUpper}_PORT=${cfg.port}
NODE_ENV=development

# Database
DATABASE_URL=postgresql://viaoceanica:viao_db_2024_secure@localhost:5432/viaoceanica_platform
POSTGRES_PASSWORD=viao_db_2024_secure
POSTGRES_PORT=5432

# AI / OpenClaw
AI_SERVICE_URL=http://ai-service:4010
AI_AGENT_ID=${cfg.slug}

# Redis
REDIS_URL=redis://localhost:6379
REDIS_PORT=6379
${cfg.mountType === "iframe" ? `
# Frontend
FRONTEND_PORT=3000` : ""}
`;
}
function readmeContent(cfg) {
  const keyUpper = slugToUpperEnv(cfg.slug);
  return `# ${cfg.name}

${cfg.description || "M\xF3dulo da plataforma Via Oce\xE2nica AI."}

## Quick Start

\`\`\`bash
# 1. Copy environment variables
cp .env.example .env

# 2. Start all services (backend + database + redis)
docker compose up -d

# 3. Verify health
curl http://localhost:${cfg.port}/health

# 4. (Optional) Set up the AI assistant
chmod +x agent/setup-agent.sh
./agent/setup-agent.sh
\`\`\`

## Estrutura

\`\`\`
modules/${cfg.slug}/
\u251C\u2500\u2500 docker-compose.yml         # Full compose for standalone dev
\u251C\u2500\u2500 Dockerfile                 # Backend container build
\u251C\u2500\u2500 module-manifest.json       # Module registry manifest
\u251C\u2500\u2500 .env.example               # Environment variables template
\u251C\u2500\u2500 ${cfg.backendLanguage === "python" ? "main.py                      # FastAPI application" : "src/index.ts                  # Express application"}
\u251C\u2500\u2500 ${cfg.backendLanguage === "python" ? "ai_client.py                 # OpenClaw AI integration" : "src/ai-client.ts              # OpenClaw AI integration"}
\u251C\u2500\u2500 ${cfg.backendLanguage === "python" ? "requirements.txt" : "package.json"}
\u251C\u2500\u2500 agent/
\u2502   \u251C\u2500\u2500 SOUL.md                # AI agent personality & expertise
\u2502   \u2514\u2500\u2500 setup-agent.sh         # OpenClaw agent registration script
${cfg.mountType === "iframe" ? `\u251C\u2500\u2500 frontend/
\u2502   \u251C\u2500\u2500 Dockerfile
\u2502   \u251C\u2500\u2500 next.config.js
\u2502   \u251C\u2500\u2500 package.json
\u2502   \u2514\u2500\u2500 app/
\u2502       \u251C\u2500\u2500 page.tsx
\u2502       \u2514\u2500\u2500 layout.tsx` : ""}
\u2514\u2500\u2500 deploy/
    \u251C\u2500\u2500 docker-compose-snippet.yml  # Snippet for main platform compose
    \u2514\u2500\u2500 nginx-snippet.conf          # Nginx proxy config (if iframe)
\`\`\`

## AI Assistant Integration

This module comes with an OpenClaw AI agent pre-configured. The agent has domain-specific knowledge defined in \`agent/SOUL.md\`.

### How it works

1. **OpenClaw** runs on the VPS as the AI gateway (port 18789)
2. Each module has a dedicated **agent** with specialized knowledge
3. The backend calls OpenClaw via the \`ai_client\` helper
4. Requests are routed to the correct agent based on \`AI_AGENT_ID\`

### Setting up the agent

\`\`\`bash
# On the VPS (where OpenClaw is running):
cd modules/${cfg.slug}
chmod +x agent/setup-agent.sh
./agent/setup-agent.sh
\`\`\`

### Customizing the agent

Edit \`agent/SOUL.md\` to change the agent's personality, expertise, and behavior. After editing, re-run the setup script or copy the file to the OpenClaw workspace:

\`\`\`bash
cp agent/SOUL.md /root/openclaw/workspace/agents/${cfg.slug}/SOUL.md
\`\`\`

### Testing the agent

\`\`\`bash
# Via OpenClaw CLI
openclaw agent --agent ${cfg.slug} --message "Ol\xE1, teste"

# Via the module's API
curl -X POST http://localhost:${cfg.port}/api/v1/ai/chat \\
  -H "Content-Type: application/json" \\
  -H "x-viao-tenant-id: 1" \\
  -H "x-viao-user-id: 1" \\
  -d '{"message": "Ol\xE1, teste de integra\xE7\xE3o"}'
\`\`\`

## Vari\xE1veis de Ambiente

| Vari\xE1vel | Descri\xE7\xE3o | Default |
|----------|-----------|---------|
| \`MOD_${keyUpper}_PORT\` | Porta do backend | ${cfg.port} |
| \`DATABASE_URL\` | Connection string PostgreSQL | \u2014 |
| \`AI_SERVICE_URL\` | URL do AI service local-first | http://ai-service:4010 |
| \`AI_AGENT_ID\` | ID do agente OpenClaw | ${cfg.slug} |
| \`REDIS_URL\` | URL do Redis | redis://localhost:6379 |
| \`POSTGRES_PASSWORD\` | Password do PostgreSQL | viao_db_2024_secure |

## Endpoints

| M\xE9todo | Path | Descri\xE7\xE3o |
|--------|------|-----------|
| GET | \`/health\` | Health check |
| GET | \`/ready\` | Readiness check |
| GET | \`/api/v1/status\` | Status do m\xF3dulo |
| POST | \`/api/v1/ai/chat\` | Chat com assistente AI |

## Headers da Plataforma

O gateway injeta os seguintes headers em cada request:

| Header | Descri\xE7\xE3o |
|--------|-----------|
| \`x-viao-tenant-id\` | ID da empresa/tenant |
| \`x-viao-user-id\` | ID do utilizador |
| \`x-viao-user-role\` | Papel do utilizador |
| \`x-viao-module-key\` | Chave do m\xF3dulo |

## Deployment to Production

To add this module to the main Via Oce\xE2nica platform:

1. Copy the module directory to \`/opt/viaoceanica-ai/modules/${cfg.slug}/\`
2. Merge \`deploy/docker-compose-snippet.yml\` into the main \`docker-compose.yml\`
3. Add \`deploy/nginx-snippet.conf\` to the nginx configuration (if iframe mount)
4. Run \`agent/setup-agent.sh\` to register the OpenClaw agent
5. Rebuild and restart: \`docker compose up -d --build mod-${cfg.slug}\`
`;
}
async function generateScaffoldZip(cfg) {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 9 } });
    const buffers = [];
    const passthrough = new PassThrough();
    passthrough.on("data", (chunk) => buffers.push(chunk));
    passthrough.on("end", () => resolve(Buffer.concat(buffers)));
    passthrough.on("error", reject);
    archive.on("error", reject);
    archive.pipe(passthrough);
    const base = `modules/${cfg.slug}`;
    archive.append(moduleManifest(cfg), { name: `${base}/module-manifest.json` });
    archive.append(readmeContent(cfg), { name: `${base}/README.md` });
    archive.append(envExample(cfg), { name: `${base}/.env.example` });
    archive.append(fullDockerCompose(cfg), { name: `${base}/docker-compose.yml` });
    if (cfg.backendLanguage === "python") {
      archive.append(pythonMain(cfg), { name: `${base}/main.py` });
      archive.append(pythonAiClient(cfg), { name: `${base}/ai_client.py` });
      archive.append(pythonRequirements(cfg), { name: `${base}/requirements.txt` });
      archive.append(pythonDockerfile(cfg), { name: `${base}/Dockerfile` });
    } else {
      archive.append(nodejsMain(cfg), { name: `${base}/src/index.ts` });
      archive.append(nodejsAiClient(cfg), { name: `${base}/src/ai-client.ts` });
      archive.append(nodejsPackageJson(cfg), { name: `${base}/package.json` });
      archive.append(`{}`, { name: `${base}/tsconfig.json` });
      archive.append(nodejsDockerfile(cfg), { name: `${base}/Dockerfile` });
    }
    if (cfg.mountType === "iframe") {
      archive.append(frontendNextConfig(cfg), { name: `${base}/frontend/next.config.js` });
      archive.append(frontendPackageJson(cfg), { name: `${base}/frontend/package.json` });
      archive.append(frontendPage(cfg), { name: `${base}/frontend/app/page.tsx` });
      archive.append(frontendLayout(cfg), { name: `${base}/frontend/app/layout.tsx` });
      archive.append(frontendDockerfile(cfg), { name: `${base}/frontend/Dockerfile` });
    }
    archive.append(agentSoulMd(cfg), { name: `${base}/agent/SOUL.md` });
    archive.append(agentSetupScript(cfg), { name: `${base}/agent/setup-agent.sh` });
    archive.append(dockerComposeSnippet(cfg), { name: `${base}/deploy/docker-compose-snippet.yml` });
    archive.append(nginxSnippet(cfg), { name: `${base}/deploy/nginx-snippet.conf` });
    archive.finalize();
  });
}

// src/registry/routes.ts
var router2 = Router2();
function requireAdmin(req, res, next) {
  const roles = req.headers["x-viao-platform-roles"];
  if (!roles || !roles.includes("admin")) {
    return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Apenas administradores podem gerir o registry" } });
  }
  next();
}
router2.get("/modules", async (_req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const allModules = await db.select().from(moduleRegistry);
    return res.json({ success: true, data: allModules });
  } catch (error) {
    console.error("[Registry] List error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router2.get("/modules/:key", async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const result = await db.select().from(moduleRegistry).where(eq2(moduleRegistry.moduleKey, req.params.key)).limit(1);
    if (result.length === 0) {
      return res.status(404).json({ success: false, error: { code: "MODULE_NOT_FOUND", message: `M\xF3dulo '${req.params.key}' n\xE3o encontrado` } });
    }
    return res.json({ success: true, data: result[0] });
  } catch (error) {
    console.error("[Registry] Get error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router2.post("/modules", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const manifest = req.body;
    if (!manifest.module_key || !manifest.name) {
      return res.status(400).json({ success: false, error: { code: "INVALID_MANIFEST", message: "module_key e name s\xE3o obrigat\xF3rios" } });
    }
    const existing = await db.select().from(moduleRegistry).where(eq2(moduleRegistry.moduleKey, manifest.module_key)).limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, error: { code: "MODULE_EXISTS", message: `M\xF3dulo '${manifest.module_key}' j\xE1 est\xE1 registado` } });
    }
    const result = await db.insert(moduleRegistry).values({
      moduleKey: manifest.module_key,
      name: manifest.name,
      description: manifest.description || null,
      version: manifest.version || "1.0.0",
      route: manifest.route || `/module/${manifest.module_key}`,
      frontendMountType: manifest.frontend_mount_type || "internal",
      backendServiceUrl: manifest.backend_service_url || null,
      healthEndpoint: manifest.health_endpoint || "/health",
      readinessEndpoint: manifest.readiness_endpoint || "/ready",
      icon: manifest.icon || null,
      status: manifest.status || "active",
      capabilities: manifest.capabilities ? JSON.stringify(manifest.capabilities) : null,
      minPlan: manifest.min_plan || null,
      tenantRestricted: manifest.tenant_restricted || false,
      configSchema: manifest.config_schema || null
    }).returning();
    return res.status(201).json({ success: true, data: result[0] });
  } catch (error) {
    console.error("[Registry] Create error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router2.put("/modules/:key", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const manifest = req.body;
    const key = req.params.key;
    const existing = await db.select().from(moduleRegistry).where(eq2(moduleRegistry.moduleKey, key)).limit(1);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: { code: "MODULE_NOT_FOUND" } });
    }
    const updateData = { updatedAt: /* @__PURE__ */ new Date() };
    if (manifest.name) updateData.name = manifest.name;
    if (manifest.description !== void 0) updateData.description = manifest.description;
    if (manifest.version) updateData.version = manifest.version;
    if (manifest.route) updateData.route = manifest.route;
    if (manifest.frontend_mount_type) updateData.frontendMountType = manifest.frontend_mount_type;
    if (manifest.backend_service_url) updateData.backendServiceUrl = manifest.backend_service_url;
    if (manifest.icon) updateData.icon = manifest.icon;
    if (manifest.status) updateData.status = manifest.status;
    if (manifest.capabilities) updateData.capabilities = JSON.stringify(manifest.capabilities);
    if (manifest.min_plan !== void 0) updateData.minPlan = manifest.min_plan;
    if (manifest.tenant_restricted !== void 0) updateData.tenantRestricted = manifest.tenant_restricted;
    if (manifest.config_schema !== void 0) updateData.configSchema = manifest.config_schema;
    await db.update(moduleRegistry).set(updateData).where(eq2(moduleRegistry.moduleKey, key));
    const updated = await db.select().from(moduleRegistry).where(eq2(moduleRegistry.moduleKey, key)).limit(1);
    return res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error("[Registry] Update error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router2.delete("/modules/:key", requireAdmin, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const key = req.params.key;
    const existing = await db.select().from(moduleRegistry).where(eq2(moduleRegistry.moduleKey, key)).limit(1);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: { code: "MODULE_NOT_FOUND" } });
    }
    await db.delete(moduleRegistry).where(eq2(moduleRegistry.moduleKey, key));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Registry] Delete error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router2.post("/modules/scaffold", requireAdmin, async (req, res) => {
  try {
    const { slug, name, description, icon, mountType, backendLanguage, databaseMode, capabilities, port } = req.body;
    if (!slug || !name) {
      return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "slug e name s\xE3o obrigat\xF3rios" } });
    }
    const zipBuffer = await generateScaffoldZip({
      slug,
      name,
      description,
      icon,
      mountType: mountType || "iframe",
      backendLanguage: backendLanguage || "python",
      databaseMode: databaseMode || "shared",
      capabilities: capabilities || [],
      port: port || 4004
    });
    const base64 = zipBuffer.toString("base64");
    return res.json({ success: true, data: { base64, filename: `scaffold-${slug}.tar.gz` } });
  } catch (error) {
    console.error("[Registry] Scaffold error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// src/tenants/routes.ts
import { Router as Router3 } from "express";
import bcrypt2 from "bcryptjs";
import { eq as eq3, and, desc, sql, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
var router3 = Router3();
function getTenantId(req) {
  const id = req.headers["x-viao-tenant-id"];
  return id ? Number(id) : null;
}
function getUserId(req) {
  const id = req.headers["x-viao-user-id"];
  return id ? Number(id) : null;
}
function requireAuth(req, res, next) {
  if (!getUserId(req)) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED" } });
  }
  next();
}
function requireAdmin2(req, res, next) {
  const roles = req.headers["x-viao-platform-roles"];
  if (!roles || !roles.includes("admin")) {
    return res.status(403).json({ success: false, error: { code: "FORBIDDEN" } });
  }
  next();
}
function hasPlatformAdmin(req) {
  const roles = String(req.headers["x-viao-platform-roles"] || "");
  return roles.includes("admin");
}
function hasTenantAdminRole(req) {
  const companyRole = String(req.headers["x-viao-company-role"] || "");
  return ["owner", "admin"].some((role) => companyRole.split(",").map((value) => value.trim()).includes(role));
}
function requireTenantAdmin(req, res, next) {
  if (hasPlatformAdmin(req)) {
    return next();
  }
  if (hasTenantAdminRole(req)) {
    return next();
  }
  return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Apenas administradores podem gerir equipas" } });
}
router3.get("/company", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const result = await db.select().from(companies).where(eq3(companies.id, tenantId)).limit(1);
    if (result.length === 0) return res.status(404).json({ success: false, error: { code: "NOT_FOUND" } });
    const company = result[0];
    const plan = company.planId ? (await db.select().from(plans).where(eq3(plans.id, company.planId)).limit(1))[0] : null;
    const members = await db.select().from(users).where(eq3(users.companyId, tenantId));
    return res.json({
      success: true,
      data: {
        ...company,
        plan,
        memberCount: members.length
      }
    });
  } catch (error) {
    console.error("[Tenants] Company error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.put("/company", requireTenantAdmin, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const { name, sector, email, phone, address, website } = req.body;
    const updateData = { updatedAt: /* @__PURE__ */ new Date() };
    if (name) updateData.name = name;
    if (sector !== void 0) updateData.sector = sector;
    if (email !== void 0) updateData.email = email;
    if (phone !== void 0) updateData.phone = phone;
    if (address !== void 0) updateData.address = address;
    if (website !== void 0) updateData.website = website;
    await db.update(companies).set(updateData).where(eq3(companies.id, tenantId));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Update company error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.get("/members", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const members = await db.select().from(users).where(eq3(users.companyId, tenantId));
    return res.json({
      success: true,
      data: members.map((m) => ({ ...m, passwordHash: void 0 }))
    });
  } catch (error) {
    console.error("[Tenants] Members error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.delete("/members/:userId", requireTenantAdmin, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const targetId = Number(req.params.userId);
    const targetMember = (await db.select().from(users).where(and(eq3(users.id, targetId), eq3(users.companyId, tenantId))).limit(1))[0];
    if (!targetMember) {
      return res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "Membro n\xE3o encontrado nesta empresa" } });
    }
    if (targetMember.companyRole === "owner" && !hasPlatformAdmin(req)) {
      return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "O propriet\xE1rio principal da empresa n\xE3o pode ser removido" } });
    }
    const companyTeams = await db.select({ id: teams.id }).from(teams).where(eq3(teams.companyId, tenantId));
    const companyTeamIds = companyTeams.map((team) => team.id);
    if (companyTeamIds.length > 0) {
      await db.delete(teamMembers).where(and(inArray(teamMembers.teamId, companyTeamIds), eq3(teamMembers.userId, targetId)));
    }
    await db.update(users).set({ companyId: null, companyRole: null }).where(and(eq3(users.id, targetId), eq3(users.companyId, tenantId)));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Remove member error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.put("/members/:userId/role", requireTenantAdmin, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const targetId = Number(req.params.userId);
    const { role } = req.body;
    if (!["owner", "admin", "member"].includes(role)) {
      return res.status(400).json({ success: false, error: { code: "INVALID_ROLE" } });
    }
    const targetMember = (await db.select().from(users).where(and(eq3(users.id, targetId), eq3(users.companyId, tenantId))).limit(1))[0];
    if (!targetMember) {
      return res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "Membro n\xE3o encontrado nesta empresa" } });
    }
    if (targetMember.companyRole === "owner" && role !== "owner" && !hasPlatformAdmin(req)) {
      return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "O propriet\xE1rio principal da empresa n\xE3o pode perder privil\xE9gios de propriet\xE1rio" } });
    }
    await db.update(users).set({ companyRole: role }).where(and(eq3(users.id, targetId), eq3(users.companyId, tenantId)));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Change role error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.get("/teams", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const companyTeams = await db.select().from(teams).where(eq3(teams.companyId, tenantId));
    if (companyTeams.length === 0) {
      return res.json({ success: true, data: [] });
    }
    const teamIds = companyTeams.map((team) => team.id);
    const memberships = await db.select().from(teamMembers).where(inArray(teamMembers.teamId, teamIds));
    const userIds = [...new Set(memberships.map((membership) => membership.userId))];
    const companyUsers = userIds.length > 0 ? await db.select().from(users).where(and(eq3(users.companyId, tenantId), inArray(users.id, userIds))) : [];
    const usersById = new Map(companyUsers.map((user) => [user.id, user]));
    const enrichedTeams = companyTeams.map((team) => {
      const members = memberships.filter((membership) => membership.teamId === team.id).map((membership) => usersById.get(membership.userId)).filter(Boolean).map((member) => ({
        id: member.id,
        name: member.name,
        email: member.email,
        companyRole: member.companyRole,
        createdAt: member.createdAt,
        updatedAt: member.updatedAt
      }));
      return {
        ...team,
        memberCount: members.length,
        members
      };
    });
    return res.json({ success: true, data: enrichedTeams });
  } catch (error) {
    console.error("[Tenants] Teams error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.post("/teams", requireTenantAdmin, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ success: false, error: { code: "MISSING_NAME" } });
    const result = await db.insert(teams).values({ companyId: tenantId, name, description: description || null }).returning();
    return res.status(201).json({ success: true, data: result[0] });
  } catch (error) {
    console.error("[Tenants] Create team error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.delete("/teams/:teamId", requireTenantAdmin, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const teamId = Number(req.params.teamId);
    const team = (await db.select().from(teams).where(and(eq3(teams.id, teamId), eq3(teams.companyId, tenantId))).limit(1))[0];
    if (!team) {
      return res.status(404).json({ success: false, error: { code: "TEAM_NOT_FOUND", message: "Equipa n\xE3o encontrada" } });
    }
    await db.delete(teamMembers).where(eq3(teamMembers.teamId, teamId));
    await db.delete(teams).where(and(eq3(teams.id, teamId), eq3(teams.companyId, tenantId)));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Delete team error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.post("/teams/:teamId/members", requireTenantAdmin, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const teamId = Number(req.params.teamId);
    const userId = Number(req.body?.userId);
    if (!teamId || !userId) {
      return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "teamId e userId s\xE3o obrigat\xF3rios" } });
    }
    const team = (await db.select().from(teams).where(and(eq3(teams.id, teamId), eq3(teams.companyId, tenantId))).limit(1))[0];
    if (!team) {
      return res.status(404).json({ success: false, error: { code: "TEAM_NOT_FOUND", message: "Equipa n\xE3o encontrada" } });
    }
    const user = (await db.select().from(users).where(and(eq3(users.id, userId), eq3(users.companyId, tenantId))).limit(1))[0];
    if (!user) {
      return res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "Membro n\xE3o encontrado nesta empresa" } });
    }
    const existingMembership = (await db.select().from(teamMembers).where(and(eq3(teamMembers.teamId, teamId), eq3(teamMembers.userId, userId))).limit(1))[0];
    if (existingMembership) {
      return res.json({ success: true, data: existingMembership });
    }
    const result = await db.insert(teamMembers).values({ teamId, userId, role: "member" }).returning();
    return res.status(201).json({ success: true, data: result[0] });
  } catch (error) {
    console.error("[Tenants] Add team member error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.delete("/teams/:teamId/members/:userId", requireTenantAdmin, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const teamId = Number(req.params.teamId);
    const userId = Number(req.params.userId);
    const team = (await db.select().from(teams).where(and(eq3(teams.id, teamId), eq3(teams.companyId, tenantId))).limit(1))[0];
    if (!team) {
      return res.status(404).json({ success: false, error: { code: "TEAM_NOT_FOUND", message: "Equipa n\xE3o encontrada" } });
    }
    await db.delete(teamMembers).where(and(eq3(teamMembers.teamId, teamId), eq3(teamMembers.userId, userId)));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Remove team member error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.get("/invitations", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const pending = await db.select().from(invitations).where(and(eq3(invitations.companyId, tenantId), eq3(invitations.status, "pending")));
    return res.json({ success: true, data: pending });
  } catch (error) {
    console.error("[Tenants] Invitations error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.post("/invitations", requireTenantAdmin, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const rawEmail = String(req.body?.email || "").trim().toLowerCase();
    const teamId = req.body?.teamId ? Number(req.body.teamId) : null;
    const role = req.body?.role && ["owner", "admin", "member"].includes(req.body.role) ? req.body.role : "member";
    if (!rawEmail) return res.status(400).json({ success: false, error: { code: "MISSING_EMAIL" } });
    let targetTeam = null;
    if (teamId) {
      targetTeam = (await db.select().from(teams).where(and(eq3(teams.id, teamId), eq3(teams.companyId, tenantId))).limit(1))[0] || null;
      if (!targetTeam) {
        return res.status(404).json({ success: false, error: { code: "TEAM_NOT_FOUND", message: "Equipa n\xE3o encontrada" } });
      }
    }
    const existingUser = (await db.select().from(users).where(eq3(users.email, rawEmail)).limit(1))[0] || null;
    if (existingUser) {
      if (existingUser.companyId && existingUser.companyId !== tenantId) {
        return res.status(409).json({ success: false, error: { code: "USER_ALREADY_ASSIGNED", message: "Este utilizador j\xE1 pertence a outra empresa" } });
      }
      await db.update(users).set({
        companyId: tenantId,
        companyRole: role,
        updatedAt: /* @__PURE__ */ new Date()
      }).where(eq3(users.id, existingUser.id));
      if (teamId) {
        const existingMembership = (await db.select().from(teamMembers).where(and(eq3(teamMembers.teamId, teamId), eq3(teamMembers.userId, existingUser.id))).limit(1))[0] || null;
        if (!existingMembership) {
          await db.insert(teamMembers).values({ teamId, userId: existingUser.id, role: "member" });
        }
      }
      return res.status(201).json({
        success: true,
        data: {
          attached: true,
          existingUser: true,
          userId: existingUser.id,
          email: rawEmail,
          teamId: targetTeam?.id || null
        }
      });
    }
    const token = nanoid(32);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3);
    await db.insert(invitations).values({
      companyId: tenantId,
      teamId: teamId || null,
      email: rawEmail,
      role,
      token,
      status: "pending",
      expiresAt
    });
    return res.status(201).json({ success: true, data: { token, email: rawEmail, expiresAt } });
  } catch (error) {
    console.error("[Tenants] Create invitation error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.get("/tokens", requireAuth, async (req, res) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const company = (await db.select().from(companies).where(eq3(companies.id, tenantId)).limit(1))[0];
    const transactions = await db.select().from(tokenTransactions).where(eq3(tokenTransactions.companyId, tenantId)).orderBy(desc(tokenTransactions.createdAt));
    return res.json({
      success: true,
      data: {
        balance: { internal: company?.tokensBalance || 0, external: company?.externalTokensBalance || 0 },
        transactions
      }
    });
  } catch (error) {
    console.error("[Tenants] Tokens error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.get("/plans", async (_req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const allPlans = await db.select().from(plans);
    return res.json({ success: true, data: allPlans });
  } catch (error) {
    console.error("[Tenants] Plans error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.get("/admin/companies", requireAdmin2, async (_req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const allCompanies = await db.select().from(companies);
    return res.json({ success: true, data: allCompanies });
  } catch (error) {
    console.error("[Tenants] Admin companies error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.get("/admin/plans", requireAdmin2, async (_req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const allPlans = await db.select().from(plans);
    return res.json({ success: true, data: allPlans });
  } catch (error) {
    console.error("[Tenants] Admin plans error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.get("/admin/users", requireAdmin2, async (_req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const allUsers = await db.select().from(users);
    return res.json({ success: true, data: allUsers.map((u) => ({ ...u, passwordHash: void 0 })) });
  } catch (error) {
    console.error("[Tenants] Admin users error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.get("/admin/companies/:companyId", requireAdmin2, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const companyId = Number(req.params.companyId);
    const company = (await db.select().from(companies).where(eq3(companies.id, companyId)).limit(1))[0];
    if (!company) return res.status(404).json({ success: false, error: { code: "NOT_FOUND" } });
    const plan = company.planId ? (await db.select().from(plans).where(eq3(plans.id, company.planId)).limit(1))[0] : null;
    const members = await db.select().from(users).where(eq3(users.companyId, companyId));
    return res.json({ success: true, data: { company, plan, members: members.map((m) => ({ ...m, passwordHash: void 0 })) } });
  } catch (error) {
    console.error("[Tenants] Admin company detail error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.post("/admin/companies/:companyId/tokens", requireAdmin2, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const companyId = Number(req.params.companyId);
    const { amount, source, description } = req.body;
    if (!amount) return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS" } });
    const isExternal = source === "external";
    await db.insert(tokenTransactions).values({
      companyId,
      type: "credit",
      source: isExternal ? "external" : "admin_grant",
      amount,
      description: description || "Tokens atribu\xEDdos pelo administrador"
    });
    if (isExternal) {
      await db.update(companies).set({ externalTokensBalance: sql`external_tokens_balance + ${amount}` }).where(eq3(companies.id, companyId));
    } else {
      await db.update(companies).set({ tokensBalance: sql`tokens_balance + ${amount}` }).where(eq3(companies.id, companyId));
    }
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Admin grant tokens (URL) error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.put("/admin/companies/:companyId/plan", requireAdmin2, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const companyId = Number(req.params.companyId);
    const { planId } = req.body;
    const parsedPlanId = planId === null || planId === "" || planId === void 0 ? null : Number(planId);
    if (parsedPlanId !== null && !Number.isFinite(parsedPlanId)) {
      return res.status(400).json({ success: false, error: { code: "INVALID_PLAN" } });
    }
    await db.update(companies).set({ planId: parsedPlanId, updatedAt: /* @__PURE__ */ new Date() }).where(eq3(companies.id, companyId));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Admin assign plan (URL) error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.get("/admin/tokens/transactions", requireAdmin2, async (_req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const transactions = await db.select().from(tokenTransactions).orderBy(desc(tokenTransactions.createdAt));
    return res.json({ success: true, data: transactions });
  } catch (error) {
    console.error("[Tenants] Admin transactions error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.post("/admin/grant-tokens", requireAdmin2, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const { companyId, amount, source, description } = req.body;
    if (!companyId || !amount) return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS" } });
    const isExternal = source === "external";
    await db.insert(tokenTransactions).values({
      companyId,
      type: "credit",
      source: isExternal ? "external" : "admin_grant",
      amount,
      description: description || "Tokens atribu\xEDdos pelo administrador"
    });
    if (isExternal) {
      await db.update(companies).set({ externalTokensBalance: sql`external_tokens_balance + ${amount}` }).where(eq3(companies.id, companyId));
    } else {
      await db.update(companies).set({ tokensBalance: sql`tokens_balance + ${amount}` }).where(eq3(companies.id, companyId));
    }
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Grant tokens error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.put("/admin/assign-plan", requireAdmin2, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const { companyId, planId } = req.body;
    if (!companyId) return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS" } });
    const parsedPlanId = planId === null || planId === "" || planId === void 0 ? null : Number(planId);
    if (parsedPlanId !== null && !Number.isFinite(parsedPlanId)) {
      return res.status(400).json({ success: false, error: { code: "INVALID_PLAN" } });
    }
    await db.update(companies).set({ planId: parsedPlanId, updatedAt: /* @__PURE__ */ new Date() }).where(eq3(companies.id, companyId));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Assign plan error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.post("/admin/plans", requireAdmin2, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const { name, description, monthlyPrice, yearlyPrice, tokensPerMonth, maxMembers, maxTeams, maxModules, features, isActive, sortOrder } = req.body;
    if (!name) return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "name \xE9 obrigat\xF3rio" } });
    const result = await db.insert(plans).values({
      name,
      description: description || null,
      monthlyPrice: monthlyPrice || 0,
      yearlyPrice: yearlyPrice || 0,
      tokensPerMonth: tokensPerMonth || 0,
      maxMembers: maxMembers || 5,
      maxTeams: maxTeams || 1,
      maxModules: maxModules || 2,
      features: features || null,
      isActive: isActive !== void 0 ? isActive : true,
      sortOrder: sortOrder || 0
    }).returning();
    return res.status(201).json({ success: true, data: result[0] });
  } catch (error) {
    console.error("[Tenants] Create plan error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.put("/admin/plans/:planId", requireAdmin2, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const planId = Number(req.params.planId);
    const updateData = { updatedAt: /* @__PURE__ */ new Date() };
    const fields = ["name", "description", "monthlyPrice", "yearlyPrice", "tokensPerMonth", "maxMembers", "maxTeams", "maxModules", "features", "isActive", "sortOrder"];
    for (const field of fields) {
      if (req.body[field] !== void 0) updateData[field] = req.body[field];
    }
    await db.update(plans).set(updateData).where(eq3(plans.id, planId));
    const updated = await db.select().from(plans).where(eq3(plans.id, planId)).limit(1);
    if (updated.length === 0) return res.status(404).json({ success: false, error: { code: "NOT_FOUND" } });
    return res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error("[Tenants] Update plan error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.delete("/admin/plans/:planId", requireAdmin2, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const planId = Number(req.params.planId);
    await db.update(companies).set({ planId: null, updatedAt: /* @__PURE__ */ new Date() }).where(eq3(companies.planId, planId));
    await db.delete(plans).where(eq3(plans.id, planId));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Delete plan error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.post("/admin/companies", requireAdmin2, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const { name, sector, email, phone, address, website, planId, ownerEmail, ownerPassword, ownerName } = req.body;
    const normalizedName = String(name || "").trim();
    if (!normalizedName) return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "name \xE9 obrigat\xF3rio" } });
    const normalizedOwnerEmail = String(ownerEmail || email || "").trim().toLowerCase();
    if (!normalizedOwnerEmail) {
      return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "ownerEmail \xE9 obrigat\xF3rio" } });
    }
    const normalizedOwnerPassword = String(ownerPassword || "");
    if (normalizedOwnerPassword.length < 6) {
      return res.status(400).json({ success: false, error: { code: "INVALID_PASSWORD", message: "ownerPassword deve ter pelo menos 6 caracteres" } });
    }
    const existingUser = await db.select({ id: users.id }).from(users).where(eq3(users.email, normalizedOwnerEmail)).limit(1);
    if (existingUser.length > 0) {
      return res.status(409).json({ success: false, error: { code: "EMAIL_EXISTS", message: "Este email j\xE1 est\xE1 registado" } });
    }
    const normalizedPlanId = planId !== void 0 && planId !== null && planId !== "" ? Number(planId) : null;
    if (normalizedPlanId !== null && !Number.isFinite(normalizedPlanId)) {
      return res.status(400).json({ success: false, error: { code: "INVALID_PLAN", message: "planId inv\xE1lido" } });
    }
    const result = await db.insert(companies).values({
      name: normalizedName,
      sector: sector || null,
      email: String(email || normalizedOwnerEmail || "").trim() || null,
      phone: phone || null,
      address: address || null,
      website: website || null,
      planId: normalizedPlanId
    }).returning();
    const company = result[0];
    try {
      const passwordHash = await bcrypt2.hash(normalizedOwnerPassword, 12);
      const ownerResult = await db.insert(users).values({
        email: normalizedOwnerEmail,
        name: String(ownerName || "").trim() || normalizedName,
        passwordHash,
        loginMethod: "email",
        platformRole: "user",
        companyId: company.id,
        companyRole: "owner",
        lastSignedIn: /* @__PURE__ */ new Date()
      }).returning();
      const owner = ownerResult[0];
      return res.status(201).json({
        success: true,
        data: {
          ...company,
          owner: {
            id: owner.id,
            email: owner.email,
            name: owner.name,
            companyRole: owner.companyRole
          }
        }
      });
    } catch (ownerError) {
      await db.delete(companies).where(eq3(companies.id, company.id));
      throw ownerError;
    }
  } catch (error) {
    console.error("[Tenants] Create company error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.put("/admin/companies/:companyId", requireAdmin2, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const companyId = Number(req.params.companyId);
    if (!Number.isFinite(companyId) || companyId <= 0) {
      return res.status(400).json({ success: false, error: { code: "INVALID_COMPANY_ID" } });
    }
    const existingCompany = (await db.select().from(companies).where(eq3(companies.id, companyId)).limit(1))[0];
    if (!existingCompany) {
      return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Tenant n\xE3o encontrado" } });
    }
    const normalizedOwnerPassword = req.body.ownerPassword === void 0 || req.body.ownerPassword === null ? "" : String(req.body.ownerPassword);
    const normalizedOwnerEmail = String(req.body.ownerEmail || req.body.email || existingCompany.email || "").trim().toLowerCase();
    if (normalizedOwnerPassword && normalizedOwnerPassword.length < 6) {
      return res.status(400).json({ success: false, error: { code: "INVALID_PASSWORD", message: "ownerPassword deve ter pelo menos 6 caracteres" } });
    }
    const ownerUsers = normalizedOwnerPassword ? await db.select({ id: users.id }).from(users).where(and(eq3(users.companyId, companyId), eq3(users.companyRole, "owner"))) : [];
    let ownerIds = ownerUsers.map((owner) => owner.id);
    let ownerPasswordHash = null;
    if (normalizedOwnerPassword) {
      ownerPasswordHash = await bcrypt2.hash(normalizedOwnerPassword, 12);
    }
    if (normalizedOwnerPassword && ownerIds.length === 0) {
      if (!normalizedOwnerEmail) {
        return res.status(404).json({ success: false, error: { code: "OWNER_NOT_FOUND", message: "N\xE3o foi encontrado um utilizador propriet\xE1rio para este tenant" } });
      }
      const existingOwnerByEmail = (await db.select().from(users).where(eq3(users.email, normalizedOwnerEmail)).limit(1))[0];
      if (existingOwnerByEmail) {
        if (existingOwnerByEmail.companyId && existingOwnerByEmail.companyId !== companyId) {
          return res.status(409).json({ success: false, error: { code: "USER_ALREADY_ASSIGNED", message: "O utilizador j\xE1 pertence a outro tenant" } });
        }
        await db.update(users).set({
          companyId,
          companyRole: "owner",
          loginMethod: "email",
          passwordHash: ownerPasswordHash,
          updatedAt: /* @__PURE__ */ new Date()
        }).where(eq3(users.id, existingOwnerByEmail.id));
        ownerIds = [existingOwnerByEmail.id];
      } else {
        const createdOwner = (await db.insert(users).values({
          email: normalizedOwnerEmail,
          name: String(req.body.ownerName || existingCompany.name || normalizedOwnerEmail.split("@")[0] || "").trim() || normalizedOwnerEmail,
          passwordHash: ownerPasswordHash,
          loginMethod: "email",
          platformRole: "user",
          companyId,
          companyRole: "owner",
          lastSignedIn: /* @__PURE__ */ new Date()
        }).returning({ id: users.id }))[0];
        ownerIds = [createdOwner.id];
      }
    }
    const updateData = { updatedAt: /* @__PURE__ */ new Date() };
    const fields = ["name", "sector", "email", "phone", "address", "website"];
    for (const field of fields) {
      if (req.body[field] !== void 0) updateData[field] = req.body[field];
    }
    if (req.body.planId !== void 0) {
      if (req.body.planId === null || req.body.planId === "") {
        updateData.planId = null;
      } else {
        const parsedPlanId = Number(req.body.planId);
        if (!Number.isFinite(parsedPlanId)) {
          return res.status(400).json({ success: false, error: { code: "INVALID_PLAN", message: "planId inv\xE1lido" } });
        }
        updateData.planId = parsedPlanId;
      }
    }
    if (typeof updateData.name === "string") {
      updateData.name = String(updateData.name).trim();
      if (!updateData.name) {
        return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "name \xE9 obrigat\xF3rio" } });
      }
    }
    await db.update(companies).set(updateData).where(eq3(companies.id, companyId));
    if (normalizedOwnerPassword && ownerIds.length > 0 && ownerPasswordHash) {
      await db.update(users).set({ passwordHash: ownerPasswordHash, loginMethod: "email", updatedAt: /* @__PURE__ */ new Date() }).where(inArray(users.id, ownerIds));
    }
    const updated = await db.select().from(companies).where(eq3(companies.id, companyId)).limit(1);
    if (updated.length === 0) return res.status(404).json({ success: false, error: { code: "NOT_FOUND" } });
    return res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error("[Tenants] Update company error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router3.delete("/admin/companies/:companyId", requireAdmin2, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const companyId = Number(req.params.companyId);
    if (!Number.isFinite(companyId) || companyId <= 0) {
      return res.status(400).json({ success: false, error: { code: "INVALID_COMPANY_ID" } });
    }
    const company = (await db.select().from(companies).where(eq3(companies.id, companyId)).limit(1))[0];
    if (!company) {
      return res.status(404).json({ success: false, error: { code: "NOT_FOUND" } });
    }
    const companyTeams = await db.select({ id: teams.id }).from(teams).where(eq3(teams.companyId, companyId));
    const teamIds = companyTeams.map((team) => team.id);
    if (teamIds.length > 0) {
      await db.delete(modulePermissions).where(inArray(modulePermissions.teamId, teamIds));
      await db.delete(teamMembers).where(inArray(teamMembers.teamId, teamIds));
    }
    await db.delete(modulePermissions).where(eq3(modulePermissions.tenantId, companyId));
    await db.delete(tenantModules).where(eq3(tenantModules.tenantId, companyId));
    await db.delete(invitations).where(eq3(invitations.companyId, companyId));
    await db.delete(tokenTransactions).where(eq3(tokenTransactions.companyId, companyId));
    await db.delete(teams).where(eq3(teams.companyId, companyId));
    await db.update(users).set({ companyId: null, companyRole: null }).where(eq3(users.companyId, companyId));
    await db.delete(companies).where(eq3(companies.id, companyId));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Delete company error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// src/entitlements/routes.ts
import { Router as Router4 } from "express";
import { eq as eq4, and as and2 } from "drizzle-orm";
var router4 = Router4();
function getTenantId2(req) {
  const id = req.headers["x-viao-tenant-id"];
  return id ? Number(id) : null;
}
function getUserId2(req) {
  const id = req.headers["x-viao-user-id"];
  return id ? Number(id) : null;
}
function requireAuth2(req, res, next) {
  if (!getUserId2(req)) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED" } });
  }
  next();
}
function requireTenantAdmin2(req, res, next) {
  const platformRoles = String(req.headers["x-viao-platform-roles"] || "");
  if (platformRoles.includes("admin")) {
    return next();
  }
  const companyRole = String(req.headers["x-viao-company-role"] || "");
  if (["owner", "admin"].some((role) => companyRole.split(",").map((value) => value.trim()).includes(role))) {
    return next();
  }
  return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Apenas administradores do tenant podem gerir m\xF3dulos" } });
}
router4.get("/modules", requireAuth2, async (req, res) => {
  try {
    const tenantId = getTenantId2(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const tenantMods = await db.select().from(tenantModules).where(eq4(tenantModules.tenantId, tenantId));
    const allRegistry = await db.select().from(moduleRegistry);
    const enriched = tenantMods.map((tm) => {
      const reg = allRegistry.find((r) => r.moduleKey === tm.moduleKey);
      return {
        ...tm,
        name: reg?.name || tm.moduleKey,
        description: reg?.description,
        icon: reg?.icon,
        route: reg?.route,
        frontendMountType: reg?.frontendMountType,
        status: reg?.status
      };
    });
    return res.json({ success: true, data: enriched });
  } catch (error) {
    console.error("[Entitlements] List modules error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router4.put("/modules/:moduleKey", requireTenantAdmin2, async (req, res) => {
  try {
    const tenantId = getTenantId2(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const { moduleKey } = req.params;
    const { enabled } = req.body;
    const regEntry = await db.select().from(moduleRegistry).where(eq4(moduleRegistry.moduleKey, moduleKey)).limit(1);
    if (regEntry.length === 0) {
      return res.status(404).json({ success: false, error: { code: "MODULE_NOT_FOUND" } });
    }
    const existing = await db.select().from(tenantModules).where(and2(eq4(tenantModules.tenantId, tenantId), eq4(tenantModules.moduleKey, moduleKey))).limit(1);
    if (existing.length > 0) {
      await db.update(tenantModules).set({ enabled: enabled !== false, updatedAt: /* @__PURE__ */ new Date() }).where(eq4(tenantModules.id, existing[0].id));
    } else {
      await db.insert(tenantModules).values({
        tenantId,
        moduleKey,
        enabled: enabled !== false,
        visibilityMode: "global",
        rolloutState: "enabled"
      });
    }
    return res.json({ success: true });
  } catch (error) {
    console.error("[Entitlements] Toggle module error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router4.get("/modules/:moduleKey/permissions", requireTenantAdmin2, async (req, res) => {
  try {
    const tenantId = getTenantId2(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const { moduleKey } = req.params;
    const perms = await db.select().from(modulePermissions).where(and2(eq4(modulePermissions.tenantId, tenantId), eq4(modulePermissions.moduleKey, moduleKey)));
    return res.json({ success: true, data: perms });
  } catch (error) {
    console.error("[Entitlements] Get permissions error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router4.put("/modules/:moduleKey/permissions", requireTenantAdmin2, async (req, res) => {
  try {
    const tenantId = getTenantId2(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const { moduleKey } = req.params;
    const { permissions } = req.body;
    await db.delete(modulePermissions).where(and2(eq4(modulePermissions.tenantId, tenantId), eq4(modulePermissions.moduleKey, moduleKey)));
    if (permissions && permissions.length > 0) {
      await db.insert(modulePermissions).values(
        permissions.map((p) => ({
          tenantId,
          moduleKey,
          teamId: p.teamId ?? null,
          userId: p.userId ?? null
        }))
      );
    }
    return res.json({ success: true });
  } catch (error) {
    console.error("[Entitlements] Set permissions error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router4.get("/active", requireAuth2, async (req, res) => {
  try {
    const tenantId = getTenantId2(req);
    const userId = getUserId2(req);
    if (!tenantId || !userId) return res.status(400).json({ success: false, error: { code: "NO_CONTEXT" } });
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const enabledMods = await db.select().from(tenantModules).where(and2(eq4(tenantModules.tenantId, tenantId), eq4(tenantModules.enabled, true)));
    if (enabledMods.length === 0) return res.json({ success: true, data: [] });
    const allRegistry = await db.select().from(moduleRegistry);
    const userResult = await db.select().from(users).where(eq4(users.id, userId)).limit(1);
    const user = userResult[0];
    const isOwnerOrAdmin = user?.companyRole === "owner" || user?.companyRole === "admin";
    const userTeams = await db.select().from(teamMembers).where(eq4(teamMembers.userId, userId));
    const userTeamIds = userTeams.map((t) => t.teamId);
    const result = [];
    for (const tm of enabledMods) {
      const reg = allRegistry.find((r) => r.moduleKey === tm.moduleKey);
      if (!reg) continue;
      if (isOwnerOrAdmin) {
        result.push({ moduleKey: reg.moduleKey, name: reg.name, icon: reg.icon, route: reg.route, frontendMountType: reg.frontendMountType });
        continue;
      }
      const perms = await db.select().from(modulePermissions).where(and2(eq4(modulePermissions.tenantId, tenantId), eq4(modulePermissions.moduleKey, tm.moduleKey)));
      if (perms.length === 0) {
        result.push({ moduleKey: reg.moduleKey, name: reg.name, icon: reg.icon, route: reg.route, frontendMountType: reg.frontendMountType });
        continue;
      }
      const hasAccess = perms.some((p) => p.userId && p.userId === userId || p.teamId && userTeamIds.includes(p.teamId));
      if (hasAccess) {
        result.push({ moduleKey: reg.moduleKey, name: reg.name, icon: reg.icon, route: reg.route, frontendMountType: reg.frontendMountType });
      }
    }
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("[Entitlements] Active modules error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router4.get("/check", async (req, res) => {
  try {
    const tenantId = Number(req.query.tenantId);
    const moduleKey = req.query.moduleKey;
    if (!tenantId || !moduleKey) {
      return res.status(400).json({ success: false, error: { code: "MISSING_PARAMS" } });
    }
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const result = await db.select().from(tenantModules).where(and2(eq4(tenantModules.tenantId, tenantId), eq4(tenantModules.moduleKey, moduleKey))).limit(1);
    const enabled = result.length > 0 && result[0].enabled;
    return res.json({ success: true, data: { enabled } });
  } catch (error) {
    console.error("[Entitlements] Check error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// src/auth/password-reset.ts
import { Router as Router5 } from "express";
import bcrypt3 from "bcryptjs";
import { nanoid as nanoid2 } from "nanoid";
import { eq as eq5, and as and3, gt } from "drizzle-orm";

// src/email/service.ts
import nodemailer from "nodemailer";
var SMTP_HOST = process.env.SMTP_HOST || "mail.viaoceanica.com";
var SMTP_PORT = parseInt(process.env.SMTP_PORT || "587");
var SMTP_USER = process.env.SMTP_USER || "";
var SMTP_PASS = process.env.SMTP_PASS || "";
var SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
var APP_NAME = "Via Oce\xE2nica AI";
var _transporter = null;
function getTransporter() {
  if (!_transporter) {
    _transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      // 465=implicit TLS, 587=STARTTLS
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS
      },
      tls: {
        rejectUnauthorized: false
      }
    });
  }
  return _transporter;
}
async function sendEmail(options) {
  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"${APP_NAME}" <${SMTP_FROM}>`,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text || options.html.replace(/<[^>]*>/g, "")
    });
    console.log(`[Email] Sent to ${options.to}: ${options.subject}`);
    return true;
  } catch (error) {
    console.error("[Email] Send failed:", error);
    return false;
  }
}
async function sendPasswordResetEmail(options) {
  const { to, name, resetUrl, expiresInMinutes } = options;
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { margin: 0; padding: 0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f7f8fa; }
    .container { max-width: 560px; margin: 0 auto; padding: 40px 20px; }
    .card { background: #ffffff; border-radius: 12px; padding: 40px 32px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
    .logo { text-align: center; margin-bottom: 24px; }
    .logo span { font-size: 20px; font-weight: 700; color: #0f172a; }
    .logo .accent { color: #0d9e7a; }
    h1 { margin: 0 0 8px; font-size: 22px; font-weight: 700; color: #0f172a; text-align: center; }
    .subtitle { color: #64748b; font-size: 14px; text-align: center; margin: 0 0 28px; line-height: 1.5; }
    .btn-wrap { text-align: center; margin: 28px 0; }
    .btn { display: inline-block; background: #0d9e7a; color: #ffffff !important; text-decoration: none; padding: 12px 32px; border-radius: 8px; font-weight: 600; font-size: 14px; }
    .note { color: #64748b; font-size: 13px; text-align: center; line-height: 1.5; margin-top: 24px; }
    .url-fallback { word-break: break-all; color: #0d9e7a; font-size: 12px; text-align: center; margin-top: 16px; }
    .footer { text-align: center; color: #94a3b8; font-size: 12px; margin-top: 32px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="logo">
        <span><span class="accent">&gt;O</span> VIA OCE\xC2NICA</span>
      </div>
      <h1>Recuperar password</h1>
      <p class="subtitle">
        Ol\xE1 ${name},<br>
        Recebemos um pedido para redefinir a password da sua conta.
      </p>
      <div class="btn-wrap">
        <a href="${resetUrl}" class="btn">Redefinir password</a>
      </div>
      <p class="note">
        Este link expira em <strong>${expiresInMinutes} minutos</strong>.<br>
        Se n\xE3o solicitou esta altera\xE7\xE3o, pode ignorar este email.
      </p>
      <p class="url-fallback">
        Se o bot\xE3o n\xE3o funcionar, copie e cole este link no navegador:<br>
        ${resetUrl}
      </p>
    </div>
    <p class="footer">
      \xA9 ${(/* @__PURE__ */ new Date()).getFullYear()} Via Oce\xE2nica AI Platform<br>
      Este email foi enviado automaticamente. N\xE3o responda a esta mensagem.
    </p>
  </div>
</body>
</html>
  `.trim();
  return sendEmail({
    to,
    subject: `${APP_NAME} \u2014 Recuperar password`,
    html
  });
}

// src/auth/password-reset.ts
var router5 = Router5();
var RESET_TOKEN_EXPIRY_MINUTES = 30;
var APP_BASE_URL = process.env.APP_BASE_URL || "http://77.42.95.216:8200";
router5.post("/forgot-password", async (req, res) => {
  try {
    const { email, origin } = req.body;
    if (!email) {
      return res.status(400).json({
        success: false,
        error: { code: "MISSING_EMAIL", message: "Email \xE9 obrigat\xF3rio" }
      });
    }
    const db = await getDb();
    if (!db) {
      return res.status(503).json({
        success: false,
        error: { code: "DB_UNAVAILABLE", message: "Base de dados indispon\xEDvel" }
      });
    }
    const result = await db.select().from(users).where(eq5(users.email, email.toLowerCase().trim())).limit(1);
    if (result.length === 0) {
      console.log(`[Auth] Password reset requested for non-existent email: ${email}`);
      return res.json({ success: true, message: "Se o email estiver registado, receber\xE1 instru\xE7\xF5es." });
    }
    const user = result[0];
    await db.update(passwordResetTokens).set({ used: true }).where(and3(eq5(passwordResetTokens.userId, user.id), eq5(passwordResetTokens.used, false)));
    const token = nanoid2(64);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_EXPIRY_MINUTES * 60 * 1e3);
    await db.insert(passwordResetTokens).values({
      userId: user.id,
      token,
      expiresAt,
      used: false
    });
    const baseUrl = origin || APP_BASE_URL;
    const resetUrl = `${baseUrl}/reset-password/${token}`;
    const sent = await sendPasswordResetEmail({
      to: user.email,
      name: user.name || "Utilizador",
      resetUrl,
      expiresInMinutes: RESET_TOKEN_EXPIRY_MINUTES
    });
    if (!sent) {
      console.error(`[Auth] Failed to send password reset email to ${user.email}`);
      return res.status(500).json({
        success: false,
        error: { code: "EMAIL_FAILED", message: "Erro ao enviar email. Tente novamente mais tarde." }
      });
    }
    console.log(`[Auth] Password reset email sent to ${user.email} (token expires at ${expiresAt.toISOString()})`);
    return res.json({ success: true, message: "Se o email estiver registado, receber\xE1 instru\xE7\xF5es." });
  } catch (error) {
    console.error("[Auth] Forgot password error:", error);
    return res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Erro interno" }
    });
  }
});
router5.get("/verify-reset-token", async (req, res) => {
  try {
    const { token } = req.query;
    if (!token || typeof token !== "string") {
      return res.status(400).json({
        success: false,
        error: { code: "MISSING_TOKEN", message: "Token \xE9 obrigat\xF3rio" }
      });
    }
    const db = await getDb();
    if (!db) {
      return res.status(503).json({
        success: false,
        error: { code: "DB_UNAVAILABLE" }
      });
    }
    const result = await db.select().from(passwordResetTokens).where(
      and3(
        eq5(passwordResetTokens.token, token),
        eq5(passwordResetTokens.used, false),
        gt(passwordResetTokens.expiresAt, /* @__PURE__ */ new Date())
      )
    ).limit(1);
    if (result.length === 0) {
      return res.json({ success: true, data: { valid: false } });
    }
    return res.json({ success: true, data: { valid: true } });
  } catch (error) {
    console.error("[Auth] Verify reset token error:", error);
    return res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR" }
    });
  }
});
router5.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        error: { code: "MISSING_FIELDS", message: "Token e nova password s\xE3o obrigat\xF3rios" }
      });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: { code: "WEAK_PASSWORD", message: "A password deve ter pelo menos 6 caracteres" }
      });
    }
    const db = await getDb();
    if (!db) {
      return res.status(503).json({
        success: false,
        error: { code: "DB_UNAVAILABLE" }
      });
    }
    const tokenResult = await db.select().from(passwordResetTokens).where(
      and3(
        eq5(passwordResetTokens.token, token),
        eq5(passwordResetTokens.used, false),
        gt(passwordResetTokens.expiresAt, /* @__PURE__ */ new Date())
      )
    ).limit(1);
    if (tokenResult.length === 0) {
      return res.status(400).json({
        success: false,
        error: {
          code: "INVALID_TOKEN",
          message: "Token inv\xE1lido ou expirado. Solicite um novo link de recupera\xE7\xE3o."
        }
      });
    }
    const resetToken = tokenResult[0];
    const passwordHash = await bcrypt3.hash(newPassword, 12);
    await db.update(users).set({ passwordHash }).where(eq5(users.id, resetToken.userId));
    await db.update(passwordResetTokens).set({ used: true }).where(eq5(passwordResetTokens.id, resetToken.id));
    console.log(`[Auth] Password reset successful for user ID ${resetToken.userId}`);
    return res.json({ success: true, message: "Password atualizada com sucesso." });
  } catch (error) {
    console.error("[Auth] Reset password error:", error);
    return res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Erro interno" }
    });
  }
});

// src/billing/routes.ts
import { Router as Router6 } from "express";
import { eq as eq6, desc as desc2, and as and4 } from "drizzle-orm";
var router6 = Router6();
function getTenantId3(req) {
  const id = req.headers["x-viao-tenant-id"];
  return id ? Number(id) : null;
}
function getUserId3(req) {
  const id = req.headers["x-viao-user-id"];
  return id ? Number(id) : null;
}
function requireAuth3(req, res, next) {
  if (!getUserId3(req)) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED" } });
  }
  next();
}
function requireTenant(req, res, next) {
  if (!getTenantId3(req)) {
    return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });
  }
  next();
}
function requireAdmin3(req, res, next) {
  const role = req.headers["x-viao-platform-role"];
  if (role !== "admin") {
    return res.status(403).json({ success: false, error: { code: "FORBIDDEN" } });
  }
  next();
}
router6.get("/billing/profile", requireAuth3, requireTenant, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const tenantId = getTenantId3(req);
    const [profile] = await db.select().from(billingProfiles).where(eq6(billingProfiles.companyId, tenantId)).limit(1);
    const [company] = await db.select().from(companies).where(eq6(companies.id, tenantId)).limit(1);
    let plan = null;
    if (company?.planId) {
      const [p] = await db.select().from(plans).where(eq6(plans.id, company.planId)).limit(1);
      plan = p || null;
    }
    return res.json({
      success: true,
      data: {
        profile: profile || null,
        company: company ? { id: company.id, name: company.name, email: company.email, phone: company.phone } : null,
        plan: plan ? { id: plan.id, name: plan.name, monthlyPrice: plan.monthlyPrice, yearlyPrice: plan.yearlyPrice } : null
      }
    });
  } catch (error) {
    console.error("[Billing] Get profile error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router6.put("/billing/profile", requireAuth3, requireTenant, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const tenantId = getTenantId3(req);
    const {
      legalName,
      nif,
      address,
      postalCode,
      city,
      country,
      email,
      phone,
      preferredPaymentMethod,
      billingCycle,
      notes
    } = req.body;
    const [existing] = await db.select().from(billingProfiles).where(eq6(billingProfiles.companyId, tenantId)).limit(1);
    if (existing) {
      await db.update(billingProfiles).set({
        legalName: legalName ?? existing.legalName,
        nif: nif ?? existing.nif,
        address: address ?? existing.address,
        postalCode: postalCode ?? existing.postalCode,
        city: city ?? existing.city,
        country: country ?? existing.country,
        email: email ?? existing.email,
        phone: phone ?? existing.phone,
        preferredPaymentMethod: preferredPaymentMethod ?? existing.preferredPaymentMethod,
        billingCycle: billingCycle ?? existing.billingCycle,
        notes: notes ?? existing.notes,
        updatedAt: /* @__PURE__ */ new Date()
      }).where(eq6(billingProfiles.id, existing.id));
    } else {
      await db.insert(billingProfiles).values({
        companyId: tenantId,
        legalName,
        nif,
        address,
        postalCode,
        city,
        country: country || "Portugal",
        email,
        phone,
        preferredPaymentMethod: preferredPaymentMethod || "bank_transfer",
        billingCycle: billingCycle || "monthly",
        notes
      });
    }
    const [profile] = await db.select().from(billingProfiles).where(eq6(billingProfiles.companyId, tenantId)).limit(1);
    return res.json({ success: true, data: profile });
  } catch (error) {
    console.error("[Billing] Update profile error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router6.get("/billing/invoices", requireAuth3, requireTenant, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const tenantId = getTenantId3(req);
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Number(req.query.offset) || 0;
    const result = await db.select().from(invoices).where(eq6(invoices.companyId, tenantId)).orderBy(desc2(invoices.createdAt)).limit(limit).offset(offset);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("[Billing] List invoices error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router6.get("/billing/invoices/:id", requireAuth3, requireTenant, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const tenantId = getTenantId3(req);
    const invoiceId = Number(req.params.id);
    const [invoice] = await db.select().from(invoices).where(and4(eq6(invoices.id, invoiceId), eq6(invoices.companyId, tenantId))).limit(1);
    if (!invoice) {
      return res.status(404).json({ success: false, error: { code: "NOT_FOUND" } });
    }
    return res.json({ success: true, data: invoice });
  } catch (error) {
    console.error("[Billing] Get invoice error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router6.post("/admin/billing/invoices", requireAdmin3, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const {
      companyId,
      planId,
      planName,
      billingCycle,
      periodStart,
      periodEnd,
      subtotal,
      taxRate,
      notes
    } = req.body;
    if (!companyId || subtotal === void 0) {
      return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS" } });
    }
    const year = (/* @__PURE__ */ new Date()).getFullYear();
    const existingCount = await db.select().from(invoices);
    const nextNum = existingCount.length + 1;
    const invoiceNumber = `VIAO-${year}-${String(nextNum).padStart(4, "0")}`;
    const effectiveTaxRate = taxRate ?? 23;
    const taxAmount = Math.round(subtotal * effectiveTaxRate / 100);
    const total = subtotal + taxAmount;
    const dueDate = /* @__PURE__ */ new Date();
    dueDate.setDate(dueDate.getDate() + 30);
    await db.insert(invoices).values({
      companyId,
      invoiceNumber,
      status: "pending",
      billingCycle: billingCycle || "monthly",
      periodStart: periodStart ? new Date(periodStart) : null,
      periodEnd: periodEnd ? new Date(periodEnd) : null,
      subtotal,
      taxRate: effectiveTaxRate,
      taxAmount,
      total,
      currency: "EUR",
      planName: planName || null,
      planId: planId || null,
      lineItems: req.body.lineItems || null,
      dueDate,
      notes: notes || null
    });
    return res.json({ success: true, data: { invoiceNumber } });
  } catch (error) {
    console.error("[Billing] Create invoice error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router6.patch("/admin/billing/invoices/:id/status", requireAdmin3, async (req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const invoiceId = Number(req.params.id);
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS" } });
    }
    const updateData = { status, updatedAt: /* @__PURE__ */ new Date() };
    if (status === "paid") {
      updateData.paidAt = /* @__PURE__ */ new Date();
    }
    await db.update(invoices).set(updateData).where(eq6(invoices.id, invoiceId));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Billing] Update invoice status error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router6.get("/admin/billing/invoices", requireAdmin3, async (_req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const result = await db.select().from(invoices).orderBy(desc2(invoices.createdAt));
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("[Billing] Admin list invoices error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
router6.get("/admin/billing/profiles", requireAdmin3, async (_req, res) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const result = await db.select().from(billingProfiles);
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("[Billing] Admin list profiles error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// src/index.ts
var PORT = parseInt(process.env.PLATFORM_CORE_PORT || "4000");
var app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "platform-core", timestamp: (/* @__PURE__ */ new Date()).toISOString() });
});
app.get("/ready", async (_req, res) => {
  const deps = { database: "unknown" };
  let allOk = true;
  try {
    const db = await getDb();
    if (db) {
      await db.execute("SELECT 1");
      deps.database = "ok";
    } else {
      deps.database = "error";
      allOk = false;
    }
  } catch {
    deps.database = "error";
    allOk = false;
  }
  if (allOk) {
    res.json({ status: "ready", dependencies: deps });
  } else {
    res.status(503).json({ status: "not_ready", dependencies: deps });
  }
});
app.use("/api/auth", router);
app.use("/api/auth", router5);
app.use("/api/v1/registry", router2);
app.use("/api/v1/tenants", router3);
app.use("/api/v1/entitlements", router4);
app.use("/api/v1/tenants", router6);
var server = createServer(app);
server.listen(PORT, () => {
  console.log(`[Platform Core] Running on http://localhost:${PORT}`);
});
export {
  app
};
