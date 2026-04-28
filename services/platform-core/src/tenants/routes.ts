/**
 * Platform Core — Tenant Management Routes
 *
 * Companies, teams, members, invitations, plans, tokens
 */

import { Router, Request, Response } from "express";
import { getDb } from "../db.js";
import { companies, users, teams, teamMembers, invitations, plans, tokenTransactions, tenantModules, modulePermissions } from "../../drizzle/schema.js";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
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

function hasPlatformAdmin(req: Request) {
  const roles = String(req.headers["x-viao-platform-roles"] || "");
  return roles.includes("admin");
}

function hasTenantAdminRole(req: Request) {
  const companyRole = String(req.headers["x-viao-company-role"] || "");
  return ["owner", "admin"].some((role) => companyRole.split(",").map((value) => value.trim()).includes(role));
}

function requireTenantAdmin(req: Request, res: Response, next: Function) {
  if (hasPlatformAdmin(req)) {
    return next();
  }

  if (hasTenantAdminRole(req)) {
    return next();
  }

  return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Apenas administradores podem gerir equipas" } });
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

router.put("/company", requireTenantAdmin, async (req: Request, res: Response) => {
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

router.delete("/members/:userId", requireTenantAdmin, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });

    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const targetId = Number(req.params.userId);
    const targetMember = (await db.select().from(users).where(and(eq(users.id, targetId), eq(users.companyId, tenantId))).limit(1))[0];
    if (!targetMember) {
      return res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "Membro não encontrado nesta empresa" } });
    }

    if (targetMember.companyRole === "owner" && !hasPlatformAdmin(req)) {
      return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "O proprietário principal da empresa não pode ser removido" } });
    }

    const companyTeams = await db.select({ id: teams.id }).from(teams).where(eq(teams.companyId, tenantId));
    const companyTeamIds = companyTeams.map((team) => team.id);

    if (companyTeamIds.length > 0) {
      await db.delete(teamMembers).where(and(inArray(teamMembers.teamId, companyTeamIds), eq(teamMembers.userId, targetId)));
    }

    await db.update(users).set({ companyId: null, companyRole: null }).where(and(eq(users.id, targetId), eq(users.companyId, tenantId)));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Remove member error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

router.put("/members/:userId/role", requireTenantAdmin, async (req: Request, res: Response) => {
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

    const targetMember = (await db.select().from(users).where(and(eq(users.id, targetId), eq(users.companyId, tenantId))).limit(1))[0];
    if (!targetMember) {
      return res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "Membro não encontrado nesta empresa" } });
    }

    if (targetMember.companyRole === "owner" && role !== "owner" && !hasPlatformAdmin(req)) {
      return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "O proprietário principal da empresa não pode perder privilégios de proprietário" } });
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

    if (companyTeams.length === 0) {
      return res.json({ success: true, data: [] });
    }

    const teamIds = companyTeams.map((team) => team.id);
    const memberships = await db.select().from(teamMembers).where(inArray(teamMembers.teamId, teamIds));
    const userIds = [...new Set(memberships.map((membership) => membership.userId))];
    const companyUsers = userIds.length > 0
      ? await db.select().from(users).where(and(eq(users.companyId, tenantId), inArray(users.id, userIds)))
      : [];
    const usersById = new Map(companyUsers.map((user) => [user.id, user]));

    const enrichedTeams = companyTeams.map((team) => {
      const members = memberships
        .filter((membership) => membership.teamId === team.id)
        .map((membership) => usersById.get(membership.userId))
        .filter(Boolean)
        .map((member) => ({
          id: member!.id,
          name: member!.name,
          email: member!.email,
          companyRole: member!.companyRole,
          createdAt: member!.createdAt,
          updatedAt: member!.updatedAt,
        }));

      return {
        ...team,
        memberCount: members.length,
        members,
      };
    });

    return res.json({ success: true, data: enrichedTeams });
  } catch (error) {
    console.error("[Tenants] Teams error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

router.post("/teams", requireTenantAdmin, async (req: Request, res: Response) => {
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

router.delete("/teams/:teamId", requireTenantAdmin, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });

    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const teamId = Number(req.params.teamId);
    const team = (await db.select().from(teams).where(and(eq(teams.id, teamId), eq(teams.companyId, tenantId))).limit(1))[0];
    if (!team) {
      return res.status(404).json({ success: false, error: { code: "TEAM_NOT_FOUND", message: "Equipa não encontrada" } });
    }

    await db.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
    await db.delete(teams).where(and(eq(teams.id, teamId), eq(teams.companyId, tenantId)));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Delete team error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

router.post("/teams/:teamId/members", requireTenantAdmin, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });

    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const teamId = Number(req.params.teamId);
    const userId = Number(req.body?.userId);

    if (!teamId || !userId) {
      return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "teamId e userId são obrigatórios" } });
    }

    const team = (await db.select().from(teams).where(and(eq(teams.id, teamId), eq(teams.companyId, tenantId))).limit(1))[0];
    if (!team) {
      return res.status(404).json({ success: false, error: { code: "TEAM_NOT_FOUND", message: "Equipa não encontrada" } });
    }

    const user = (await db.select().from(users).where(and(eq(users.id, userId), eq(users.companyId, tenantId))).limit(1))[0];
    if (!user) {
      return res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "Membro não encontrado nesta empresa" } });
    }

    const existingMembership = (await db.select().from(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId))).limit(1))[0];
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

