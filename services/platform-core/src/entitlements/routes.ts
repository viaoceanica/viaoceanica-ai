/**
 * Platform Core — Entitlements Routes
 *
 * Manages which modules each tenant has access to,
 * and which teams/users within a tenant can use each module.
 */

import { Router, Request, Response } from "express";
import { getDb } from "../db.js";
import { tenantModules, modulePermissions, moduleRegistry, teamMembers, users } from "../../drizzle/schema.js";
import { eq, and } from "drizzle-orm";

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

// ─── GET /modules — Tenant's enabled modules ────────────────────────

router.get("/modules", requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });

    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const tenantMods = await db.select().from(tenantModules).where(eq(tenantModules.tenantId, tenantId));
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
        status: reg?.status,
      };
    });

    return res.json({ success: true, data: enriched });
  } catch (error) {
    console.error("[Entitlements] List modules error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── PUT /modules/:moduleKey — Enable/disable module for tenant ─────

router.put("/modules/:moduleKey", requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });

    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const { moduleKey } = req.params;
    const { enabled } = req.body;

    // Check if module exists in registry
    const regEntry = await db.select().from(moduleRegistry).where(eq(moduleRegistry.moduleKey, moduleKey)).limit(1);
    if (regEntry.length === 0) {
      return res.status(404).json({ success: false, error: { code: "MODULE_NOT_FOUND" } });
    }

    // Upsert tenant module
    const existing = await db
      .select()
      .from(tenantModules)
      .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleKey, moduleKey)))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(tenantModules)
        .set({ enabled: enabled !== false, updatedAt: new Date() })
        .where(eq(tenantModules.id, existing[0].id));
    } else {
      await db.insert(tenantModules).values({
        tenantId,
        moduleKey,
        enabled: enabled !== false,
        visibilityMode: "global",
        rolloutState: "enabled",
      });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("[Entitlements] Toggle module error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── GET /modules/:moduleKey/permissions ─────────────────────────────

router.get("/modules/:moduleKey/permissions", requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });

    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const { moduleKey } = req.params;
    const perms = await db
      .select()
      .from(modulePermissions)
      .where(and(eq(modulePermissions.tenantId, tenantId), eq(modulePermissions.moduleKey, moduleKey)));

    return res.json({ success: true, data: perms });
  } catch (error) {
    console.error("[Entitlements] Get permissions error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── PUT /modules/:moduleKey/permissions ─────────────────────────────

router.put("/modules/:moduleKey/permissions", requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });

    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const { moduleKey } = req.params;
    const { permissions } = req.body; // Array of { teamId?, userId? }

    // Remove existing permissions
    await db
      .delete(modulePermissions)
      .where(and(eq(modulePermissions.tenantId, tenantId), eq(modulePermissions.moduleKey, moduleKey)));

    // Insert new permissions
    if (permissions && permissions.length > 0) {
      await db.insert(modulePermissions).values(
        permissions.map((p: { teamId?: number; userId?: number }) => ({
          tenantId,
          moduleKey,
          teamId: p.teamId ?? null,
          userId: p.userId ?? null,
        }))
      );
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("[Entitlements] Set permissions error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── GET /active — Modules accessible to the current user ───────────

router.get("/active", requireAuth, async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    const userId = getUserId(req);
    if (!tenantId || !userId) return res.status(400).json({ success: false, error: { code: "NO_CONTEXT" } });

    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    // Get enabled tenant modules
    const enabledMods = await db
      .select()
      .from(tenantModules)
      .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.enabled, true)));

    if (enabledMods.length === 0) return res.json({ success: true, data: [] });

    // Get all registry entries
    const allRegistry = await db.select().from(moduleRegistry);

    // Get user info
    const userResult = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const user = userResult[0];
    const isOwnerOrAdmin = user?.companyRole === "owner" || user?.companyRole === "admin";

    // Get user's team memberships
    const userTeams = await db.select().from(teamMembers).where(eq(teamMembers.userId, userId));
    const userTeamIds = userTeams.map((t) => t.teamId);

    const result: Array<{
      moduleKey: string;
      name: string;
      icon: string | null;
      route: string | null;
      frontendMountType: string | null;
    }> = [];

    for (const tm of enabledMods) {
      const reg = allRegistry.find((r) => r.moduleKey === tm.moduleKey);
      if (!reg) continue;

      // Owner/admin always has access
      if (isOwnerOrAdmin) {
        result.push({ moduleKey: reg.moduleKey, name: reg.name, icon: reg.icon, route: reg.route, frontendMountType: reg.frontendMountType });
        continue;
      }

      // Check permissions
      const perms = await db
        .select()
        .from(modulePermissions)
        .where(and(eq(modulePermissions.tenantId, tenantId), eq(modulePermissions.moduleKey, tm.moduleKey)));

      // No permissions = accessible to all
      if (perms.length === 0) {
        result.push({ moduleKey: reg.moduleKey, name: reg.name, icon: reg.icon, route: reg.route, frontendMountType: reg.frontendMountType });
        continue;
      }

      // Check direct user or team permission
      const hasAccess = perms.some((p) => (p.userId && p.userId === userId) || (p.teamId && userTeamIds.includes(p.teamId)));
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

// ─── GET /check — Quick entitlement check for gateway enforcement ─────
// No auth required — called internally by the gateway with tenantId & moduleKey

router.get("/check", async (req: Request, res: Response) => {
  try {
    const tenantId = Number(req.query.tenantId);
    const moduleKey = req.query.moduleKey as string;

    if (!tenantId || !moduleKey) {
      return res.status(400).json({ success: false, error: { code: "MISSING_PARAMS" } });
    }

    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const result = await db
      .select()
      .from(tenantModules)
      .where(and(eq(tenantModules.tenantId, tenantId), eq(tenantModules.moduleKey, moduleKey)))
      .limit(1);

    const enabled = result.length > 0 && result[0].enabled;
    return res.json({ success: true, data: { enabled } });
  } catch (error) {
    console.error("[Entitlements] Check error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

export { router as entitlementsRouter };
