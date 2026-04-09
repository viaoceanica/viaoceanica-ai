/**
 * Platform Core — Module Registry Routes
 *
 * GET    /api/v1/registry/modules          → List all registered modules
 * GET    /api/v1/registry/modules/:key     → Get module by key
 * POST   /api/v1/registry/modules          → Register a new module (admin)
 * PUT    /api/v1/registry/modules/:key     → Update module manifest (admin)
 * DELETE /api/v1/registry/modules/:key     → Deregister module (admin)
 * GET    /api/v1/registry/health-check     → Check health of all modules
 */

import { Router, Request, Response } from "express";
import { getDb } from "../db.js";
import { moduleRegistry } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";

const router = Router();

// ─── Middleware: Admin only for mutations ────────────────────────────

function requireAdmin(req: Request, res: Response, next: Function) {
  const roles = req.headers["x-viao-platform-roles"] as string;
  if (!roles || !roles.includes("admin")) {
    return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Apenas administradores podem gerir o registry" } });
  }
  next();
}

// ─── GET /modules ───────────────────────────────────────────────────

router.get("/modules", async (_req: Request, res: Response) => {
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

// ─── GET /modules/:key ──────────────────────────────────────────────

router.get("/modules/:key", async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const result = await db.select().from(moduleRegistry).where(eq(moduleRegistry.moduleKey, req.params.key)).limit(1);
    if (result.length === 0) {
      return res.status(404).json({ success: false, error: { code: "MODULE_NOT_FOUND", message: `Módulo '${req.params.key}' não encontrado` } });
    }

    return res.json({ success: true, data: result[0] });
  } catch (error) {
    console.error("[Registry] Get error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── POST /modules ──────────────────────────────────────────────────

router.post("/modules", requireAdmin, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const manifest = req.body;

    // Validate required fields
    if (!manifest.module_key || !manifest.name) {
      return res.status(400).json({ success: false, error: { code: "INVALID_MANIFEST", message: "module_key e name são obrigatórios" } });
    }

    // Check if already exists
    const existing = await db.select().from(moduleRegistry).where(eq(moduleRegistry.moduleKey, manifest.module_key)).limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, error: { code: "MODULE_EXISTS", message: `Módulo '${manifest.module_key}' já está registado` } });
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
      configSchema: manifest.config_schema || null,
    }).returning();

    return res.status(201).json({ success: true, data: result[0] });
  } catch (error) {
    console.error("[Registry] Create error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── PUT /modules/:key ──────────────────────────────────────────────

router.put("/modules/:key", requireAdmin, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const manifest = req.body;
    const key = req.params.key;

    const existing = await db.select().from(moduleRegistry).where(eq(moduleRegistry.moduleKey, key)).limit(1);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: { code: "MODULE_NOT_FOUND" } });
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (manifest.name) updateData.name = manifest.name;
    if (manifest.description !== undefined) updateData.description = manifest.description;
    if (manifest.version) updateData.version = manifest.version;
    if (manifest.route) updateData.route = manifest.route;
    if (manifest.frontend_mount_type) updateData.frontendMountType = manifest.frontend_mount_type;
    if (manifest.backend_service_url) updateData.backendServiceUrl = manifest.backend_service_url;
    if (manifest.icon) updateData.icon = manifest.icon;
    if (manifest.status) updateData.status = manifest.status;
    if (manifest.capabilities) updateData.capabilities = JSON.stringify(manifest.capabilities);
    if (manifest.min_plan !== undefined) updateData.minPlan = manifest.min_plan;
    if (manifest.tenant_restricted !== undefined) updateData.tenantRestricted = manifest.tenant_restricted;
    if (manifest.config_schema !== undefined) updateData.configSchema = manifest.config_schema;

    await db.update(moduleRegistry).set(updateData).where(eq(moduleRegistry.moduleKey, key));

    const updated = await db.select().from(moduleRegistry).where(eq(moduleRegistry.moduleKey, key)).limit(1);
    return res.json({ success: true, data: updated[0] });
  } catch (error) {
    console.error("[Registry] Update error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── DELETE /modules/:key ───────────────────────────────────────────

router.delete("/modules/:key", requireAdmin, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const key = req.params.key;
    const existing = await db.select().from(moduleRegistry).where(eq(moduleRegistry.moduleKey, key)).limit(1);
    if (existing.length === 0) {
      return res.status(404).json({ success: false, error: { code: "MODULE_NOT_FOUND" } });
    }

    await db.delete(moduleRegistry).where(eq(moduleRegistry.moduleKey, key));
    return res.json({ success: true });
  } catch (error) {
    console.error("[Registry] Delete error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

export { router as registryRouter };