router.delete("/teams/:teamId/members/:userId", requireTenantAdmin, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });

    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const teamId = Number(req.params.teamId);
    const userId = Number(req.params.userId);

    const team = (await db.select().from(teams).where(and(eq(teams.id, teamId), eq(teams.companyId, tenantId))).limit(1))[0];
    if (!team) {
      return res.status(404).json({ success: false, error: { code: "TEAM_NOT_FOUND", message: "Equipa não encontrada" } });
    }

    await db.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Remove team member error:", error);
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

router.post("/invitations", requireTenantAdmin, async (req: Request, res: Response) => {
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
      targetTeam = (await db.select().from(teams).where(and(eq(teams.id, teamId), eq(teams.companyId, tenantId))).limit(1))[0] || null;
      if (!targetTeam) {
        return res.status(404).json({ success: false, error: { code: "TEAM_NOT_FOUND", message: "Equipa não encontrada" } });
      }
    }

    const existingUser = (await db.select().from(users).where(eq(users.email, rawEmail)).limit(1))[0] || null;
    if (existingUser) {
      if (existingUser.companyId && existingUser.companyId !== tenantId) {
        return res.status(409).json({ success: false, error: { code: "USER_ALREADY_ASSIGNED", message: "Este utilizador já pertence a outra empresa" } });
      }

      await db.update(users).set({
        companyId: tenantId,
        companyRole: role,
        updatedAt: new Date(),
      }).where(eq(users.id, existingUser.id));

      if (teamId) {
        const existingMembership = (await db.select().from(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, existingUser.id))).limit(1))[0] || null;
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
          teamId: targetTeam?.id || null,
        },
      });
    }

    const token = nanoid(32);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await db.insert(invitations).values({
      companyId: tenantId,
      teamId: teamId || null,
      email: rawEmail,
      role,
      token,
      status: "pending",
      expiresAt,
    });

    return res.status(201).json({ success: true, data: { token, email: rawEmail, expiresAt } });
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
    const parsedPlanId = planId === null || planId === "" || planId === undefined ? null : Number(planId);
    if (parsedPlanId !== null && !Number.isFinite(parsedPlanId)) {
      return res.status(400).json({ success: false, error: { code: "INVALID_PLAN" } });
    }

    await db.update(companies).set({ planId: parsedPlanId, updatedAt: new Date() }).where(eq(companies.id, companyId));
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
    if (!companyId) return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS" } });

    const parsedPlanId = planId === null || planId === "" || planId === undefined ? null : Number(planId);
    if (parsedPlanId !== null && !Number.isFinite(parsedPlanId)) {
      return res.status(400).json({ success: false, error: { code: "INVALID_PLAN" } });
    }

    await db.update(companies).set({ planId: parsedPlanId, updatedAt: new Date() }).where(eq(companies.id, companyId));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Assign plan error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

