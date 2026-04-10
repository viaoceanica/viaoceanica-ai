import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import bcrypt from "bcryptjs";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

export function registerOAuthRoutes(app: Express) {
  // ─── Admin standalone login ─────────────────────────────────────
  app.post("/api/admin/login", async (req: Request, res: Response) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        res.status(400).json({ error: "Username e password são obrigatórios" });
        return;
      }
      const adminCred = await db.getAdminByUsername(username);
      if (!adminCred) {
        res.status(401).json({ error: "Credenciais inválidas" });
        return;
      }
      const valid = await bcrypt.compare(password, adminCred.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Credenciais inválidas" });
        return;
      }
      // Find or create a system admin user to issue a session
      let adminUser = await db.getUserByEmail(username);
      if (!adminUser) {
        // Also check for legacy admin email
        adminUser = await db.getUserByEmail("admin@viaoceanica.system");
      }
      if (!adminUser) {
        adminUser = await db.createUser({
          email: username,
          name: "Administrador",
          passwordHash: adminCred.passwordHash,
          companyRole: "owner",
        });
        if (adminUser) {
          await db.updateUser(adminUser.id, { role: "admin" } as any);
          adminUser = await db.getUserById(adminUser.id);
        }
      }
      if (!adminUser) {
        res.status(500).json({ error: "Erro ao criar sessão de administrador" });
        return;
      }
      // Ensure admin role
      if (adminUser.role !== "admin") {
        await db.updateUser(adminUser.id, { role: "admin" } as any);
      }
      const sessionToken = await sdk.createSessionToken(adminUser.id, {
        email: adminUser.email || "",
        name: adminUser.name || "",
        expiresInMs: ONE_YEAR_MS,
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.json({
        success: true,
        data: {
          user: {
            id: adminUser.id,
            name: adminUser.name,
            email: adminUser.email,
            platformRole: "admin",
          },
        },
      });
    } catch (error) {
      console.error("[Auth] Admin login failed", error);
      res.status(500).json({ error: "Erro no login de administrador" });
    }
  });

  // ─── Auth me endpoint (REST, used by useAuth hook) ──────────────
  app.get("/api/auth/me", async (req: Request, res: Response) => {
    try {
      const user = await sdk.authenticateRequest(req);
      const company = user.companyId ? await db.getCompanyById(user.companyId) : null;
      res.json({
        success: true,
        data: {
          id: user.id,
          name: user.name,
          email: user.email,
          platformRole: user.role,
          companyRole: user.companyRole,
          companyId: user.companyId,
          companyName: company?.name || null,
          createdAt: user.createdAt,
          lastSignedIn: user.lastSignedIn,
          company: company ? { name: company.name } : null,
        },
      });
    } catch {
      res.status(401).json({ success: false, error: "Not authenticated" });
    }
  });

  // ─── Auth logout endpoint (REST, used by useAuth hook) ─────────
  app.post("/api/auth/logout", async (req: Request, res: Response) => {
    try {
      const cookieOptions = getSessionCookieOptions(req);
      res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      res.json({ success: true });
    } catch (error) {
      console.error("[Auth] Logout failed", error);
      res.status(500).json({ error: "Erro no logout" });
    }
  });

  // Admin logout endpoint
  app.post("/api/admin/logout", async (req: Request, res: Response) => {
    try {
      const cookieOptions = getSessionCookieOptions(req);
      res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      res.json({ success: true });
    } catch (error) {
      console.error("[Auth] Admin logout failed", error);
      res.status(500).json({ error: "Erro no logout" });
    }
  });

  // Register endpoint
  app.post("/api/auth/register", async (req: Request, res: Response) => {
    try {
      const { email, password, name, companyName, sector } = req.body;

      if (!email || !password || !name || !companyName) {
        res.status(400).json({ error: "Todos os campos obrigatórios devem ser preenchidos" });
        return;
      }

      // Check if email already exists
      const existing = await db.getUserByEmail(email);
      if (existing) {
        res.status(400).json({ error: "Este email já está registado" });
        return;
      }

      // Hash password
      const passwordHash = await bcrypt.hash(password, 12);

      // Create company first
      const company = await db.createCompany({
        name: companyName,
        sector: sector || null,
        email,
      });

      if (!company) {
        res.status(500).json({ error: "Erro ao criar empresa" });
        return;
      }

      // Assign default Starter plan
      const allPlans = await db.getAllPlans();
      const starterPlan = allPlans.find(p => p.name === "Starter");
      if (starterPlan) {
        await db.updateCompany(company.id, { planId: starterPlan.id });
      }

      // Create user as company owner
      const user = await db.createUser({
        email,
        name,
        passwordHash,
        companyId: company.id,
        companyRole: "owner",
      });

      if (!user) {
        res.status(500).json({ error: "Erro ao criar utilizador" });
        return;
      }

      // Create session
      const sessionToken = await sdk.createSessionToken(user.id, {
        email: user.email || "",
        name: user.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (error) {
      console.error("[Auth] Register failed", error);
      res.status(500).json({ error: "Erro no registo" });
    }
  });

  // Login endpoint
  app.post("/api/auth/login", async (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;

      if (!email || !password) {
        res.status(400).json({ error: "Email e password são obrigatórios" });
        return;
      }

      const user = await db.getUserByEmail(email);
      if (!user || !user.passwordHash) {
        res.status(401).json({ error: "Credenciais inválidas" });
        return;
      }

      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid) {
        res.status(401).json({ error: "Credenciais inválidas" });
        return;
      }

      // Update last signed in
      await db.updateUser(user.id, { lastSignedIn: new Date() });

      // Create session
      const sessionToken = await sdk.createSessionToken(user.id, {
        email: user.email || "",
        name: user.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.json({ success: true, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
    } catch (error) {
      console.error("[Auth] Login failed", error);
      res.status(500).json({ error: "Erro no login" });
    }
  });
}
