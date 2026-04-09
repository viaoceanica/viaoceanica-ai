/**
 * Platform Core — Tenant Management Routes
 *
 * Companies, teams, members, invitations, plans, tokens
 */

import { Router, Request, Response } from "express";
import { getDb } from "../db.js";
import { companies, users, teams, teamMembers, invitations, plans, tokenTransactions } from "../../drizzle/schema.js";
import { eq, and, desc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

const router = Router();

// ─── Helpers ────────────────────────────────────────────────────────

function getTenantId(req: Request): number | null {
  const id = req.headers["x-viao-tenant-id"];
  return id ? Number(id) : null;
}

function getUserId(req: Request): number | null {
  const id = req.headers["x-viao-user-id"];
  return id ? Number(id) : null;
}

function requireAuth(req: Request, res: Response, next: Function) {
  if (!getUserId(req)) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED" } });
  }
  next();
}

function requireAdmin(req: Request, res: Response, next: Function) {
  const roles = req.headers["x-viao-platform-roles"] as string;
  if (!roles || !roles.includes("admin")) {
    return res.status(403).json({ success: false, error: { code: "FORBIDDEN" } });
  }
  next();
}

// ─── Company ────────────────────────────────────────────────────────

router.get("/company", requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });

    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const result = await db.select().from(companies).where(eq(companies.id, tenantId)).limit(1);
    if (result.length === 0) return res.status(404).json({ success: false, error: { code: "NOT_FOUND" } });

    const company = result[0];
    const plan = company.planId ? (await db.select().from(plans).where(eq(plans.id, company.planId)).limit(1))[0] : null;
    const members = await db.select().from(users).where(eq(users.companyId, tenantId));

    return res.json({
      success: true,
      data: {
        ...company,
        plan,
        memberCount: members.length,
      },
    });
  } catch (error) {
    console.error("[Tenants] Company error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

router.put("/company", requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });

    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const { name, sector, email, phone, address, website } = req.body;
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (name) updateData.name = name;
    if (sector !== undefined) updateData.sector = sector;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (address !== undefined) updateData.address = address;
    if (website !== undefined) updateData.website = website;

    await db.update(companies).set(updateData).where(eq(companies.id, tenantId));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Update company error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── Members ────────────────────────────────────────────────────────

router.get("/members", requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });

    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const members = await db.select().from(users).where(eq(users.companyId, tenantId));
    return res.json({
      success: true,
      data: members.map((m) => ({ ...m, passwordHash: undefined })),
    });
  } catch (error) {
    console.error("[Tenants] Members error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

router.delete("/members/:userId", requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });

    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const targetId = Number(req.params.userId);
    await db.update(users).set({ companyId: null, companyRole: null }).where(and(eq(users.id, targetId), eq(users.companyId, tenantId)));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Remove member error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

router.put("/members/:userId/role", requireAuth, async (req: Request, res: Response) => {
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

    await db.update(users).set({ companyRole: role }).where(and(eq(users.id, targetId), eq(users.companyId, tenantId)));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Change role error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── Teams ──────────────────────────────────────────────────────────

router.get("/teams", requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });

    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const companyTeams = await db.select().from(teams).where(eq(teams.companyId, tenantId));
    return res.json({ success: true, data: companyTeams });
  } catch (error) {
    console.error("[Tenants] Teams error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

router.post("/teams", requireAuth, async (req: Request, res: Response) => {
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

router.delete("/teams/:teamId", requireAuth, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const teamId = Number(req.params.teamId);
    await db.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
    await db.delete(teams).where(eq(teams.id, teamId));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Delete team error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── Invitations ────────────────────────────────────────────────────

router.get("/invitations", requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });

    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const pending = await db.select().from(invitations).where(and(eq(invitations.companyId, tenantId), eq(invitations.status, "pending")));
    return res.json({ success: true, data: pending });
  } catch (error) {
    console.error("[Tenants] Invitations error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

router.post("/invitations", requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });

    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const { email, teamId, role } = req.body;
    if (!email) return res.status(400).json({ success: false, error: { code: "MISSING_EMAIL" } });

    const token = nanoid(32);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await db.insert(invitations).values({
      companyId: tenantId,
      teamId: teamId || null,
      email,
      role: role || "member",
      token,
      status: "pending",
      expiresAt,
    });

    return res.status(201).json({ success: true, data: { token, email, expiresAt } });
  } catch (error) {
    console.error("[Tenants] Create invitation error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── Tokens ─────────────────────────────────────────────────────────

router.get("/tokens", requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });

    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const company = (await db.select().from(companies).where(eq(companies.id, tenantId)).limit(1))[0];
    const transactions = await db.select().from(tokenTransactions).where(eq(tokenTransactions.companyId, tenantId)).orderBy(desc(tokenTransactions.createdAt));

    return res.json({
      success: true,
      data: {
        balance: { internal: company?.tokensBalance || 0, external: company?.externalTokensBalance || 0 },
        transactions,
      },
    });
  } catch (error) {
    console.error("[Tenants] Tokens error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── Plans ──────────────────────────────────────────────────────────

router.get("/plans", async (_req: Request, res: Response) => {
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

// ─── Admin: All Companies ───────────────────────────────────────────

router.get("/admin/companies", requireAdmin, async (_req: Request, res: Response) => {
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

// ─── Admin: Plans (alias) ──────────────────────────────────────────

router.get("/admin/plans", requireAdmin, async (_req: Request, res: Response) => {
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

// ─── Admin: All Users ──────────────────────────────────────────────

router.get("/admin/users", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const allUsers = await db.select().from(users);
    return res.json({ success: true, data: allUsers.map(u => ({ ...u, passwordHash: undefined })) });
  } catch (error) {
    console.error("[Tenants] Admin users error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── Admin: Company Detail ─────────────────────────────────────────

router.get("/admin/companies/:companyId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const companyId = Number(req.params.companyId);
    const company = (await db.select().from(companies).where(eq(companies.id, companyId)).limit(1))[0];
    if (!company) return res.status(404).json({ success: false, error: { code: "NOT_FOUND" } });
    const plan = company.planId ? (await db.select().from(plans).where(eq(plans.id, company.planId)).limit(1))[0] : null;
    const members = await db.select().from(users).where(eq(users.companyId, companyId));
    return res.json({ success: true, data: { company, plan, members: members.map(m => ({ ...m, passwordHash: undefined })) } });
  } catch (error) {
    console.error("[Tenants] Admin company detail error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── Admin: Grant Tokens (by companyId in URL) ─────────────────────

router.post("/admin/companies/:companyId/tokens", requireAdmin, async (req: Request, res: Response) => {
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
      description: description || "Tokens atribuídos pelo administrador",
    });
    if (isExternal) {
      await db.update(companies).set({ externalTokensBalance: sql`external_tokens_balance + ${amount}` }).where(eq(companies.id, companyId));
    } else {
      await db.update(companies).set({ tokensBalance: sql`tokens_balance + ${amount}` }).where(eq(companies.id, companyId));
    }
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Admin grant tokens (URL) error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── Admin: Assign Plan (by companyId in URL) ──────────────────────

router.put("/admin/companies/:companyId/plan", requireAdmin, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const companyId = Number(req.params.companyId);
    const { planId } = req.body;
    if (!planId) return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS" } });
    await db.update(companies).set({ planId, updatedAt: new Date() }).where(eq(companies.id, companyId));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Admin assign plan (URL) error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── Admin: All Token Transactions ─────────────────────────────────

router.get("/admin/tokens/transactions", requireAdmin, async (_req: Request, res: Response) => {
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

// ─── Admin: Grant Tokens (legacy body-based) ────────────────────────

router.post("/admin/grant-tokens", requireAdmin, async (req: Request, res: Response) => {
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
      description: description || "Tokens atribuídos pelo administrador",
    });

    // Update balance
    if (isExternal) {
      await db.update(companies).set({ externalTokensBalance: sql`external_tokens_balance + ${amount}` }).where(eq(companies.id, companyId));
    } else {
      await db.update(companies).set({ tokensBalance: sql`tokens_balance + ${amount}` }).where(eq(companies.id, companyId));
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Grant tokens error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── Admin: Assign Plan ─────────────────────────────────────────────

router.put("/admin/assign-plan", requireAdmin, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const { companyId, planId } = req.body;
    if (!companyId || !planId) return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS" } });

    await db.update(companies).set({ planId, updatedAt: new Date() }).where(eq(companies.id, companyId));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Assign plan error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

export { router as tenantsRouter };