export { router as tenantsRouter };
// ─── Admin: Create Plan ─────────────────────────────────────────────
router.post("/admin/plans", requireAdmin, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const { name, description, monthlyPrice, yearlyPrice, tokensPerMonth, maxMembers, maxTeams, maxModules, features, isActive, sortOrder } = req.body;
    if (!name) return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "name é obrigatório" } });
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
      isActive: isActive !== undefined ? isActive : true,
      sortOrder: sortOrder || 0,
    }).returning();
    return res.status(201).json({ success: true, data: result[0] });
  } catch (error) {
    console.error("[Tenants] Create plan error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
// ─── Admin: Update Plan ─────────────────────────────────────────────
router.put("/admin/plans/:planId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const planId = Number(req.params.planId);
    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    const fields = ["name", "description", "monthlyPrice", "yearlyPrice", "tokensPerMonth", "maxMembers", "maxTeams", "maxModules", "features", "isActive", "sortOrder"];
    for (const field of fields) {
      if (req.body[field] !== undefined) updateData[field] = req.body[field];
    }
    await db.update(plans).set(updateData).where(eq(plans.id, planId));
    const updated = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
    if (updated.length === 0) return res.status(404).json({ success: false, error: { code: "NOT_FOUND" } });
    return res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error("[Tenants] Update plan error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
// ─── Admin: Delete Plan ─────────────────────────────────────────────
router.delete("/admin/plans/:planId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const planId = Number(req.params.planId);
    await db.update(companies).set({ planId: null, updatedAt: new Date() }).where(eq(companies.planId, planId));
    await db.delete(plans).where(eq(plans.id, planId));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Delete plan error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
// ─── Admin: Create Company ──────────────────────────────────────────
router.post("/admin/companies", requireAdmin, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const { name, sector, email, phone, address, website, planId } = req.body;
    const normalizedName = String(name || "").trim();
    if (!normalizedName) return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "name é obrigatório" } });

    const normalizedPlanId = planId !== undefined && planId !== null && planId !== ""
      ? Number(planId)
      : null;

    if (normalizedPlanId !== null && !Number.isFinite(normalizedPlanId)) {
      return res.status(400).json({ success: false, error: { code: "INVALID_PLAN", message: "planId inválido" } });
    }

    const result = await db.insert(companies).values({
      name: normalizedName,
      sector: sector || null,
      email: email || null,
      phone: phone || null,
      address: address || null,
      website: website || null,
      planId: normalizedPlanId,
    }).returning();
    return res.status(201).json({ success: true, data: result[0] });
  } catch (error) {
    console.error("[Tenants] Create company error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
// ─── Admin: Update Company ──────────────────────────────────────────
router.put("/admin/companies/:companyId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const companyId = Number(req.params.companyId);
    if (!Number.isFinite(companyId) || companyId <= 0) {
      return res.status(400).json({ success: false, error: { code: "INVALID_COMPANY_ID" } });
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    const fields = ["name", "sector", "email", "phone", "address", "website"];
    for (const field of fields) {
      if (req.body[field] !== undefined) updateData[field] = req.body[field];
    }

    if (req.body.planId !== undefined) {
      if (req.body.planId === null || req.body.planId === "") {
        updateData.planId = null;
      } else {
        const parsedPlanId = Number(req.body.planId);
        if (!Number.isFinite(parsedPlanId)) {
          return res.status(400).json({ success: false, error: { code: "INVALID_PLAN", message: "planId inválido" } });
        }
        updateData.planId = parsedPlanId;
      }
    }

    if (typeof updateData.name === "string") {
      updateData.name = String(updateData.name).trim();
      if (!updateData.name) {
        return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "name é obrigatório" } });
      }
    }

    await db.update(companies).set(updateData).where(eq(companies.id, companyId));
    const updated = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (updated.length === 0) return res.status(404).json({ success: false, error: { code: "NOT_FOUND" } });
    return res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error("[Tenants] Update company error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
// ─── Admin: Delete Company ──────────────────────────────────────────
router.delete("/admin/companies/:companyId", requireAdmin, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });
    const companyId = Number(req.params.companyId);

    if (!Number.isFinite(companyId) || companyId <= 0) {
      return res.status(400).json({ success: false, error: { code: "INVALID_COMPANY_ID" } });
    }

    const company = (await db.select().from(companies).where(eq(companies.id, companyId)).limit(1))[0];
    if (!company) {
      return res.status(404).json({ success: false, error: { code: "NOT_FOUND" } });
    }

    const companyTeams = await db.select({ id: teams.id }).from(teams).where(eq(teams.companyId, companyId));
    const teamIds = companyTeams.map((team) => team.id);

    if (teamIds.length > 0) {
      await db.delete(modulePermissions).where(inArray(modulePermissions.teamId, teamIds));
      await db.delete(teamMembers).where(inArray(teamMembers.teamId, teamIds));
    }

    await db.delete(modulePermissions).where(eq(modulePermissions.tenantId, companyId));
    await db.delete(tenantModules).where(eq(tenantModules.tenantId, companyId));
    await db.delete(invitations).where(eq(invitations.companyId, companyId));
    await db.delete(tokenTransactions).where(eq(tokenTransactions.companyId, companyId));
    await db.delete(teams).where(eq(teams.companyId, companyId));
    await db.update(users).set({ companyId: null, companyRole: null }).where(eq(users.companyId, companyId));
    await db.delete(companies).where(eq(companies.id, companyId));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Tenants] Delete company error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});
