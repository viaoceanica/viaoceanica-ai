/**
 * Platform Core — Auth Routes
 *
 * POST /api/auth/register  → Create company + owner user
 * POST /api/auth/login     → Validate credentials, issue session
 * POST /api/auth/logout    → Clear session cookie
 * GET  /api/auth/me        → Return current user from x-viao-* headers
 */

import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import { SignJWT } from "jose";
import { getDb } from "../db.js";
import { users, companies, plans } from "../../drizzle/schema.js";
import { eq } from "drizzle-orm";

const router = Router();

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || "change-me");
const COOKIE_NAME = process.env.COOKIE_NAME || "app_session_id";

// ─── Helpers ────────────────────────────────────────────────────────

async function createSessionToken(payload: {
  userId: number;
  email: string;
  name: string;
  tenantId?: number;
  platformRole?: string;
  companyRole?: string;
}): Promise<string> {
  const expiresAt = Math.floor((Date.now() + 365 * 24 * 60 * 60 * 1000) / 1000);
  return new SignJWT(payload as unknown as Record<string, unknown>)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(expiresAt)
    .sign(JWT_SECRET);
}

const IS_PRODUCTION = process.env.NODE_ENV === "production" && process.env.FORCE_HTTPS === "true";

function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: IS_PRODUCTION ? "none" : "lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60 * 1000,
  });
}

// ─── POST /register ─────────────────────────────────────────────────

router.post("/register", async (req: Request, res: Response) => {
  try {
    const { companyName, name, email, password, sector } = req.body;

    if (!companyName || !name || !email || !password) {
      return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "Todos os campos são obrigatórios" } });
    }

    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE", message: "Base de dados indisponível" } });

    // Check if email already exists
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existing.length > 0) {
      return res.status(409).json({ success: false, error: { code: "EMAIL_EXISTS", message: "Este email já está registado" } });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Find default plan (Starter)
    const allPlans = await db.select().from(plans);
    const starterPlan = allPlans.find((p) => p.name.toLowerCase().includes("starter"));

    // Create company
    const companyResult = await db.insert(companies).values({
      name: companyName,
      sector: sector || null,
      email: email,
      planId: starterPlan?.id || null,
      tokensBalance: 0,
      externalTokensBalance: 0,
    }).returning();

    const company = companyResult[0];

    // Create owner user
    const userResult = await db.insert(users).values({
      email,
      name,
      passwordHash,
      loginMethod: "email",
      platformRole: "user",
      companyId: company.id,
      companyRole: "owner",
      lastSignedIn: new Date(),
    }).returning();

    const user = userResult[0];

    // Issue session
    const token = await createSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name || "",
      tenantId: company.id,
      platformRole: user.platformRole,
      companyRole: user.companyRole || "owner",
    });

    setSessionCookie(res, token);

    return res.json({
      success: true,
      data: {
        user: { id: user.id, name: user.name, email: user.email, platformRole: user.platformRole, companyRole: user.companyRole },
        company: { id: company.id, name: company.name },
      },
    });
  } catch (error) {
    console.error("[Auth] Register error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Erro interno" } });
  }
});

// ─── POST /login ────────────────────────────────────────────────────

router.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "Email e password são obrigatórios" } });
    }

    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE", message: "Base de dados indisponível" } });

    // Find user
    const result = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (result.length === 0) {
      return res.status(401).json({ success: false, error: { code: "INVALID_CREDENTIALS", message: "Credenciais inválidas" } });
    }

    const user = result[0];

    // Verify password
    if (!user.passwordHash) {
      return res.status(401).json({ success: false, error: { code: "INVALID_CREDENTIALS", message: "Credenciais inválidas" } });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ success: false, error: { code: "INVALID_CREDENTIALS", message: "Credenciais inválidas" } });
    }

    // Update last signed in
    await db.update(users).set({ lastSignedIn: new Date() }).where(eq(users.id, user.id));

    // Issue session
    const token = await createSessionToken({
      userId: user.id,
      email: user.email,
      name: user.name || "",
      tenantId: user.companyId || undefined,
      platformRole: user.platformRole,
      companyRole: user.companyRole || undefined,
    });

    setSessionCookie(res, token);

    return res.json({
      success: true,
      data: {
        user: { id: user.id, name: user.name, email: user.email, platformRole: user.platformRole, companyRole: user.companyRole },
      },
    });
  } catch (error) {
    console.error("[Auth] Login error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Erro interno" } });
  }
});

// ─── POST /logout ───────────────────────────────────────────────────

router.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie(COOKIE_NAME, { httpOnly: true, secure: IS_PRODUCTION, sameSite: IS_PRODUCTION ? "none" : "lax", path: "/" });
  return res.json({ success: true });
});

// ─── GET /me ────────────────────────────────────────────────────────

router.get("/me", async (req: Request, res: Response) => {
  const userId = req.headers["x-viao-user-id"];
  if (!userId) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Não autenticado" } });
  }

  const db = await getDb();
  if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE", message: "Base de dados indisponível" } });

  const result = await db.select().from(users).where(eq(users.id, Number(userId))).limit(1);
  if (result.length === 0) {
    return res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND", message: "Utilizador não encontrado" } });
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
      lastSignedIn: user.lastSignedIn,
    },
  });
});

// ─── POST /change-password ──────────────────────────────────────────

router.post("/change-password", async (req: Request, res: Response) => {
  const userId = req.headers["x-viao-user-id"];
  if (!userId) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Não autenticado" } });
  }

  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, error: { code: "MISSING_FIELDS", message: "Password atual e nova são obrigatórias" } });
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
      return res.status(400).json({ success: false, error: { code: "NO_PASSWORD", message: "Utilizador não tem password definida" } });
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

// ─── PUT /profile ──────────────────────────────────────────────────

router.put("/profile", async (req: Request, res: Response) => {
  const userId = req.headers["x-viao-user-id"];
  if (!userId) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Não autenticado" } });
  }

  try {
    const { name } = req.body;

    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;

    if (Object.keys(updateData).length > 0) {
      await db.update(users).set(updateData).where(eq(users.id, Number(userId)));
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("[Auth] Update profile error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

// ─── GET /profile ──────────────────────────────────────────────────

router.get("/profile", async (req: Request, res: Response) => {
  const userId = req.headers["x-viao-user-id"];
  if (!userId) {
    return res.status(401).json({ success: false, error: { code: "UNAUTHENTICATED", message: "Não autenticado" } });
  }

  try {
    const db = await getDb();
    if (!db) return res.status(503).json({ success: false, error: { code: "DB_UNAVAILABLE" } });

    const result = await db.select().from(users).where(eq(users.id, Number(userId))).limit(1);
    if (result.length === 0) {
      return res.status(404).json({ success: false, error: { code: "USER_NOT_FOUND" } });
    }

    const user = result[0];
    // Get company info
    let company = null;
    if (user.companyId) {
      const companyResult = await db.select().from(companies).where(eq(companies.id, user.companyId)).limit(1);
      company = companyResult[0] || null;
    }

    // Get plan info
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
        lastSignedIn: user.lastSignedIn,
      },
    });
  } catch (error) {
    console.error("[Auth] Get profile error:", error);
    return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR" } });
  }
});

export { router as authRouter };
