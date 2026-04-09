/**
 * Platform Core — Billing Routes
 *
 * Billing profiles, invoices, subscription management
 */
import { Router, Request, Response } from "express";
import { getDb } from "../db.js";
import { billingProfiles, invoices, companies, plans } from "../../drizzle/schema.js";
import { eq, desc, and } from "drizzle-orm";

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

function requireTenant(req: Request, res: Response, next: Function) {
  if (!getTenantId(req)) {
    return res.status(400).json({ success: false, error: { code: "NO_TENANT" } });
  }
  next();
}

function requireAdmin(req: Request, res: Response, next: Function) {
  const role = req.headers["x-viao-platform-role"];
  if (role !== "admin") {
    return res.status(403).json({ success: false, error: { code: "FORBIDDEN" } });
  }
  next();
}

// ─── GET /billing/profile — Get billing profile for current tenant ──
router.get("/billing/profile", requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const tenantId = getTenantId(req)!;
    const [profile] = await db
      .select()
      .from(billingProfiles)
      .where(eq(billingProfiles.companyId, tenantId))
      .limit(1);

    // Also get company info for defaults
    const [company] = await db
      .select()
      .from(companies)
      .where(eq(companies.id, tenantId))
      .limit(1);

    // Get current plan
    let plan = null;
    if (company?.planId) {
      const [p] = await db.select().from(plans).where(eq(plans.id, company.planId)).limit(1);
      plan = p || null;
    }

    return res.json({
      success: true,
      data: {
        profile: profile || null,
        company: company ? { id: company.id, name: company.name, email: company.email, phone: company.phone } : null,
        plan: plan ? { id: plan.id, name: plan.name, monthlyPrice: plan.monthlyPrice, yearlyPrice: plan.yearlyPrice } : null,
      },
    });
  } catch (error) {
    console.error("[Billing] Get profile error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── PUT /billing/profile — Create or update billing profile ────────
router.put("/billing/profile", requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const tenantId = getTenantId(req)!;
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
      notes,
    } = req.body;

    // Check if profile exists
    const [existing] = await db
      .select()
      .from(billingProfiles)
      .where(eq(billingProfiles.companyId, tenantId))
      .limit(1);

    if (existing) {
      // Update
      await db
        .update(billingProfiles)
        .set({
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
          updatedAt: new Date(),
        })
        .where(eq(billingProfiles.id, existing.id));
    } else {
      // Create
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
        notes,
      });
    }

    // Return updated profile
    const [profile] = await db
      .select()
      .from(billingProfiles)
      .where(eq(billingProfiles.companyId, tenantId))
      .limit(1);

    return res.json({ success: true, data: profile });
  } catch (error) {
    console.error("[Billing] Update profile error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── GET /billing/invoices — List invoices for current tenant ───────
router.get("/billing/invoices", requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const tenantId = getTenantId(req)!;
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const offset = Number(req.query.offset) || 0;

    const result = await db
      .select()
      .from(invoices)
      .where(eq(invoices.companyId, tenantId))
      .orderBy(desc(invoices.createdAt))
      .limit(limit)
      .offset(offset);

    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("[Billing] List invoices error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── GET /billing/invoices/:id — Get single invoice ─────────────────
router.get("/billing/invoices/:id", requireAuth, requireTenant, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const tenantId = getTenantId(req)!;
    const invoiceId = Number(req.params.id);

    const [invoice] = await db
      .select()
      .from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.companyId, tenantId)))
      .limit(1);

    if (!invoice) {
      return res.status(404).json({ success: false, error: { code: "NOT_FOUND" } });
    }

    return res.json({ success: true, data: invoice });
  } catch (error) {
    console.error("[Billing] Get invoice error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── Admin: Create Invoice ──────────────────────────────────────────
router.post("/admin/billing/invoices", requireAdmin, async (req: Request, res: Response) => {
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
      notes,
    } = req.body;

    if (!companyId || subtotal === undefined) {
      return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS" } });
    }

    // Generate invoice number: VIAO-YYYY-NNNN
    const year = new Date().getFullYear();
    const existingCount = await db.select().from(invoices);
    const nextNum = existingCount.length + 1;
    const invoiceNumber = `VIAO-${year}-${String(nextNum).padStart(4, "0")}`;

    const effectiveTaxRate = taxRate ?? 23;
    const taxAmount = Math.round(subtotal * effectiveTaxRate / 100);
    const total = subtotal + taxAmount;

    // Due date: 30 days from now
    const dueDate = new Date();
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
      notes: notes || null,
    });

    return res.json({ success: true, data: { invoiceNumber } });
  } catch (error) {
    console.error("[Billing] Create invoice error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── Admin: Update Invoice Status ───────────────────────────────────
router.patch("/admin/billing/invoices/:id/status", requireAdmin, async (req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const invoiceId = Number(req.params.id);
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS" } });
    }

    const updateData: any = { status, updatedAt: new Date() };
    if (status === "paid") {
      updateData.paidAt = new Date();
    }

    await db.update(invoices).set(updateData).where(eq(invoices.id, invoiceId));

    return res.json({ success: true });
  } catch (error) {
    console.error("[Billing] Update invoice status error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── Admin: List all invoices ───────────────────────────────────────
router.get("/admin/billing/invoices", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const result = await db
      .select()
      .from(invoices)
      .orderBy(desc(invoices.createdAt));

    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("[Billing] Admin list invoices error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── Admin: List all billing profiles ───────────────────────────────
router.get("/admin/billing/profiles", requireAdmin, async (_req: Request, res: Response) => {
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

export { router as billingRouter };
